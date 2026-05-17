import { NextResponse } from 'next/server';
import { sendEmail, affiliateApplicationTemplate, isResendConfigured } from '@/lib/email';
import { checkSimpleRateLimit, identityFromRequest } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const APPLICATION_INBOX = process.env.AFFILIATE_NOTIFY_EMAIL || 'marketing@viceseo.com';

// Public endpoint — anyone visiting /affiliate can submit. We rate-limit by
// IP/identity to avoid spam, and we keep it intentionally email-only (no DB
// table) per product decision: operator reviews each application in the inbox
// and creates the user manually.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as {
    name?: string;
    email?: string;
    audience?: string;
    audienceSize?: string;
    social?: string;
    message?: string;
    source?: string;
  } | null;

  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const audience = (body.audience || '').trim();
  const audienceSize = (body.audienceSize || '').trim();
  const social = (body.social || '').trim().slice(0, 1000);
  const message = (body.message || '').trim();
  const source = (body.source || '').trim();

  if (!name) return NextResponse.json({ error: 'Please tell us your name.' }, { status: 400 });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }
  if (!message || message.length < 20) {
    return NextResponse.json({ error: 'Tell us a little about how you plan to promote Haulock — at least 20 characters.' }, { status: 400 });
  }

  // Rate limit: 5 submissions per IP per hour. Stops the obvious spam loops
  // without blocking a couple of real applicants on the same office network.
  const identity = identityFromRequest(req);
  const rl = checkSimpleRateLimit({
    bucket: 'affiliate-apply',
    identity,
    max: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many applications from this network. Try again later or email us directly.', code: 'rate_limited', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  if (!isResendConfigured()) {
    // Don't pretend to succeed when we can't actually send.
    return NextResponse.json({ error: 'Email is not configured — please email marketing@viceseo.com directly.' }, { status: 503 });
  }

  const tpl = affiliateApplicationTemplate({ name, email, audience, audienceSize, social, message, source });
  try {
    await sendEmail({
      to: APPLICATION_INBOX,
      subject: tpl.subject,
      html: tpl.html,
      // Reply-to the applicant so the operator can reply directly from the inbox.
      replyTo: email,
      kind: 'other',
    });
  } catch (err: any) {
    console.error('[affiliate/apply] send failed', err?.message);
    return NextResponse.json({ error: 'Could not send your application. Please try again or email marketing@viceseo.com.' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
