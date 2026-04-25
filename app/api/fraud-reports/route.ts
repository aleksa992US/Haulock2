import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { sendEmail, communityReportTemplate, isResendConfigured } from '@/lib/email';
import { checkSimpleRateLimit, identityFromRequest } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = ['non_payment', 'double_broker', 'identity_fraud', 'fake_load', 'other'];

// Notify every Haulock user who has interacted with this broker (looked
// up in the last 30 days OR has it on their watchlist) and has community
// alerts turned on. Best-effort: failures are logged, never thrown.
async function notifyCommunityWatchers(report: { id: string; reporter_user_id: string; mc?: string | null; dot?: string | null; name: string; type: string; amount: number | null; description: string | null }): Promise<void> {
  if (!isResendConfigured()) return;
  if (!report.mc && !report.dot) return;
  const svc = getServiceSupabase();
  if (!svc) return;

  try {
    const sinceLookup = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    type Hit = { user_id: string; reason: 'looked-up' | 'watching' };
    const hits = new Map<string, Hit>();

    // Watchlist matches.
    {
      const orParts: string[] = [];
      if (report.mc) orParts.push(`mc.eq.${report.mc}`);
      if (report.dot) orParts.push(`dot.eq.${report.dot}`);
      if (orParts.length > 0) {
        const { data } = await svc.from('watchlist').select('user_id').or(orParts.join(','));
        for (const row of data || []) {
          if (row.user_id === report.reporter_user_id) continue;
          hits.set(row.user_id, { user_id: row.user_id, reason: 'watching' });
        }
      }
    }
    // Lookup matches in the past 30 days.
    {
      const orParts: string[] = [];
      if (report.mc) orParts.push(`mc.eq.${report.mc}`);
      if (report.dot) orParts.push(`dot.eq.${report.dot}`);
      if (orParts.length > 0) {
        const { data } = await svc.from('lookups')
          .select('user_id')
          .or(orParts.join(','))
          .is('hidden_at', null)
          .gte('created_at', sinceLookup);
        for (const row of data || []) {
          if (row.user_id === report.reporter_user_id) continue;
          if (!hits.has(row.user_id)) hits.set(row.user_id, { user_id: row.user_id, reason: 'looked-up' });
        }
      }
    }

    if (hits.size === 0) return;

    // Resolve user emails + the notify_community preference for the recipient set.
    const ids = Array.from(hits.keys());
    const { data: usersPage } = await svc.auth.admin.listUsers({ perPage: 1000 });
    const idToUser = new Map<string, { email: string; notifyOn: boolean; notificationEmail: string | null }>();
    for (const u of usersPage?.users || []) {
      if (!ids.includes(u.id)) continue;
      const meta = (u.user_metadata || {}) as any;
      idToUser.set(u.id, {
        email: u.email || '',
        notifyOn: meta.notify_community !== false,
        notificationEmail: typeof meta.notification_email === 'string' && meta.notification_email.trim() ? meta.notification_email.trim() : null,
      });
    }

    const { getEmailSiteUrl } = await import('@/lib/email');
    const siteUrl = getEmailSiteUrl();
    for (const hit of hits.values()) {
      const u = idToUser.get(hit.user_id);
      if (!u?.email || !u.notifyOn) continue;
      const toAddress = u.notificationEmail || u.email;
      try {
        const { subject, html } = communityReportTemplate({
          report: { name: report.name, mc: report.mc, dot: report.dot, type: report.type, description: report.description, amount: report.amount },
          reason: hit.reason,
          recipientEmail: toAddress,
          siteUrl,
        });
        await sendEmail({ to: toAddress, subject, html, kind: 'newsletter' });
        // Polite spacing for Resend's free-tier rate limit.
        await new Promise((r) => setTimeout(r, 400));
      } catch (err: any) {
        console.warn('[fraud-reports] community notify send failed', { to: toAddress, message: err?.message });
      }
    }
  } catch (err: any) {
    console.warn('[fraud-reports] community notify failed', { message: err?.message });
  }
}

export async function GET(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const mc = searchParams.get('mc');
  const dot = searchParams.get('dot');
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);

  let query = supabase
    .from('fraud_reports')
    .select('id, mc, dot, name, type, amount, description, created_at, reporter_user_id')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (mc || dot) {
    const ors: string[] = [];
    if (mc) ors.push(`mc.eq.${mc}`);
    if (dot) ors.push(`dot.eq.${dot}`);
    query = query.or(ors.join(','));
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Anonymize reporter — never leak user_ids to other users.
  const reports = (data || []).map((r: any) => {
    const { reporter_user_id, ...rest } = r;
    return { ...rest, mine: reporter_user_id === user.id };
  });
  return NextResponse.json({ reports });
}

export async function POST(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  // Per-user rate limit. 10 fraud reports / 10 min is far above what any
  // legitimate user files; stops a malicious account from spamming the
  // community feed or burning the email-notify queue.
  const rl = checkSimpleRateLimit({
    bucket: 'fraud-report',
    identity: identityFromRequest(req, user.id),
    max: 10,
    windowMs: 10 * 60_000,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many fraud reports submitted. Slow down and try again in a minute.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  const body = await req.json().catch(() => null) as any;
  if (!body || typeof body.name !== 'string' || (!body.mc && !body.dot)) {
    return NextResponse.json({ error: 'Need at least a name and an MC or DOT' }, { status: 400 });
  }
  const type = ALLOWED_TYPES.includes(body.type) ? body.type : 'other';
  const amount = body.amount != null && body.amount !== '' ? Number(body.amount) : null;
  if (amount != null && (isNaN(amount) || amount < 0)) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
  }

  const row = {
    reporter_user_id: user.id,
    mc: body.mc || null,
    dot: body.dot || null,
    name: String(body.name).slice(0, 200),
    type,
    amount,
    description: body.description ? String(body.description).slice(0, 2000) : null,
  };

  const { data, error } = await supabase.from('fraud_reports').insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fire-and-forget community notify. We never await — the user's "report
  // submitted" UX shouldn't wait for outbound emails.
  notifyCommunityWatchers({
    id: data.id,
    reporter_user_id: user.id,
    mc: row.mc,
    dot: row.dot,
    name: row.name,
    type: row.type,
    amount: row.amount,
    description: row.description,
  }).catch(() => {});

  return NextResponse.json({ report: data });
}

export async function DELETE(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const { error } = await supabase.from('fraud_reports').delete().eq('id', id).eq('reporter_user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
