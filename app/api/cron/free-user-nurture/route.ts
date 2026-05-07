import { NextResponse } from 'next/server';
import { authorizeCronOrAdmin } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/service';
import { sendEmail, nurtureFreeUserTemplate, isResendConfigured, getEmailSiteUrl } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Weekly nurture sequence for users still on the Free plan.
//
// Audience filter:
//   - plan is 'free' or unset
//   - email is confirmed (we don't pester ghost signups)
//   - notify_fraud_trends !== false (newsletter opt-in is on)
//   - account is at least 3 days old (give them time to convert organically)
//   - we haven't sent a 'nurture' kind email to this address in the last 6.5 days
//     (idempotent across cron retries; the 0.5-day buffer absorbs Vercel
//     scheduling drift)
//
// Cadence: rotates through three message angles via weekIndex, derived from
// the count of prior nurture sends to that user. Each iteration carries the
// same NEW20 promo code so all redemptions roll up under one Stripe code.

const PROMO_CODE = 'NEW20';
const COOLDOWN_DAYS = 6.5;

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  const denied = await authorizeCronOrAdmin(req);
  if (denied) return denied;

  if (!isResendConfigured()) {
    return NextResponse.json({ skipped: 'Resend not configured' }, { status: 200 });
  }

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === '1';
  const siteUrl = getEmailSiteUrl();
  const upgradeUrl = `${siteUrl}/checkout/carrier?promoCode=${PROMO_CODE}`;

  // Pull every user. Vercel + Supabase Auth caps listUsers at 1000/page,
  // which is plenty for the foreseeable future. If we ever exceed that we'll
  // need to paginate.
  const { data: usersData, error: usersErr } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersErr) return NextResponse.json({ error: usersErr.message }, { status: 500 });
  const users = usersData?.users || [];

  const cooldownIso = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const minAgeIso = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  // Pull the email_log nurture history once and group by recipient — cheaper
  // than N queries.
  const { data: logRows } = await svc
    .from('email_log')
    .select('to_email, sent_at')
    .eq('kind', 'nurture')
    .order('sent_at', { ascending: false });
  const nurtureLog = new Map<string, { count: number; lastAt: string | null }>();
  for (const r of (logRows || []) as any[]) {
    const key = String(r.to_email || '').toLowerCase();
    if (!key) continue;
    const entry = nurtureLog.get(key) || { count: 0, lastAt: null };
    entry.count += 1;
    if (!entry.lastAt || r.sent_at > entry.lastAt) entry.lastAt = r.sent_at;
    nurtureLog.set(key, entry);
  }

  let attempted = 0;
  let sent = 0;
  let skipped = 0;
  const skipReasons: Record<string, number> = {};
  const skip = (reason: string) => {
    skipped += 1;
    skipReasons[reason] = (skipReasons[reason] || 0) + 1;
  };

  for (const u of users as any[]) {
    if (!u?.email) { skip('no-email'); continue; }
    const email = String(u.email).toLowerCase();
    const meta = u.user_metadata || {};
    const plan = meta.plan || 'free';

    if (plan !== 'free') { skip('paid-plan'); continue; }
    if (!u.email_confirmed_at) { skip('email-not-confirmed'); continue; }
    if (u.created_at && u.created_at > minAgeIso) { skip('too-new'); continue; }
    if (meta.notify_fraud_trends === false) { skip('opted-out'); continue; }

    const log = nurtureLog.get(email) || { count: 0, lastAt: null };
    if (log.lastAt && log.lastAt > cooldownIso) { skip('cooldown'); continue; }

    const fullName: string = meta.full_name || meta.name || '';
    const firstName = fullName.trim().split(/\s+/)[0] || '';
    const tpl = nurtureFreeUserTemplate({
      firstName,
      promoCode: PROMO_CODE,
      upgradeUrl,
      recipientEmail: u.email,
      weekIndex: log.count,
    });

    attempted += 1;
    if (dryRun) continue;

    try {
      await sendEmail({
        to: u.email,
        subject: tpl.subject,
        html: tpl.html,
        kind: 'nurture',
      });
      sent += 1;
    } catch (err: any) {
      console.warn('[free-user-nurture] send failed', { email, message: err?.message });
      skip('send-failed');
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    totalUsers: users.length,
    attempted,
    sent,
    skipped,
    skipReasons,
  });
}
