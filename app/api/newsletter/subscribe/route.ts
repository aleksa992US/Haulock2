import { NextResponse } from 'next/server';
import { addOrUpdateContact, isAudienceConfigured } from '@/lib/resend-audience';
import { sendEmail, newsletterWelcomeTemplate, isResendConfigured } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public, anonymous newsletter signup. No auth required — anyone visiting
// the landing page can drop their email here. Resend's Audience handles
// dedupe + unsubscribe links, so we don't need our own subscribers table.
export async function POST(req: Request) {
  if (!isAudienceConfigured()) {
    return NextResponse.json(
      { error: 'Newsletter is not configured yet. Check back soon.' },
      { status: 503 },
    );
  }
  // Note: this only requires RESEND_API_KEY now — Resend Contacts work at
  // the account level for this account, no audience needed.

  const body = await req.json().catch(() => null) as { email?: string; firstName?: string; lastName?: string } | null;
  const email = (body?.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }

  // Cheap origin check — don't accept signups from random callers, just
  // browsers hitting our site. This isn't a security boundary, just spam
  // friction.
  const origin = req.headers.get('origin') || '';
  const referer = req.headers.get('referer') || '';
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '');
  if (siteUrl && origin && !origin.startsWith(siteUrl) && !referer.startsWith(siteUrl)) {
    // In dev (NEXT_PUBLIC_SITE_URL is haulock.com but you're on localhost),
    // skip the check rather than block local testing.
    if (!/localhost|127\.0\.0\.1/.test(origin) && !/localhost|127\.0\.0\.1/.test(referer)) {
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    }
  }

  const result = await addOrUpdateContact({
    email,
    firstName: body?.firstName || null,
    lastName: body?.lastName || null,
    unsubscribed: false,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error || 'Subscribe failed. Try again in a minute.' }, { status: 500 });
  }

  // Only fire the welcome email on a true first signup. Re-submits from
  // people who are already on the list shouldn't re-receive the welcome.
  if (isResendConfigured() && !result.alreadyExisted) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://haulock.com';
    const { subject, html } = newsletterWelcomeTemplate({ email, siteUrl });
    sendEmail({ to: email, subject, html, kind: 'newsletter' }).catch((err) => {
      console.warn('[api/newsletter/subscribe] welcome email failed:', err?.message);
    });
  }

  return NextResponse.json({ ok: true, alreadyExisted: Boolean(result.alreadyExisted) });
}
