import { NextResponse } from 'next/server';
import { sendEmail, welcomeTemplate, isResendConfigured } from '@/lib/email';
import { getServerSupabase } from '@/lib/supabase/server';
import { addOrUpdateContact, isAudienceConfigured } from '@/lib/resend-audience';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  if (!isResendConfigured()) {
    return NextResponse.json({ skipped: 'RESEND_API_KEY not set' }, { status: 200 });
  }

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user?.email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const name = (user.user_metadata?.full_name || user.user_metadata?.name || '') as string;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://haulock.com';
  const { subject, html } = welcomeTemplate({ name, siteUrl, recipientEmail: user.email });

  // Add to the Resend Audience as part of signup so the user can receive
  // newsletters. Respects their `notify_fraud_trends` flag (defaults to ON
  // for new accounts) — flipping it off later will sync `unsubscribed=true`
  // via the settings flow. This call is best-effort; any failure is logged
  // inside the helper and never blocks the welcome email.
  if (isAudienceConfigured()) {
    const meta = user.user_metadata || {};
    const wantsNewsletter = meta.notify_fraud_trends !== false;
    const [firstName, ...rest] = (name || '').trim().split(/\s+/);
    addOrUpdateContact({
      email: user.email,
      firstName: firstName || null,
      lastName: rest.length ? rest.join(' ') : null,
      unsubscribed: !wantsNewsletter,
    }).catch(() => { /* logged inside helper */ });
  }

  try {
    const sent = await sendEmail({ to: user.email, subject, html, kind: 'welcome' });
    return NextResponse.json({ ok: true, id: sent?.id ?? null });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Send failed' }, { status: 500 });
  }
}
