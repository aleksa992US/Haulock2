import { NextResponse } from 'next/server';
import { sendEmail, welcomeTemplate, isResendConfigured } from '@/lib/email';
import { getServerSupabase } from '@/lib/supabase/server';

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
  const { subject, html } = welcomeTemplate({ name, siteUrl });

  try {
    const sent = await sendEmail({ to: user.email, subject, html });
    return NextResponse.json({ ok: true, id: sent?.id ?? null });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Send failed' }, { status: 500 });
  }
}
