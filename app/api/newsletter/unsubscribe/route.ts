import { NextResponse } from 'next/server';
import { setSubscribed } from '@/lib/resend-audience';
import { verifyUnsubscribeToken } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Both GET and POST do the same thing — set the recipient's `unsubscribed`
// flag in Resend to true. POST is what RFC 8058 (one-click List-Unsubscribe)
// uses; GET is what a human clicks from the email footer or the browser
// when they visit the URL directly.

async function unsubscribe(email: string): Promise<{ ok: boolean; error?: string }> {
  const r = await setSubscribed(email, false);
  return r;
}

function htmlPage({ ok, email, error }: { ok: boolean; email: string; error?: string }): string {
  const heading = ok ? 'You&rsquo;re unsubscribed.' : 'Could not unsubscribe.';
  const body = ok
    ? `<p style="margin:0 0 16px 0;">We&rsquo;ve removed <strong>${escape(email)}</strong> from the Haulock fraud briefing. You&rsquo;ll stop receiving the weekly newsletter immediately.</p>
       <p style="margin:0 0 0 0;">Account-related emails (login alerts, billing receipts, high-risk lookups you triggered) are not affected. You can manage all email preferences from <a href="https://haulock.com/settings" style="color:#0B1E3F;text-decoration:underline;">your account settings</a>.</p>`
    : `<p style="margin:0 0 16px 0;">${escape(error || 'The link is invalid or has expired.')}</p>
       <p style="margin:0;">If you think this is a mistake, reply to any Haulock email and we&rsquo;ll sort it out by hand.</p>`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Haulock · Unsubscribe</title>
</head>
<body style="margin:0;padding:0;background:#F5F3EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0B1E3F;">
<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px 16px;">
  <div style="max-width:520px;width:100%;background:#fff;border:1px solid rgba(11,30,63,0.08);border-radius:16px;padding:40px;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
      <div style="width:36px;height:36px;background:#0B1E3F;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#FF6B35;font-weight:800;">H</div>
      <span style="font-size:18px;font-weight:700;letter-spacing:-0.01em;">Haulock</span>
    </div>
    <h1 style="margin:0 0 16px 0;font-size:26px;line-height:1.2;font-weight:600;letter-spacing:-0.01em;">${heading}</h1>
    <div style="font-size:15px;line-height:1.65;color:rgba(11,30,63,0.75);">${body}</div>
  </div>
</div>
</body></html>`;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = (searchParams.get('email') || '').trim().toLowerCase();
  const token = (searchParams.get('t') || '').trim();
  if (!email || !token || !verifyUnsubscribeToken(email, token)) {
    return new NextResponse(htmlPage({ ok: false, email: email || 'this email', error: 'The unsubscribe link is invalid or has expired.' }), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  const r = await unsubscribe(email);
  if (!r.ok) {
    return new NextResponse(htmlPage({ ok: false, email, error: r.error || 'Could not update your subscription right now.' }), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  return new NextResponse(htmlPage({ ok: true, email }), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function POST(req: Request) {
  // Gmail/Outlook one-click POST. Same auth check, JSON response so the
  // mail client can record the result.
  const { searchParams } = new URL(req.url);
  const email = (searchParams.get('email') || '').trim().toLowerCase();
  const token = (searchParams.get('t') || '').trim();
  if (!email || !token || !verifyUnsubscribeToken(email, token)) {
    return NextResponse.json({ error: 'invalid-token' }, { status: 400 });
  }
  const r = await unsubscribe(email);
  if (!r.ok) return NextResponse.json({ error: r.error || 'unsubscribe-failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
