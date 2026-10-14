import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { getEmailSiteUrl, getResendClient, salesEmailTemplate, sendEmail, unsubscribeUrl } from '@/lib/email';
import { listContacts } from '@/lib/resend-audience';
import { applyMergeTags, loadEmailLookups, loadSalesLeads, mergeVars, type SalesLead } from '@/lib/sales';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_RECIPIENTS = 1000;
const BATCH_SIZE = 100;          // Resend batch API limit
const BATCH_GAP_MS = 600;        // stay under Resend's default 2 req/s

async function requireAdmin() {
  const supabase = getServerSupabase();
  if (!supabase) return { error: NextResponse.json({ error: 'Supabase not configured' }, { status: 500 }) };
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  if (!(await isAdmin(me.email))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  const svc = getServiceSupabase();
  if (!svc) return { error: NextResponse.json({ error: 'Service role not configured' }, { status: 500 }) };
  return { me, svc };
}

// Campaign history, with how many recipients are paying today.
export async function GET() {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;
  const { svc } = auth;
  const { data: campaigns, error } = await svc
    .from('sales_campaigns')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ campaigns: [], ready: false });
  const ids = (campaigns || []).map((c: any) => c.id);
  const { data: sends } = ids.length
    ? await svc.from('sales_campaign_sends').select('campaign_id, user_id').in('campaign_id', ids).eq('status', 'sent')
    : { data: [] as any[] };
  const { leads } = await loadSalesLeads(svc);
  const paying = new Set(leads.filter((l) => l.segment === 'paying').map((l) => l.id));
  const payingBy = new Map<string, number>();
  for (const s of sends || []) if (s.user_id && paying.has(s.user_id)) payingBy.set(s.campaign_id, (payingBy.get(s.campaign_id) || 0) + 1);
  return NextResponse.json({
    ready: true,
    campaigns: (campaigns || []).map((c: any) => ({ ...c, nowPaying: payingBy.get(c.id) || 0 })),
  });
}

type SendBody = {
  subject?: string; body?: string; ctaLabel?: string; ctaUrl?: string; showLookups?: boolean;
  userIds?: string[]; audience?: string; cooldownDays?: number;
  test?: boolean; previewUserId?: string;
};

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;
  const { me, svc } = auth;
  const resend = getResendClient();
  if (!resend) return NextResponse.json({ error: 'RESEND_API_KEY is not set' }, { status: 500 });

  const b = await req.json().catch(() => null) as SendBody | null;
  const subject = String(b?.subject || '').trim();
  const body = String(b?.body || '');
  if (!subject || !body.trim()) return NextResponse.json({ error: 'Subject and message are required' }, { status: 400 });
  const userIds = Array.from(new Set((b?.userIds || []).map(String))).slice(0, MAX_RECIPIENTS + 1);
  if (userIds.length === 0) return NextResponse.json({ error: 'No recipients selected' }, { status: 400 });
  if (userIds.length > MAX_RECIPIENTS) return NextResponse.json({ error: `Max ${MAX_RECIPIENTS} recipients per send` }, { status: 400 });

  const showLookups = b?.showLookups !== false;
  const ctaUrl = b?.ctaUrl && /^https?:\/\//i.test(b.ctaUrl) ? b.ctaUrl : null;
  const siteUrl = getEmailSiteUrl();
  const replyTo = process.env.SALES_REPLY_TO || me.email || undefined;

  // Recompute every recipient server-side — the client's list only picks
  // WHO, never what we know about them.
  const { leads } = await loadSalesLeads(svc);
  const byId = new Map(leads.map((l) => [l.id, l]));

  const render = (lead: SalesLead, lookups: any[]) => {
    const vars = mergeVars(lead);
    return salesEmailTemplate({
      subject: applyMergeTags(subject, vars),
      body: applyMergeTags(body, vars),
      ctaLabel: b?.ctaLabel ? applyMergeTags(b.ctaLabel, vars) : null,
      ctaUrl,
      showLookups,
      lookups,
      recipientEmail: lead.email,
      siteUrl,
    });
  };

  // Test: render for one real recipient, deliver only to the admin.
  if (b?.test) {
    const lead = byId.get(String(b.previewUserId || userIds[0])) || byId.get(userIds[0]);
    if (!lead || !me.email) return NextResponse.json({ error: 'Recipient not found' }, { status: 400 });
    const lookups = showLookups ? (await loadEmailLookups(svc, [lead])).get(lead.id) || [] : [];
    const tpl = render(lead, lookups);
    try {
      await sendEmail({ to: me.email, subject: `[Test → ${lead.email}] ${tpl.subject}`, html: tpl.html, replyTo, kind: 'other' });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'Test send failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, test: true, to: me.email });
  }

  // Exclusions: opted out (account flag or Resend unsubscribe list) and
  // anyone who got a Sales email inside the cooldown window.
  const cooldownDays = Math.max(0, Math.min(90, Number(b?.cooldownDays ?? 3)));
  const cooldownIso = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000).toISOString();
  const contacts = await listContacts();
  const resendUnsub = new Set(contacts.contacts.filter((c) => c.unsubscribed).map((c) => c.email));

  const recipients: SalesLead[] = [];
  const skipReasons: Record<string, number> = {};
  const skip = (r: string) => { skipReasons[r] = (skipReasons[r] || 0) + 1; };
  for (const id of userIds) {
    const lead = byId.get(id);
    if (!lead) { skip('not-found'); continue; }
    if (lead.unsubscribed || resendUnsub.has(lead.email.toLowerCase())) { skip('unsubscribed'); continue; }
    if (cooldownDays > 0 && lead.lastEmailedAt && lead.lastEmailedAt > cooldownIso) { skip('recently-emailed'); continue; }
    recipients.push(lead);
  }
  const skipped = userIds.length - recipients.length;
  if (recipients.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, failed: 0, skipped, skipReasons });
  }

  const { data: campaign, error: campErr } = await svc.from('sales_campaigns').insert({
    subject, body, cta_label: b?.ctaLabel || null, cta_url: ctaUrl, show_lookups: showLookups,
    audience: String(b?.audience || `${userIds.length} selected`).slice(0, 200),
    status: 'sending', recipients: recipients.length, skipped, skip_reasons: skipReasons, created_by: me.email,
  }).select('id').single();
  if (campErr || !campaign) {
    return NextResponse.json({ error: campErr?.message || 'Could not create campaign — is the sales_campaigns table there?' }, { status: 500 });
  }

  const lookupsByUser = showLookups ? await loadEmailLookups(svc, recipients) : new Map();
  const from = process.env.RESEND_FROM || 'Haulock <onboarding@resend.dev>';
  const sendRows: any[] = [];
  const logRows: any[] = [];
  let sent = 0, failed = 0;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const chunk = recipients.slice(i, i + BATCH_SIZE);
    const emails = chunk.map((lead) => {
      const tpl = render(lead, lookupsByUser.get(lead.id) || []);
      const unsub = unsubscribeUrl(lead.email);
      return {
        from, to: lead.email, subject: tpl.subject, html: tpl.html, replyTo,
        headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        tags: [{ name: 'campaign', value: campaign.id }],
      };
    });
    const now = new Date().toISOString();
    try {
      const { data, error } = await resend.batch.send(emails as any);
      if (error) throw new Error(error.message);
      const ids: any[] = (data as any)?.data || [];
      chunk.forEach((lead, j) => {
        sendRows.push({ campaign_id: campaign.id, user_id: lead.id, email: lead.email, status: 'sent', resend_id: ids[j]?.id || null, sent_at: now });
        logRows.push({ to_email: lead.email.toLowerCase(), subject: emails[j].subject, kind: 'sales', resend_id: ids[j]?.id || null, sent_at: now });
      });
      sent += chunk.length;
    } catch (e: any) {
      chunk.forEach((lead) => sendRows.push({ campaign_id: campaign.id, user_id: lead.id, email: lead.email, status: 'failed', error: String(e?.message || 'send failed').slice(0, 500), sent_at: now }));
      failed += chunk.length;
    }
    if (i + BATCH_SIZE < recipients.length) await new Promise((r) => setTimeout(r, BATCH_GAP_MS));
  }

  // Bookkeeping is best-effort — the emails are already out.
  try {
    if (sendRows.length) await svc.from('sales_campaign_sends').insert(sendRows);
    if (logRows.length) await svc.from('email_log').insert(logRows);
    const sentIds = sendRows.filter((r) => r.status === 'sent').map((r) => r.user_id);
    if (sentIds.length) {
      // Move untouched leads to "contacted"; keep any stage set by hand.
      const { data: existing } = await svc.from('sales_leads').select('user_id, stage').in('user_id', sentIds);
      const stageOf = new Map((existing || []).map((r: any) => [r.user_id, r.stage]));
      const nowIso = new Date().toISOString();
      await svc.from('sales_leads').upsert(sentIds.map((id) => ({
        user_id: id,
        stage: !stageOf.get(id) || stageOf.get(id) === 'new' ? 'contacted' : stageOf.get(id),
        last_contacted_at: nowIso,
        updated_by: me.email,
        updated_at: nowIso,
      })), { onConflict: 'user_id' });
    }
  } catch (e) {
    console.warn('[sales-campaign] bookkeeping failed (non-fatal)', e);
  }
  await svc.from('sales_campaigns').update({
    status: sent > 0 ? 'sent' : 'failed', sent, failed, finished_at: new Date().toISOString(),
  }).eq('id', campaign.id);

  return NextResponse.json({ ok: true, campaignId: campaign.id, sent, failed, skipped, skipReasons });
}
