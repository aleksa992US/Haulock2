import { NextResponse } from 'next/server';
import { sendEmail, highRiskAlertTemplate, isResendConfigured, type AlertReport } from '@/lib/email';
import { getServerSupabase } from '@/lib/supabase/server';
import { checkSimpleRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!isResendConfigured()) {
    return NextResponse.json({ skipped: 'RESEND_API_KEY not set' }, { status: 200 });
  }

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user?.email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  // The report comes from the client and notification_email isn't verified,
  // so cap how often one account can trigger this email.
  const rl = checkSimpleRateLimit({ bucket: 'high-risk-alert', identity: user.id, max: 10, windowMs: 60 * 60_000 });
  if (!rl.ok) return NextResponse.json({ skipped: 'rate_limited' }, { status: 429 });

  const body = await req.json().catch(() => null) as { report?: AlertReport } | null;
  const report = body?.report;
  if (!report || typeof report.name !== 'string' || typeof report.score !== 'number') {
    return NextResponse.json({ error: 'Invalid report payload' }, { status: 400 });
  }
  if (report.verdict !== 'high') {
    return NextResponse.json({ skipped: 'Not high risk' }, { status: 200 });
  }

  // Delivery preference: notification_email overrides profile email if set.
  const meta = user.user_metadata || {};
  // Respect the per-user toggle from /settings → Notifications. Default ON
  // (only `false` opts out) so existing users keep getting alerts unless they
  // explicitly disable them.
  if (meta.notify_high_risk === false) {
    return NextResponse.json({ skipped: 'High-risk alerts disabled by user' }, { status: 200 });
  }
  const override = typeof meta.notification_email === 'string' ? meta.notification_email.trim() : '';
  const toAddress = override || user.email;

  const { getEmailSiteUrl } = await import('@/lib/email');
  const siteUrl = getEmailSiteUrl();
  const { subject, html } = highRiskAlertTemplate({ report, siteUrl });

  try {
    const sent = await sendEmail({ to: toAddress, subject, html, kind: 'high_risk_alert' });
    return NextResponse.json({ ok: true, id: sent?.id ?? null, sentTo: toAddress });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Send failed' }, { status: 500 });
  }
}
