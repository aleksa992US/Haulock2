import { NextResponse } from 'next/server';
import { setSubscribed } from '@/lib/resend-audience';
import { verifyUnsubscribeToken } from '@/lib/email';
import { getServiceSupabase } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Both GET and POST do the same thing — set the recipient's `unsubscribed`
// flag in Resend to true. POST is what RFC 8058 (one-click List-Unsubscribe)
// uses; GET is what a human clicks from the email footer or the browser
// when they visit the URL directly.

// The Resend flag alone only stopped the newsletter and Sales: the weekly
// digest, nurture and cart emails read the account's notify_* settings, and
// saving Settings copied notify_fraud_trends (still on) back to Resend,
// re-subscribing the person. So also turn those settings off on every
// account using this address. Watchlist and safety alerts the user set up
// stay on; they're managed in Settings.
async function unsubscribe(email: string): Promise<{ ok: boolean; error?: string }> {
  // The account settings are what our senders check, so they're written
  // first and don't depend on Resend. Resend's contact flag is best-effort:
  // a send-only Resend key can't edit contacts, and that used to make every
  // unsubscribe link fail with "Could not unsubscribe".
  let matched = 0;
  let accountError: string | null = null;
  const svc = getServiceSupabase();
  if (svc) {
    try {
      for (let page = 1; ; page += 1) {
        const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        const batch = data?.users || [];
        for (const u of batch) {
          const meta: any = u.user_metadata || {};
          const notifyTo = typeof meta.notification_email === 'string' ? meta.notification_email.trim().toLowerCase() : '';
          if ((u.email || '').toLowerCase() !== email && notifyTo !== email) continue;
          matched += 1;
          if (meta.notify_fraud_trends === false && meta.notify_weekly_digest === false) continue;
          const { error: updErr } = await svc.auth.admin.updateUserById(u.id, {
            user_metadata: { ...meta, notify_fraud_trends: false, notify_weekly_digest: false },
          });
          if (updErr) throw updErr;
        }
        if (batch.length < 1000) break;
      }
    } catch (err: any) {
      accountError = err?.message || 'Could not update your email settings right now.';
    }
  }
  const resend = await setSubscribed(email, false).catch(() => ({ ok: false }));
  if (!resend.ok) console.warn('[unsubscribe] Resend contact not updated', { email });
  if (accountError) return { ok: false, error: accountError };
  // An address with no account exists only as a Resend contact.
  if (matched === 0 && !resend.ok) return { ok: false, error: 'Could not update your subscription right now.' };
  return { ok: true };
}

function htmlPage({ ok, email, error, confirmQuery }: { ok: boolean; email: string; error?: string; confirmQuery?: string }): string {
  const heading = confirmQuery ? 'Unsubscribe from Haulock emails?' : ok ? 'You&rsquo;re unsubscribed.' : 'Could not unsubscribe.';
  const body = confirmQuery
    ? `<p style="margin:0 0 20px 0;">Stop the newsletter, weekly summary and offers for <strong>${escape(email)}</strong>.</p>
       <form method="POST" action="?${escape(confirmQuery)}" style="margin:0;">
         <input type="hidden" name="confirm" value="1">
         <button type="submit" style="background:#0B1E3F;color:#fff;border:0;border-radius:999px;padding:12px 22px;font-size:15px;font-weight:600;cursor:pointer;">Unsubscribe</button>
       </form>`
    : ok
    ? `<p style="margin:0 0 16px 0;">We&rsquo;ve removed <strong>${escape(email)}</strong> from the Haulock fraud briefing. You&rsquo;ll stop receiving our newsletter, weekly summary and offers immediately.</p>
       <p style="margin:0 0 0 0;">Account-related emails (login alerts, billing receipts, high-risk lookups you triggered) are not affected. You can manage all email preferences from <a href="https://haulock.com/settings" style="color:#0B1E3F;text-decoration:underline;">your account settings</a>.</p>`
    : `<p style="margin:0 0 16px 0;">${escape(error || 'The link is invalid or has expired.')}</p>
       <p style="margin:0;">You can also turn these emails off in <a href="https://haulock.com/settings" style="color:#0B1E3F;text-decoration:underline;">Settings → Notifications</a>, or reply &ldquo;unsubscribe&rdquo; to any Haulock email and we&rsquo;ll take you off by hand.</p>`;
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
  // Opening the link only asks: corporate mail scanners (Safe Links,
  // Mimecast) fetch every link in an email, and a GET that unsubscribed
  // took people off the list without them clicking anything.
  return new NextResponse(htmlPage({ ok: true, email, confirmQuery: searchParams.toString() }), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function POST(req: Request) {
  // Two callers: Gmail/Outlook one-click (RFC 8058, body
  // "List-Unsubscribe=One-Click") gets JSON; the confirm button on the
  // page above (body "confirm=1") gets the HTML result page.
  const { searchParams } = new URL(req.url);
  const email = (searchParams.get('email') || '').trim().toLowerCase();
  const token = (searchParams.get('t') || '').trim();
  const form = await req.formData().catch(() => null);
  const fromPage = form?.get('confirm') === '1';
  const html = (page: string, status = 200) => new NextResponse(page, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  if (!email || !token || !verifyUnsubscribeToken(email, token)) {
    return fromPage
      ? html(htmlPage({ ok: false, email: email || 'this email', error: 'The unsubscribe link is invalid or has expired.' }), 400)
      : NextResponse.json({ error: 'invalid-token' }, { status: 400 });
  }
  const r = await unsubscribe(email);
  if (fromPage) {
    return r.ok
      ? html(htmlPage({ ok: true, email }))
      : html(htmlPage({ ok: false, email, error: r.error || 'Could not update your subscription right now.' }), 500);
  }
  if (!r.ok) return NextResponse.json({ error: r.error || 'unsubscribe-failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
