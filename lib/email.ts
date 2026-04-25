import { Resend } from 'resend';
import { createHmac } from 'crypto';

let cached: Resend | null = null;

function getResend(): Resend | null {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  cached = new Resend(key);
  return cached;
}

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

// HMAC-signed unsubscribe URL. We don't store per-recipient tokens — the
// signature alone proves "this URL came from us" so Gmail/Outlook clicks
// and human clicks both verify the same way. Falls back to RESEND_API_KEY
// as the secret so it works out of the box; set EMAIL_UNSUB_SECRET to
// rotate without invalidating Resend keys.
function unsubSecret(): string {
  return process.env.EMAIL_UNSUB_SECRET || process.env.RESEND_API_KEY || 'haulock-unsub-fallback';
}

export function buildUnsubscribeToken(email: string): string {
  return createHmac('sha256', unsubSecret())
    .update(email.trim().toLowerCase())
    .digest('hex')
    .slice(0, 32);
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = buildUnsubscribeToken(email);
  // Constant-ish-time compare — both are 32-char hex.
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export function unsubscribeUrl(email: string): string {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://haulock.com').replace(/\/+$/, '');
  const e = encodeURIComponent(email.trim().toLowerCase());
  const t = buildUnsubscribeToken(email);
  return `${site}/api/newsletter/unsubscribe?email=${e}&t=${t}`;
}

export type SendAttachment = { filename: string; content: Buffer | Uint8Array; contentType?: string };
export type SendArgs = {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: SendAttachment[];
  // `kind` tags the send so the admin newsletter dashboard can show counts
  // per type per recipient. Optional — old call sites stay legal.
  kind?: 'welcome' | 'high_risk_alert' | 'report_share' | 'newsletter' | 'team_invite' | 'other';
};

export async function sendEmail({ to, subject, html, replyTo, attachments, kind }: SendArgs) {
  const resend = getResend();
  if (!resend) throw new Error('RESEND_API_KEY is not set');
  const from = process.env.RESEND_FROM || 'Haulock <onboarding@resend.dev>';
  const resendAttachments = attachments?.map((a) => ({
    filename: a.filename,
    content: Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content),
    contentType: a.contentType,
  }));

  // List-Unsubscribe + one-click compliance for Gmail/Outlook. We only set
  // these for single-recipient sends (the standard expects one URL per
  // recipient). Multi-recipient transactional sends are rare in this app
  // and we don't want a single token to opt out an unrelated person.
  const recipients = Array.isArray(to) ? to : [to];
  const headers: Record<string, string> = {};
  if (recipients.length === 1) {
    const url = unsubscribeUrl(recipients[0]);
    headers['List-Unsubscribe'] = `<${url}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  const { data, error } = await resend.emails.send({
    from, to, subject, html, replyTo,
    attachments: resendAttachments as any,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  });
  if (error) throw new Error(error.message || 'Resend send failed');

  // Best-effort persistent log so the admin newsletter tab can show
  // "emails received per contact". Lazy-import the service client so
  // this file doesn't pull supabase in environments that don't need it.
  try {
    const recipients = Array.isArray(to) ? to : [to];
    const recipientsClean = recipients.map((r) => String(r).trim().toLowerCase()).filter(Boolean);
    if (recipientsClean.length > 0) {
      const { getServiceSupabase } = await import('@/lib/supabase/service');
      const svc = getServiceSupabase();
      if (svc) {
        const sentAt = new Date().toISOString();
        const rows = recipientsClean.map((email) => ({
          to_email: email,
          subject,
          kind: kind || 'other',
          resend_id: (data as any)?.id || null,
          sent_at: sentAt,
        }));
        await svc.from('email_log').insert(rows);
      }
    }
  } catch (err) {
    console.warn('[email] email_log insert failed (non-fatal):', err);
  }
  return data;
}

// ---------- Shared layout ----------

type LayoutArgs = {
  preview: string;
  body: string;
  // When set, renders a visible "Unsubscribe" link in the footer pointing
  // at the signed unsubscribe URL for this address. We pass the email
  // through (not the URL) so the layout can build a stable footer.
  unsubEmail?: string;
};

function baseLayout({ preview, body, unsubEmail }: LayoutArgs): string {
  const unsubBlock = unsubEmail
    ? `<br><a href="${unsubscribeUrl(unsubEmail)}" style="color:rgba(11,30,63,0.55);text-decoration:underline;">Unsubscribe</a>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background:#F5F3EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0B1E3F;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F3EE;">
  <tr><td align="center" style="padding:48px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;border:1px solid rgba(11,30,63,0.08);overflow:hidden;">
      <tr><td style="padding:32px 40px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="vertical-align:middle;">
              <div style="width:36px;height:36px;background:#0B1E3F;border-radius:8px;line-height:36px;text-align:center;">
                <span style="color:#FF6B35;font-weight:800;font-size:15px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">H</span>
              </div>
            </td>
            <td style="vertical-align:middle;padding-left:12px;">
              <span style="font-size:18px;font-weight:700;color:#0B1E3F;letter-spacing:-0.01em;">Haulock</span>
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:28px 40px 40px;">${body}</td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin-top:24px;">
      <tr><td align="center" style="padding:16px 24px;font-size:12px;color:rgba(11,30,63,0.5);line-height:1.7;">
        Haulock · Built for carriers who&rsquo;ve been burned.<br>
        You&rsquo;re receiving this because you have an account at <a href="https://haulock.com" style="color:rgba(11,30,63,0.7);text-decoration:underline;">haulock.com</a>.${unsubBlock}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function h1(text: string): string {
  return `<h1 style="margin:0 0 16px 0;font-size:28px;line-height:1.15;font-weight:600;letter-spacing:-0.01em;color:#0B1E3F;">${text}</h1>`;
}

function italicAccent(text: string): string {
  return `<span style="font-family:Georgia,'Times New Roman',serif;font-style:italic;color:#FF6B35;">${text}</span>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 20px 0;font-size:16px;line-height:1.65;color:rgba(11,30,63,0.75);">${text}</p>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 28px 0;">
  <tr><td style="border-radius:999px;background:#0B1E3F;">
    <a href="${href}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;border-radius:999px;">${label}</a>
  </td></tr>
</table>`;
}

function divider(): string {
  return `<div style="height:1px;background:rgba(11,30,63,0.08);margin:24px 0;"></div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// ---------- Templates: transactional from our app ----------

export function newsletterWelcomeTemplate({ email, siteUrl }: { email: string; siteUrl: string }): { subject: string; html: string } {
  const body = `
${h1(`You&rsquo;re on the list. Welcome to ${italicAccent('Haulock&rsquo;s')} fraud briefing.`)}
${p(`Every Thursday we&rsquo;ll send you a short read on what&rsquo;s happening in freight fraud right now: new identity tricks, the latest double-brokering patterns, rate con scams making the rounds, and what to watch for before you book.`)}
${p(`No fluff, no spam. One email a week. You can unsubscribe with one click any time.`)}
${button(siteUrl, 'Try Haulock free →')}
<div style="background:rgba(11,30,63,0.04);border-radius:12px;padding:20px;">
  <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:8px;">First briefing arrives</div>
  <div style="font-size:14px;line-height:1.6;color:rgba(11,30,63,0.8);">Next Thursday morning. Until then, you can verify any broker for free at <a href="${siteUrl}" style="color:#0B1E3F;text-decoration:underline;">haulock.com</a>.</div>
</div>`;
  return {
    subject: 'Welcome to the Haulock fraud briefing',
    html: baseLayout({ preview: 'Every Thursday: what fraud is hitting freight right now and what to watch for.', body, unsubEmail: email }),
  };
}

export function welcomeTemplate({ name, siteUrl, recipientEmail }: { name?: string; siteUrl: string; recipientEmail?: string }): { subject: string; html: string } {
  const greeting = name ? `Hi ${escapeHtml(name.split(' ')[0])},` : 'Welcome,';
  const body = `
${h1(`${greeting} welcome to ${italicAccent('Haulock')}.`)}
${p(`You can now verify any broker in seconds. We pull live FMCSA data — authority status, insurance, safety rating, address — and surface every red flag before you hook the trailer.`)}
${button(siteUrl, 'Verify your first broker →')}
<div style="background:rgba(11,30,63,0.04);border-radius:12px;padding:20px;">
  <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:8px;">Quick tip</div>
  <div style="font-size:14px;line-height:1.6;color:rgba(11,30,63,0.8);">Paste an MC number (e.g. <strong style="color:#0B1E3F;">MC-65250</strong>) or drop a rate con PDF. Results in ~2 seconds with a risk score and clear verdict.</div>
</div>`;
  return {
    subject: 'Welcome to Haulock',
    html: baseLayout({ preview: 'Verify any broker in seconds. Start with your first lookup.', body, unsubEmail: recipientEmail }),
  };
}

export type AlertReport = {
  name: string;
  mc?: string;
  dot?: string;
  score: number;
  verdict: string;
  flags?: { sev: string; title: string; desc: string }[];
};

export function highRiskAlertTemplate({ report, siteUrl }: { report: AlertReport; siteUrl: string }): { subject: string; html: string } {
  const idLine = [report.mc && `MC-${report.mc}`, report.dot && `DOT-${report.dot}`].filter(Boolean).join(' · ') || 'No ID';
  const topFlags = (report.flags || []).slice(0, 4);
  const flagsHtml = topFlags.length ? topFlags.map((f) => `
    <tr><td style="padding:10px 0;border-bottom:1px solid rgba(11,30,63,0.06);">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td style="width:10px;vertical-align:top;padding-top:6px;"><div style="width:6px;height:6px;border-radius:50%;background:${f.sev === 'critical' ? '#DC2626' : f.sev === 'warning' ? '#F59E0B' : 'rgba(11,30,63,0.4)'};"></div></td>
          <td style="padding-left:10px;">
            <div style="font-size:14px;font-weight:600;color:#0B1E3F;margin-bottom:2px;">${escapeHtml(f.title)}</div>
            <div style="font-size:13px;color:rgba(11,30,63,0.6);line-height:1.5;">${escapeHtml(f.desc)}</div>
          </td>
        </tr>
      </table>
    </td></tr>`).join('') : '';
  const body = `
<div style="display:inline-block;padding:4px 10px;background:rgba(220,38,38,0.1);color:#DC2626;border-radius:999px;font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px;">High risk · do not book</div>
${h1(`We flagged a broker ${italicAccent('you just looked up.')}`)}
<div style="background:rgba(220,38,38,0.05);border:1px solid rgba(220,38,38,0.2);border-radius:12px;padding:20px;margin:0 0 24px 0;">
  <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:6px;">Broker</div>
  <div style="font-size:22px;font-weight:600;color:#0B1E3F;margin-bottom:4px;">${escapeHtml(report.name)}</div>
  <div style="font-size:13px;font-family:'SF Mono',Menlo,Consolas,monospace;color:rgba(11,30,63,0.55);margin-bottom:16px;">${escapeHtml(idLine)}</div>
  <div style="display:inline-block;padding:4px 10px;background:#DC2626;color:#ffffff;border-radius:6px;font-size:12px;font-weight:600;">Risk score ${report.score}/100</div>
</div>
${p('Our scan returned the following red flags. We recommend walking away from this load, or requiring full payment upfront with independent identity verification if you must proceed.')}
${topFlags.length ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">${flagsHtml}</table>` : ''}
${button(siteUrl, 'Open full report →')}
${divider()}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">
  <strong style="color:#0B1E3F;">Why we sent this:</strong> you just ran a broker verification on Haulock and the result returned as HIGH RISK. Manage notification preferences in <a href="${siteUrl}" style="color:#0B1E3F;text-decoration:underline;">Settings → Notifications</a>.
</div>`;
  return {
    subject: `HIGH RISK alert: ${report.name}`,
    html: baseLayout({ preview: `Haulock flagged ${report.name} as HIGH RISK — here is why.`, body }),
  };
}

// ---------- Report share (PDF attached) ----------

export type ShareReportArgs = {
  report: AlertReport & {
    address?: string;
    insuranceSummary?: string;
    safetyRating?: string;
    authorityStatus?: string;
    brokerAuthority?: string;
  };
  senderName?: string;
  senderEmail?: string;
  message?: string;
  siteUrl: string;
};

export function reportShareTemplate({ report, senderName, senderEmail, message, siteUrl }: ShareReportArgs): { subject: string; html: string } {
  const idLine = [report.mc && `MC-${report.mc}`, report.dot && `DOT-${report.dot}`].filter(Boolean).join(' · ') || 'No ID';
  const verdictLabel = report.verdict === 'high' ? 'HIGH RISK' : report.verdict === 'medium' ? 'CAUTION' : 'LOW RISK';
  const verdictColor = report.verdict === 'high' ? '#DC2626' : report.verdict === 'medium' ? '#F59E0B' : '#16A34A';
  const verdictBg = report.verdict === 'high' ? 'rgba(220,38,38,0.08)' : report.verdict === 'medium' ? 'rgba(245,158,11,0.10)' : 'rgba(22,163,74,0.10)';
  const recLine = report.verdict === 'high' ? 'Do not book this load.' : report.verdict === 'medium' ? 'Proceed with caution.' : 'Safe to book.';
  const topFlags = (report.flags || []).slice(0, 4);
  const senderLabel = senderName ? `${escapeHtml(senderName)}${senderEmail ? ` (${escapeHtml(senderEmail)})` : ''}` : 'Someone';

  const messageBlock = message && message.trim() ? `
<div style="background:rgba(11,30,63,0.04);border-radius:12px;padding:18px 20px;margin:0 0 24px 0;">
  <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:8px;">Note from ${escapeHtml(senderName || 'sender')}</div>
  <div style="font-size:14px;line-height:1.6;color:#0B1E3F;white-space:pre-wrap;">${escapeHtml(message.trim())}</div>
</div>` : '';

  const flagsHtml = topFlags.length ? `
<div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin:0 0 10px 0;">Top red flags</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">
${topFlags.map((f) => `
  <tr><td style="padding:10px 0;border-bottom:1px solid rgba(11,30,63,0.06);">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td style="width:10px;vertical-align:top;padding-top:6px;"><div style="width:6px;height:6px;border-radius:50%;background:${f.sev === 'critical' ? '#DC2626' : f.sev === 'warning' ? '#F59E0B' : 'rgba(11,30,63,0.4)'};"></div></td>
        <td style="padding-left:10px;">
          <div style="font-size:14px;font-weight:600;color:#0B1E3F;margin-bottom:2px;">${escapeHtml(f.title)}</div>
          <div style="font-size:13px;color:rgba(11,30,63,0.6);line-height:1.5;">${escapeHtml(f.desc)}</div>
        </td>
      </tr>
    </table>
  </td></tr>`).join('')}
</table>` : `<div style="font-size:14px;color:rgba(11,30,63,0.6);margin:0 0 24px 0;">No red flags detected on this lookup.</div>`;

  const detailRow = (label: string, value: string) => `
<tr>
  <td style="padding:10px 0;border-bottom:1px solid rgba(11,30,63,0.06);font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.10em;text-transform:uppercase;color:rgba(11,30,63,0.55);width:46%;">${escapeHtml(label)}</td>
  <td style="padding:10px 0;border-bottom:1px solid rgba(11,30,63,0.06);font-size:14px;font-weight:600;color:#0B1E3F;text-align:right;">${escapeHtml(value || '—')}</td>
</tr>`;

  const detailRows = [
    detailRow('Operating authority', report.authorityStatus || '—'),
    detailRow('Broker authority', report.brokerAuthority || '—'),
    detailRow('Safety rating', report.safetyRating || 'Not rated'),
    detailRow('Insurance on file', report.insuranceSummary || '—'),
    detailRow('Address', report.address || '—'),
  ].join('');

  const body = `
<div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:8px;">Shared by ${senderLabel}</div>
${h1(`Risk report: ${italicAccent(escapeHtml(report.name))}`)}
<div style="font-size:13px;font-family:'SF Mono',Menlo,Consolas,monospace;color:rgba(11,30,63,0.55);margin:0 0 24px 0;">${escapeHtml(idLine)}</div>

${messageBlock}

<div style="background:${verdictBg};border:1px solid ${verdictColor}33;border-radius:14px;padding:20px 22px;margin:0 0 24px 0;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td style="vertical-align:middle;">
        <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:4px;">Risk level</div>
        <div style="font-size:22px;font-weight:700;color:${verdictColor};line-height:1.1;">${verdictLabel}</div>
        <div style="font-size:14px;font-weight:600;color:#0B1E3F;margin-top:6px;">${recLine}</div>
      </td>
      <td style="vertical-align:middle;text-align:right;">
        <div style="display:inline-block;padding:14px 20px;background:#ffffff;border:2px solid ${verdictColor};border-radius:50%;min-width:30px;">
          <div style="font-size:24px;font-weight:700;color:#0B1E3F;line-height:1;">${report.score}</div>
          <div style="font-size:9px;color:rgba(11,30,63,0.55);font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.10em;">/ 100</div>
        </div>
      </td>
    </tr>
  </table>
</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">${detailRows}</table>

${flagsHtml}

<div style="background:rgba(255,107,53,0.08);border-radius:10px;padding:14px 18px;margin:0 0 24px 0;font-size:13px;color:#0B1E3F;">
  <strong style="color:#FF6B35;">PDF attached</strong> — full branded report with all checks (FMCSA, Google Places, web presence, domain, social media).
</div>

${button(siteUrl, 'Open in Haulock →')}

<div style="font-size:12px;color:rgba(11,30,63,0.5);line-height:1.6;">
  Pulled from FMCSA, Google Places, and our web/domain enrichment. Generated by Haulock.
</div>`;

  return {
    subject: `Haulock report · ${report.name} · ${verdictLabel}`,
    html: baseLayout({ preview: `${verdictLabel} — ${report.name} (${idLine})`, body }),
  };
}

// ---------- Supabase auth email templates ----------
// Paste these into Supabase dashboard → Auth → Email Templates.
// Supabase placeholders: {{ .ConfirmationURL }}  {{ .SiteURL }}  {{ .Token }}  {{ .Email }}

export const supabaseConfirmSignupTemplate = baseLayout({
  preview: 'Confirm your Haulock account to start verifying brokers.',
  body: `
${h1(`Confirm your ${italicAccent('Haulock')} account.`)}
${p(`Click the button below to verify your email address and activate your account. This link expires in 24 hours.`)}
${button('{{ .ConfirmationURL }}', 'Confirm my email →')}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">
  If the button doesn&rsquo;t work, copy and paste this link into your browser:<br>
  <a href="{{ .ConfirmationURL }}" style="color:#0B1E3F;word-break:break-all;">{{ .ConfirmationURL }}</a>
</div>
${divider()}
<div style="font-size:13px;color:rgba(11,30,63,0.5);line-height:1.6;">
  Didn&rsquo;t sign up for Haulock? You can safely ignore this email.
</div>`,
});

export const supabaseResetPasswordTemplate = baseLayout({
  preview: 'Reset your Haulock password.',
  body: `
${h1(`Reset your ${italicAccent('password')}.`)}
${p(`Click the button below to choose a new password for your Haulock account. This link expires in 1 hour.`)}
${button('{{ .ConfirmationURL }}', 'Reset password →')}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">
  If the button doesn&rsquo;t work, copy and paste this link into your browser:<br>
  <a href="{{ .ConfirmationURL }}" style="color:#0B1E3F;word-break:break-all;">{{ .ConfirmationURL }}</a>
</div>
${divider()}
<div style="font-size:13px;color:rgba(11,30,63,0.5);line-height:1.6;">
  Didn&rsquo;t request this? You can safely ignore this email — your password won&rsquo;t change unless you click the link above.
</div>`,
});

export const supabaseMagicLinkTemplate = baseLayout({
  preview: 'Your Haulock login link.',
  body: `
${h1(`Log in to ${italicAccent('Haulock')}.`)}
${p(`Click the button below to log in. This link expires in 1 hour and can be used only once.`)}
${button('{{ .ConfirmationURL }}', 'Log in to Haulock →')}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">
  If the button doesn&rsquo;t work, copy and paste this link into your browser:<br>
  <a href="{{ .ConfirmationURL }}" style="color:#0B1E3F;word-break:break-all;">{{ .ConfirmationURL }}</a>
</div>
${divider()}
<div style="font-size:13px;color:rgba(11,30,63,0.5);line-height:1.6;">
  Didn&rsquo;t try to log in? You can safely ignore this email.
</div>`,
});

export const supabaseChangeEmailTemplate = baseLayout({
  preview: 'Confirm your new email address for Haulock.',
  body: `
${h1(`Confirm your ${italicAccent('new email')}.`)}
${p(`You requested to change the email address on your Haulock account. Click below to confirm.`)}
${button('{{ .ConfirmationURL }}', 'Confirm new email →')}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">
  If the button doesn&rsquo;t work, copy and paste this link into your browser:<br>
  <a href="{{ .ConfirmationURL }}" style="color:#0B1E3F;word-break:break-all;">{{ .ConfirmationURL }}</a>
</div>
${divider()}
<div style="font-size:13px;color:rgba(11,30,63,0.5);line-height:1.6;">
  Didn&rsquo;t request this change? Reply to this email right away and we&rsquo;ll secure your account.
</div>`,
});

export function teamInviteTemplate({
  inviterName,
  teamName,
  planLabel,
  acceptUrl,
}: { inviterName?: string; teamName?: string | null; planLabel: string; acceptUrl: string }): { subject: string; html: string } {
  const inviter = inviterName ? escapeHtml(inviterName) : 'A teammate';
  const team = teamName ? escapeHtml(teamName) : 'their Haulock team';
  const subject = `${inviter} invited you to ${team} on Haulock`;
  const body = `
${h1(`${inviter} invited you to ${italicAccent(team)}.`)}
${p(`Join the team to verify brokers, share a watchlist, and access the team's <strong>${escapeHtml(planLabel)}</strong> plan together. Click below to accept the invite. The link expires in 14 days.`)}
${button(acceptUrl, 'Accept invite →')}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">
  If the button doesn&rsquo;t work, copy and paste this link into your browser:<br>
  <a href="${acceptUrl}" style="color:#0B1E3F;word-break:break-all;">${acceptUrl}</a>
</div>
${divider()}
<div style="font-size:13px;color:rgba(11,30,63,0.5);line-height:1.6;">
  Don&rsquo;t recognize this invite? You can safely ignore this email — no account will be created.
</div>`;
  return { subject, html: baseLayout({ preview: `${inviter} invited you to ${team} on Haulock.`, body }) };
}

export const supabaseInviteUserTemplate = baseLayout({
  preview: 'You were invited to Haulock.',
  body: `
${h1(`You&rsquo;re invited to ${italicAccent('Haulock')}.`)}
${p(`You&rsquo;ve been added to a Haulock team. Click below to set a password and get started verifying brokers.`)}
${button('{{ .ConfirmationURL }}', 'Accept invite →')}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">
  If the button doesn&rsquo;t work, copy and paste this link into your browser:<br>
  <a href="{{ .ConfirmationURL }}" style="color:#0B1E3F;word-break:break-all;">{{ .ConfirmationURL }}</a>
</div>`,
});

// ---------- Templates: scheduled emails ----------

// Weekly fraud-trends newsletter. The body comes pre-rendered from the
// AI generator (lib/news-research.ts) so this template just wraps it in
// the brand layout, adds a sources block, and a CTA.
export function fraudTrendsTemplate(args: {
  title: string;
  preview: string;
  bodyHtml: string;
  sources: { title: string; url: string }[];
  recipientEmail: string;
  siteUrl: string;
}): { subject: string; html: string } {
  const sourcesHtml = args.sources.length === 0 ? '' : `
${divider()}
<div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:12px;">Sources</div>
<ul style="margin:0 0 24px 0;padding-left:18px;font-size:13px;line-height:1.6;color:rgba(11,30,63,0.7);">
  ${args.sources.slice(0, 5).map((s) => `<li style="margin-bottom:6px;"><a href="${escapeHtml(s.url)}" style="color:#0B1E3F;text-decoration:underline;">${escapeHtml(s.title)}</a></li>`).join('')}
</ul>`;
  const body = `
${h1(args.title)}
${args.bodyHtml}
${button(args.siteUrl, 'Verify a broker on Haulock →')}
${sourcesHtml}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">You&rsquo;re getting this because you signed up for the weekly Haulock fraud briefing. One email a week. Unsubscribe with one click using the link below.</div>`;
  return {
    subject: args.title,
    html: baseLayout({ preview: args.preview, body, unsubEmail: args.recipientEmail }),
  };
}

// Watchlist update — sent when a broker on the user's watchlist changes
// (score, verdict, authority, or new flags). Compact and actionable.
export type WatchlistChange = {
  scoreFrom: number;
  scoreTo: number;
  verdictFrom: string;
  verdictTo: string;
  newFlags: string[];
  authorityChanged: boolean;
  authorityFrom: string | null;
  authorityTo: string | null;
};
export function watchlistUpdateTemplate(args: {
  carrier: { name: string; mc?: string | null; dot?: string | null };
  change: WatchlistChange;
  recipientEmail: string;
  siteUrl: string;
}): { subject: string; html: string } {
  const idLine = [args.carrier.mc && `MC-${args.carrier.mc}`, args.carrier.dot && `DOT-${args.carrier.dot}`].filter(Boolean).join(' · ') || 'No ID';
  const direction = args.change.scoreTo > args.change.scoreFrom || (args.change.verdictTo === 'high' && args.change.verdictFrom !== 'high') ? 'worse' : 'better';
  const accent = direction === 'worse' ? '#DC2626' : '#16A34A';
  const accentBg = direction === 'worse' ? 'rgba(220,38,38,0.08)' : 'rgba(22,163,74,0.10)';
  const verdictLabel = (v: string) => v === 'high' ? 'HIGH' : v === 'medium' ? 'CAUTION' : v === 'low' ? 'LOW' : (v || '—').toUpperCase();
  const flagsList = args.change.newFlags.length === 0 ? '' : `
<div style="margin:0 0 24px 0;">
  <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:8px;">New flags</div>
  <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.65;color:rgba(11,30,63,0.85);">
    ${args.change.newFlags.slice(0, 5).map((t) => `<li style="margin-bottom:4px;">${escapeHtml(t)}</li>`).join('')}
  </ul>
</div>`;
  const authorityLine = args.change.authorityChanged ? `
<div style="font-size:14px;line-height:1.65;color:rgba(11,30,63,0.85);margin:0 0 12px 0;">
  <strong style="color:#0B1E3F;">Authority status:</strong> ${escapeHtml(args.change.authorityFrom || '—')} &rarr; <strong style="color:${accent};">${escapeHtml(args.change.authorityTo || '—')}</strong>
</div>` : '';
  const body = `
<div style="display:inline-block;padding:4px 10px;background:${accentBg};color:${accent};border-radius:999px;font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px;">Watchlist · ${direction === 'worse' ? 'risk increased' : 'risk improved'}</div>
${h1(`Update on ${italicAccent(args.carrier.name)}`)}
<div style="background:${accentBg};border-radius:12px;padding:20px;margin:0 0 24px 0;">
  <div style="font-size:13px;font-family:'SF Mono',Menlo,Consolas,monospace;color:rgba(11,30,63,0.55);margin-bottom:8px;">${escapeHtml(idLine)}</div>
  <div style="font-size:14px;line-height:1.65;color:rgba(11,30,63,0.85);">
    <strong style="color:#0B1E3F;">Score:</strong> ${args.change.scoreFrom} &rarr; <strong style="color:${accent};">${args.change.scoreTo}</strong>
    &nbsp;·&nbsp;
    <strong style="color:#0B1E3F;">Verdict:</strong> ${verdictLabel(args.change.verdictFrom)} &rarr; <strong style="color:${accent};">${verdictLabel(args.change.verdictTo)}</strong>
  </div>
</div>
${authorityLine}
${flagsList}
${button(args.siteUrl + '/watchlist', 'Open watchlist →')}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">Manage which watchlist updates you receive in <a href="${args.siteUrl}/settings" style="color:#0B1E3F;text-decoration:underline;">Settings &rarr; Notifications</a>.</div>`;
  return {
    subject: `Watchlist update: ${args.carrier.name} ${direction === 'worse' ? 'risk increased' : 'changed'}`,
    html: baseLayout({ preview: `${args.carrier.name}: score ${args.change.scoreFrom} to ${args.change.scoreTo}.`, body, unsubEmail: args.recipientEmail }),
  };
}

// Weekly digest — Monday morning summary of the user's last 7 days.
export type DigestStats = {
  lookups: number;
  highVerdictCount: number;
  cautionVerdictCount: number;
  topRiskCarriers: { name: string; mc?: string | null; dot?: string | null; score: number }[];
  watchlistTotal: number;
  watchlistChanges: number;
};
export function weeklyDigestTemplate(args: {
  stats: DigestStats;
  recipientEmail: string;
  recipientName?: string;
  siteUrl: string;
}): { subject: string; html: string } {
  const greeting = args.recipientName ? `Hi ${escapeHtml(args.recipientName.split(' ')[0])},` : 'Hi,';
  const noActivity = args.stats.lookups === 0 && args.stats.watchlistChanges === 0;
  const topCarriersHtml = args.stats.topRiskCarriers.length === 0 ? '' : `
<div style="margin:0 0 24px 0;">
  <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:12px;">Highest-risk lookups this week</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    ${args.stats.topRiskCarriers.slice(0, 5).map((c) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid rgba(11,30,63,0.06);">
          <div style="font-size:14px;font-weight:600;color:#0B1E3F;">${escapeHtml(c.name)}</div>
          <div style="font-size:12px;font-family:'SF Mono',Menlo,Consolas,monospace;color:rgba(11,30,63,0.55);">${escapeHtml([c.mc && `MC-${c.mc}`, c.dot && `DOT-${c.dot}`].filter(Boolean).join(' · ') || 'No ID')}</div>
        </td>
        <td align="right" style="padding:10px 0;border-bottom:1px solid rgba(11,30,63,0.06);">
          <span style="display:inline-block;padding:4px 10px;background:${c.score >= 61 ? 'rgba(220,38,38,0.1)' : c.score >= 31 ? 'rgba(245,158,11,0.1)' : 'rgba(22,163,74,0.1)'};color:${c.score >= 61 ? '#DC2626' : c.score >= 31 ? '#F59E0B' : '#16A34A'};border-radius:6px;font-size:13px;font-weight:600;font-family:'SF Mono',Menlo,Consolas,monospace;">${c.score}</span>
        </td>
      </tr>
    `).join('')}
  </table>
</div>`;
  const body = noActivity ? `
${h1(`${greeting} quiet week on ${italicAccent('Haulock')}.`)}
${p(`You didn&rsquo;t run any lookups or watchlist refreshes in the last 7 days. No news is good news, but if you&rsquo;ve got a load to book this week, it takes 2 seconds to verify the broker first.`)}
${button(args.siteUrl, 'Verify a broker →')}
` : `
${h1(`${greeting} your week on ${italicAccent('Haulock')}.`)}
${p(`Here&rsquo;s a quick look at what happened in your account over the last 7 days.`)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px 0;">
  <tr>
    <td style="padding:14px;background:rgba(11,30,63,0.04);border-radius:12px;">
      <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);">Lookups</div>
      <div style="font-size:24px;font-weight:600;color:#0B1E3F;margin-top:4px;">${args.stats.lookups}</div>
    </td>
    <td style="width:8px;"></td>
    <td style="padding:14px;background:rgba(220,38,38,0.06);border-radius:12px;">
      <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(220,38,38,0.65);">High risk</div>
      <div style="font-size:24px;font-weight:600;color:#DC2626;margin-top:4px;">${args.stats.highVerdictCount}</div>
    </td>
    <td style="width:8px;"></td>
    <td style="padding:14px;background:rgba(245,158,11,0.08);border-radius:12px;">
      <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(245,158,11,0.7);">Caution</div>
      <div style="font-size:24px;font-weight:600;color:#F59E0B;margin-top:4px;">${args.stats.cautionVerdictCount}</div>
    </td>
  </tr>
</table>
${topCarriersHtml}
${args.stats.watchlistTotal > 0 ? `<p style="margin:0 0 24px 0;font-size:15px;line-height:1.65;color:rgba(11,30,63,0.75);">You have <strong style="color:#0B1E3F;">${args.stats.watchlistTotal}</strong> ${args.stats.watchlistTotal === 1 ? 'broker' : 'brokers'} on your watchlist.${args.stats.watchlistChanges > 0 ? ` <strong style="color:#DC2626;">${args.stats.watchlistChanges}</strong> changed this week.` : ' No changes this week.'}</p>` : ''}
${button(args.siteUrl + '/dashboard', 'Open dashboard →')}
`;
  return {
    subject: noActivity ? 'Your quiet week on Haulock' : `Your week on Haulock: ${args.stats.lookups} lookups, ${args.stats.highVerdictCount} high risk`,
    html: baseLayout({ preview: 'Your weekly Haulock summary.', body, unsubEmail: args.recipientEmail }),
  };
}

// Community fraud report — pinged when another carrier reports a broker
// the recipient has interacted with (looked up or watched).
export function communityReportTemplate(args: {
  report: { name: string; mc?: string | null; dot?: string | null; type: string; description?: string | null; amount?: number | null };
  reason: 'looked-up' | 'watching';
  recipientEmail: string;
  siteUrl: string;
}): { subject: string; html: string } {
  const idLine = [args.report.mc && `MC-${args.report.mc}`, args.report.dot && `DOT-${args.report.dot}`].filter(Boolean).join(' · ') || 'No ID';
  const reasonLabel = args.reason === 'watching' ? 'on your watchlist' : 'you recently looked up';
  const typeLabel = ({
    non_payment: 'Non-payment',
    double_broker: 'Double brokering',
    identity_fraud: 'Identity fraud',
    fake_load: 'Fake load',
    other: 'Fraud',
  } as Record<string, string>)[args.report.type] || 'Fraud';
  const amountLine = args.report.amount ? `<div style="font-size:14px;line-height:1.65;color:rgba(11,30,63,0.85);margin:0 0 12px 0;"><strong style="color:#0B1E3F;">Reported loss:</strong> $${Number(args.report.amount).toLocaleString()}</div>` : '';
  const descBlock = args.report.description && args.report.description.trim() ? `
<div style="background:rgba(11,30,63,0.04);border-radius:12px;padding:18px 20px;margin:0 0 24px 0;">
  <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:8px;">Reporter wrote</div>
  <div style="font-size:14px;line-height:1.65;color:rgba(11,30,63,0.85);">${escapeHtml(args.report.description)}</div>
</div>` : '';
  const body = `
<div style="display:inline-block;padding:4px 10px;background:rgba(220,38,38,0.1);color:#DC2626;border-radius:999px;font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px;">${escapeHtml(typeLabel)} report</div>
${h1(`A broker ${reasonLabel} was just ${italicAccent('reported.')}`)}
<div style="background:rgba(220,38,38,0.05);border:1px solid rgba(220,38,38,0.2);border-radius:12px;padding:20px;margin:0 0 24px 0;">
  <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:6px;">Broker</div>
  <div style="font-size:22px;font-weight:600;color:#0B1E3F;margin-bottom:4px;">${escapeHtml(args.report.name)}</div>
  <div style="font-size:13px;font-family:'SF Mono',Menlo,Consolas,monospace;color:rgba(11,30,63,0.55);">${escapeHtml(idLine)}</div>
</div>
${amountLine}
${descBlock}
${p('Another Haulock carrier just submitted this report. Treat it as one signal, not a verdict — community reports are unverified user submissions. If this broker contacts you about a load, slow down and verify identity through independent channels first.')}
${button(args.siteUrl + '/reports', 'See community fraud reports →')}
${divider()}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">You&rsquo;re getting this because this broker is ${reasonLabel} on Haulock and you have community-report alerts turned on. Manage in <a href="${args.siteUrl}/settings" style="color:#0B1E3F;text-decoration:underline;">Settings &rarr; Notifications</a>.</div>`;
  return {
    subject: `${typeLabel} report: ${args.report.name}`,
    html: baseLayout({ preview: `Another carrier reported ${args.report.name} for ${typeLabel.toLowerCase()}.`, body, unsubEmail: args.recipientEmail }),
  };
}
