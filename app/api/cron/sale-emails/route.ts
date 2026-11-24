import { NextResponse } from 'next/server';
import { enforcedPlanId } from '@/lib/plans';
import { authorizeCronOrAdmin } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/service';
import { getEmailSiteUrl, isResendConfigured, recentlySentTo, saleEarlyEmailTemplate, saleEmailTemplate, sendEmailBatch } from '@/lib/email';
import { dueSaleEmail, SALE_EMAILS } from '@/lib/promo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Black Friday / Cyber Monday emails (lib/promo.ts SALE_EMAILS). Runs hourly;
// does nothing unless one of the emails is due. Each goes once to:
//   - Free users (own plan, and not on a paying team)
//   - with a confirmed email
//   - who haven't turned marketing email off (notify_fraud_trends, the same
//     switch the weekly nurture respects)
//   - and haven't had this email yet (email_log kind), so retries and the
//     following hours never send it twice.
// ?dryRun=1 counts recipients without sending. An admin can force a stage
// with ?stage=bf-launch (still only to the same audience, once).

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  const denied = await authorizeCronOrAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === '1';
  const forced = url.searchParams.get('stage');
  const due = forced ? SALE_EMAILS.find((e) => e.stage === forced) || null : dueSaleEmail();
  if (!due) return NextResponse.json({ ok: true, skipped: 'no sale email due' });

  if (!isResendConfigured()) return NextResponse.json({ skipped: 'Resend not configured' });
  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const users: any[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < 1000) break;
  }
  const { data: memberRows } = await svc.from('team_members').select('user_id, teams ( plan )');
  const teamPlan = new Map<string, string>();
  for (const m of (memberRows || []) as any[]) {
    const t = Array.isArray(m.teams) ? m.teams[0] : m.teams;
    if (t?.plan) teamPlan.set(m.user_id, t.plan);
  }
  const already = await recentlySentTo(due.kind, '2026-01-01T00:00:00Z');

  const siteUrl = getEmailSiteUrl();
  const skips: Record<string, number> = {};
  const skip = (r: string) => { skips[r] = (skips[r] || 0) + 1; };
  const items: { to: string; subject: string; html: string; kind: typeof due.kind }[] = [];
  for (const u of users) {
    if (!u?.email) { skip('no-email'); continue; }
    const email = String(u.email).toLowerCase();
    const meta = u.user_metadata || {};
    if ((teamPlan.get(u.id) || enforcedPlanId(u)) !== 'free') { skip('paid-plan'); continue; }
    if (!u.email_confirmed_at) { skip('email-not-confirmed'); continue; }
    if (meta.notify_fraud_trends === false) { skip('opted-out'); continue; }
    if (already.has(email)) { skip('already-sent'); continue; }
    const firstName = String(meta.full_name || meta.name || '').trim().split(/\s+/)[0] || '';
    const tpl = due.stage === 'early-launch'
      ? saleEarlyEmailTemplate({ firstName, recipientEmail: u.email, siteUrl })
      : saleEmailTemplate({ stage: due.stage, firstName, recipientEmail: u.email, siteUrl });
    items.push({ to: u.email, subject: tpl.subject, html: tpl.html, kind: due.kind });
  }

  if (dryRun) return NextResponse.json({ ok: true, dryRun, stage: due.stage, recipients: items.length, skips });
  const res = await sendEmailBatch(items);
  return NextResponse.json({ ok: true, stage: due.stage, recipients: items.length, ...res, skips });
}
