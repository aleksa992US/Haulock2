import { Resend } from 'resend';
import { createHmac } from 'crypto';
import { carrierAuthorityLabel, recommendationFor, roleNoun, type AuthorityFields } from './recommendation';

let cached: Resend | null = null;

export function getResendClient(): Resend | null {
  return getResend();
}

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

// Email links should ALWAYS point at production, even when the dev server
// fires off a real send (high-risk-alert, support reply, etc.). Without this
// override, dev sends end up with `http://localhost:3001` baked into every
// "Open report" button. Resolution order:
//   1. EMAIL_PUBLIC_URL  — explicit override (set this on dev/staging if
//                          you want emails to point at prod)
//   2. NEXT_PUBLIC_SITE_URL — only used if it's a real https:// URL
//   3. 'https://haulock.com' — fallback so we never serve a localhost link
export function getEmailSiteUrl(): string {
  const override = (process.env.EMAIL_PUBLIC_URL || '').trim();
  if (override && /^https?:\/\//i.test(override)) return override.replace(/\/+$/, '');
  const site = (process.env.NEXT_PUBLIC_SITE_URL || '').trim();
  if (site && /^https:\/\//i.test(site) && !/localhost|127\.0\.0\.1/.test(site)) {
    return site.replace(/\/+$/, '');
  }
  return 'https://haulock.com';
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
  const e = encodeURIComponent(email.trim().toLowerCase());
  const t = buildUnsubscribeToken(email);
  return `${getEmailSiteUrl()}/api/newsletter/unsubscribe?email=${e}&t=${t}`;
}

export type SendAttachment = { filename: string; content: Buffer | Uint8Array; contentType?: string };
export type SendArgs = {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: SendAttachment[];
  // Extra headers, e.g. In-Reply-To / References to thread a reply.
  headers?: Record<string, string>;
  // `kind` tags the send so the admin newsletter dashboard can show counts
  // per type per recipient. Optional — old call sites stay legal.
  kind?: 'welcome' | 'high_risk_alert' | 'report_share' | 'newsletter' | 'team_invite' | 'support_received' | 'support_reply' | 'support_working' | 'support_solved' | 'abandoned_1h' | 'abandoned_7d' | 'nurture' | 'inbound_scan' | 'other';
};

export async function sendEmail({ to, subject, html, replyTo, attachments, headers: extraHeaders, kind }: SendArgs) {
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
  const headers: Record<string, string> = { ...(extraHeaders || {}) };
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
  // Replaces the "you have an account" footer line, e.g. for replies to
  // people who emailed us without an account.
  reason?: string;
};

function baseLayout({ preview, body, unsubEmail, reason }: LayoutArgs): string {
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
        ${reason ?? `You&rsquo;re receiving this because you have an account at <a href="https://haulock.com" style="color:rgba(11,30,63,0.7);text-decoration:underline;">haulock.com</a>.`}${unsubBlock}
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

export type AlertReport = AuthorityFields & {
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
  // Role-aware: "broker" / "carrier" / "company" from its FMCSA authority.
  const noun = roleNoun(report);
  const rec = recommendationFor(report, 'high');
  const body = `
<div style="display:inline-block;padding:4px 10px;background:rgba(220,38,38,0.1);color:#DC2626;border-radius:999px;font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px;">High risk</div>
${h1(`We flagged a ${noun} ${italicAccent('you just looked up.')}`)}
<div style="background:rgba(220,38,38,0.05);border:1px solid rgba(220,38,38,0.2);border-radius:12px;padding:20px;margin:0 0 24px 0;">
  <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:6px;">${noun.charAt(0).toUpperCase() + noun.slice(1)}</div>
  <div style="font-size:22px;font-weight:600;color:#0B1E3F;margin-bottom:4px;">${escapeHtml(report.name)}</div>
  <div style="font-size:13px;font-family:'SF Mono',Menlo,Consolas,monospace;color:rgba(11,30,63,0.55);margin-bottom:16px;">${escapeHtml(idLine)}</div>
  <div style="display:inline-block;padding:4px 10px;background:#DC2626;color:#ffffff;border-radius:6px;font-size:12px;font-weight:600;">Risk score ${report.score}/100</div>
</div>
${p(`<strong style="color:#0B1E3F;">${escapeHtml(rec.headline)}</strong> ${escapeHtml(rec.detail)}`)}
${topFlags.length ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">${flagsHtml}</table>` : ''}
${button(siteUrl, 'Open full report →')}
${divider()}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">
  <strong style="color:#0B1E3F;">Why we sent this:</strong> you just checked this ${noun} on Haulock and the result came back HIGH RISK. Manage notification preferences in <a href="${siteUrl}" style="color:#0B1E3F;text-decoration:underline;">Settings → Notifications</a>.
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
  const recLine = recommendationFor(report, report.verdict).headline;
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
    detailRow('Carrier authority', carrierAuthorityLabel(report)),
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

// ---------- Support tickets ----------

// "We got your ticket" — fired immediately after the user opens a ticket.
// Company ownership code, sent to the email on the company's FMCSA filing
// (MCS-150). Names the Haulock account that asked, so a real owner notices
// a request they didn't make.
export function companyVerificationCodeTemplate(args: { code: string; companyName: string; idLabel: string; requestedBy: string; siteUrl: string }): { subject: string; html: string } {
  const body = `
${h1(`Your verification code: ${italicAccent(escapeHtml(args.code))}`)}
${p(`Someone signed in to Haulock as <strong style="color:#0B1E3F;">${escapeHtml(args.requestedBy)}</strong> asked to verify that they work for <strong style="color:#0B1E3F;">${escapeHtml(args.companyName)}</strong> (${escapeHtml(args.idLabel)}). We sent this code to the email on your company&rsquo;s FMCSA filing.`)}
<div style="background:#F5F3EE;border-radius:12px;padding:20px;margin:0 0 24px 0;text-align:center;">
  <div style="font-size:32px;font-weight:700;letter-spacing:0.3em;color:#0B1E3F;font-family:'SF Mono',Menlo,Consolas,monospace;">${escapeHtml(args.code)}</div>
  <div style="font-size:12px;color:rgba(11,30,63,0.55);margin-top:6px;">Expires in 30 minutes</div>
</div>
${p('Give this code only to someone at your company. Verifying lets them see how often your company is checked on Haulock (counts only, never who).')}
${divider()}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">Didn&rsquo;t expect this? Ignore it &mdash; nothing changes without the code. Questions: <a href="mailto:contact@haulock.com" style="color:#0B1E3F;text-decoration:underline;">contact@haulock.com</a>.</div>`;
  return {
    subject: `Haulock verification code for ${args.companyName}: ${args.code}`,
    html: baseLayout({ preview: `Code ${args.code} — requested by ${args.requestedBy}`, body, reason: `You&rsquo;re receiving this because this address is on ${escapeHtml(args.companyName)}&rsquo;s FMCSA filing.` }),
  };
}

export function supportReceivedTemplate(args: {
  subject: string;
  preview: string;
  recipientEmail: string;
  ticketUrl: string;
}): { subject: string; html: string } {
  const body = `
${h1(`We got your ticket: ${italicAccent(escapeHtml(args.subject))}`)}
${p(`Thanks for reaching out. We&rsquo;ve logged your ticket and someone from the team will look at it as soon as possible. We answer every ticket personally, usually within one business day.`)}
<div style="background:rgba(11,30,63,0.04);border-radius:12px;padding:18px 20px;margin:0 0 24px 0;">
  <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:8px;">Your message</div>
  <div style="font-size:14px;line-height:1.65;color:rgba(11,30,63,0.85);white-space:pre-wrap;">${escapeHtml(args.preview)}</div>
</div>
${button(args.ticketUrl, 'Open ticket →')}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">You&rsquo;ll get an email when we reply or change the status. You can also reply directly inside Haulock to add more info.</div>`;
  return {
    subject: `We got your ticket: ${args.subject}`,
    html: baseLayout({ preview: 'We got your ticket. We will get back to you shortly.', body, unsubEmail: args.recipientEmail }),
  };
}

// "Admin replied" — fired when an admin posts a reply on a ticket. Includes
// the reply body so the user sees the answer in their inbox.
export function supportAdminReplyTemplate(args: {
  subject: string;
  reply: string;
  recipientEmail: string;
  ticketUrl: string;
  statusFlipped: boolean; // true if this reply also flipped status to "working"
}): { subject: string; html: string } {
  const headline = args.statusFlipped
    ? `We&rsquo;re on your ticket: ${italicAccent(escapeHtml(args.subject))}`
    : `New reply on your ticket: ${italicAccent(escapeHtml(args.subject))}`;
  const body = `
${h1(headline)}
${p(args.statusFlipped ? `Someone from the team picked this up and just replied. The ticket is now in &ldquo;Working on it&rdquo;.` : `Someone from the team just replied to your ticket.`)}
<div style="background:rgba(11,30,63,0.04);border-radius:12px;padding:18px 20px;margin:0 0 24px 0;">
  <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:#FF6B35;font-weight:600;margin-bottom:8px;">From Haulock support</div>
  <div style="font-size:15px;line-height:1.65;color:rgba(11,30,63,0.85);white-space:pre-wrap;">${escapeHtml(args.reply)}</div>
</div>
${button(args.ticketUrl, 'View thread & reply →')}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">Hit reply right here, or open the ticket on Haulock to keep the conversation going.</div>`;
  const subject = args.statusFlipped
    ? `Working on your ticket: ${args.subject}`
    : `Re: ${args.subject}`;
  return {
    subject,
    html: baseLayout({ preview: args.reply.slice(0, 140), body, unsubEmail: args.recipientEmail }),
  };
}

// "Working on it" — fired when the admin moves the status to working
// without (yet) posting a reply.
export function supportWorkingTemplate(args: {
  subject: string;
  recipientEmail: string;
  ticketUrl: string;
}): { subject: string; html: string } {
  const body = `
${h1(`We&rsquo;re working on your ticket: ${italicAccent(escapeHtml(args.subject))}`)}
${p(`Quick update. Someone from the Haulock team picked up your ticket and is looking into it now. We&rsquo;ll reply with what we find as soon as we have something useful.`)}
${button(args.ticketUrl, 'Open ticket →')}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">No action needed from you. We just wanted you to know it&rsquo;s in motion.</div>`;
  return {
    subject: `Working on it: ${args.subject}`,
    html: baseLayout({ preview: 'Your support ticket is in motion.', body, unsubEmail: args.recipientEmail }),
  };
}

// "Solved" — fired when the admin marks the ticket solved.
export function supportSolvedTemplate(args: {
  subject: string;
  recipientEmail: string;
  ticketUrl: string;
}): { subject: string; html: string } {
  const body = `
${h1(`Resolved: ${italicAccent(escapeHtml(args.subject))}`)}
${p(`We&rsquo;ve marked your ticket as solved. If anything is still off, just reply on the ticket and it will reopen automatically.`)}
${button(args.ticketUrl, 'Open ticket →')}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">Thanks for the heads-up that something needed attention. The more tickets we get, the better Haulock gets.</div>`;
  return {
    subject: `Resolved: ${args.subject}`,
    html: baseLayout({ preview: 'Your support ticket has been marked solved.', body, unsubEmail: args.recipientEmail }),
  };
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
${h1(escapeHtml(args.title))}
${args.bodyHtml}
${button(args.siteUrl, 'Verify a broker on Haulock →')}
${sourcesHtml}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">You&rsquo;re getting this because you signed up for the weekly Haulock fraud briefing. One email a week. Unsubscribe with one click using the link below.</div>`;
  return {
    subject: args.title,
    html: baseLayout({ preview: args.preview, body, unsubEmail: args.recipientEmail }),
  };
}

// Watchlist update — sent when a watched company's FMCSA registry record
// changes: authority (per role), insurance, bond, out-of-service, safety
// rating, address, phone or name. The daily job re-reads only the FMCSA
// registry (no web, address or SMS checks), so the email lists exactly
// which fields changed and never says the overall risk went up or down.
export type WatchlistFieldChange = {
  field: string;     // e.g. 'brokerAuthority'
  label: string;     // e.g. 'Broker authority'
  from: string;      // display value before ('—' when it wasn't on record)
  to: string;        // display value now
  concern: boolean;  // a warning sign: authority lost, coverage dropped, OOS order, rating downgraded, identity details changed
};
export type WatchlistChange = {
  changes: WatchlistFieldChange[];
};
export function watchlistUpdateTemplate(args: {
  carrier: { name: string; mc?: string | null; dot?: string | null };
  change: WatchlistChange;
  recipientEmail: string;
  siteUrl: string;
  // The user's own company (daily monitoring), not someone they watch.
  own?: boolean;
}): { subject: string; html: string } {
  const idLine = [args.carrier.mc && `MC-${args.carrier.mc}`, args.carrier.dot && `DOT-${args.carrier.dot}`].filter(Boolean).join(' · ') || 'No ID';
  const changes = args.change.changes;
  const concerns = changes.filter((c) => c.concern);
  const badge = args.own
    ? { text: 'Your company · FMCSA record changed', color: '#DC2626', bg: 'rgba(220,38,38,0.08)' }
    : concerns.length > 0
      ? { text: `Watchlist · ${concerns.length} change${concerns.length === 1 ? '' : 's'} to review`, color: '#DC2626', bg: 'rgba(220,38,38,0.08)' }
      : { text: 'Watchlist · FMCSA record changed', color: '#0B1E3F', bg: 'rgba(11,30,63,0.06)' };
  const rows = changes.map((c) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid rgba(11,30,63,0.08);font-size:13px;color:rgba(11,30,63,0.6);vertical-align:top;width:38%;">${escapeHtml(c.label)}</td>
      <td style="padding:10px 0;border-bottom:1px solid rgba(11,30,63,0.08);font-size:14px;line-height:1.5;color:rgba(11,30,63,0.85);">
        ${escapeHtml(c.from || '—')} &rarr; <strong style="color:${c.concern ? '#DC2626' : '#0B1E3F'};">${escapeHtml(c.to || '—')}</strong>
      </td>
    </tr>`).join('');
  const summary = changes.length === 1
    ? `${changes[0].label}: ${changes[0].from || '—'} to ${changes[0].to || '—'}.`
    : `${changes.length} FMCSA fields changed: ${changes.slice(0, 3).map((c) => c.label.toLowerCase()).join(', ')}${changes.length > 3 ? ', and more' : ''}.`;
  const body = `
<div style="display:inline-block;padding:4px 10px;background:${badge.bg};color:${badge.color};border-radius:999px;font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px;">${escapeHtml(badge.text)}</div>
${h1(args.own ? `Your FMCSA record ${italicAccent('just changed')}` : `FMCSA record changed for ${italicAccent(escapeHtml(args.carrier.name))}`)}
<div style="background:#F5F3EE;border-radius:12px;padding:20px;margin:0 0 24px 0;">
  <div style="font-size:13px;font-family:'SF Mono',Menlo,Consolas,monospace;color:rgba(11,30,63,0.55);margin-bottom:8px;">${escapeHtml(idLine)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>
</div>
${args.own
  ? p('<strong style="color:#0B1E3F;">If you or your team didn&rsquo;t make this change, act now.</strong> Changes to a carrier&rsquo;s phone, email, address or officers are how identities get hijacked. Log in to your FMCSA portal, check your MCS-150, and call FMCSA if anything looks wrong.')
  : p('Our daily check compares the FMCSA registry record with the last one we saw. It doesn&rsquo;t re-run the web, address or safety checks, so your saved risk score hasn&rsquo;t been recalculated. Run a new scan for the full picture.')}
${args.own ? button(args.siteUrl + '/dashboard', 'Open your dashboard →') : button(args.siteUrl + '/watchlist', 'Open watchlist →')}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">Manage which watchlist updates you receive in <a href="${args.siteUrl}/settings" style="color:#0B1E3F;text-decoration:underline;">Settings &rarr; Notifications</a>.</div>`;
  return {
    subject: args.own
      ? `Your FMCSA record changed: ${changes.length === 1 ? changes[0].label.toLowerCase() : `${changes.length} fields`}`
      : `Watchlist: ${args.carrier.name}: ${changes.length === 1 ? `${changes[0].label.toLowerCase()} changed` : `${changes.length} FMCSA changes`}`,
    html: baseLayout({ preview: `${args.carrier.name}: ${summary}`, body, unsubEmail: args.recipientEmail }),
  };
}

// New roadside inspections / crashes on the user's own company (daily
// own-company monitoring, from FMCSA's inspection and crash files).
export type SafetyEventInspection = { date: string; state: string; location: string; levelLabel: string; violations: number; oos: number; driverOos: number; vehicleOos: number; postCrash: boolean; details?: { desc: string; oos: boolean }[] };
export type SafetyEventCrash = { date: string; state: string; city: string; location: string; fatalities: number; injuries: number; towAway: boolean };
export function safetyEventsTemplate(args: {
  carrier: { name: string; mc?: string | null; dot?: string | null };
  inspections: SafetyEventInspection[];
  crashes: SafetyEventCrash[];
  recipientEmail: string;
  siteUrl: string;
}): { subject: string; html: string } {
  const idLine = [args.carrier.mc && `MC-${args.carrier.mc}`, args.carrier.dot && `DOT-${args.carrier.dot}`].filter(Boolean).join(' · ') || 'No ID';
  const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const place = (loc: string, state: string) => [loc && loc.toUpperCase() !== state ? loc : '', state].filter(Boolean).join(', ') || 'Location not reported';
  const oosCount = args.inspections.filter((i) => i.oos > 0).length;
  const chip = (text: string, color: string, bg: string) => `<span style="display:inline-block;padding:2px 8px;background:${bg};color:${color};border-radius:999px;font-size:11px;font-weight:600;">${escapeHtml(text)}</span>`;
  const insRows = args.inspections.slice(0, 15).map((i) => {
    const result = i.oos > 0
      ? chip(`Out of service${i.driverOos && !i.vehicleOos ? ' · driver' : i.vehicleOos && !i.driverOos ? ' · vehicle' : ''}`, '#DC2626', 'rgba(220,38,38,0.1)')
      : i.violations > 0 ? chip(`${i.violations} violation${i.violations === 1 ? '' : 's'}`, '#B45309', 'rgba(245,158,11,0.15)') : chip('Clean', '#16A34A', 'rgba(22,163,74,0.1)');
    const details = (i.details || []).slice(0, 3).map((v) => `<div style="font-size:12px;color:rgba(11,30,63,0.65);margin-top:3px;">• ${escapeHtml(v.desc.slice(0, 120))}${v.oos ? ' <strong style="color:#DC2626;">(out of service)</strong>' : ''}</div>`).join('');
    return `
    <tr><td style="padding:10px 0;border-bottom:1px solid rgba(11,30,63,0.08);">
      <div style="font-size:14px;color:#0B1E3F;"><strong>${escapeHtml(day(i.date))}</strong> · ${escapeHtml(place(i.location, i.state))} ${result}</div>
      <div style="font-size:12px;color:rgba(11,30,63,0.55);margin-top:2px;">${escapeHtml(i.levelLabel)}${i.postCrash ? ' · after a crash' : ''}</div>${details}
    </td></tr>`;
  }).join('');
  const crashRows = args.crashes.slice(0, 10).map((c) => `
    <tr><td style="padding:10px 0;border-bottom:1px solid rgba(11,30,63,0.08);">
      <div style="font-size:14px;color:#0B1E3F;"><strong>${escapeHtml(day(c.date))}</strong> · ${escapeHtml(place(c.city || c.location, c.state))}
        ${c.fatalities ? chip(`${c.fatalities} fatal`, '#DC2626', 'rgba(220,38,38,0.1)') : ''}
        ${c.injuries ? chip(`${c.injuries} injur${c.injuries === 1 ? 'y' : 'ies'}`, '#B45309', 'rgba(245,158,11,0.15)') : ''}
        ${c.towAway ? chip('Tow-away', '#0B1E3F', 'rgba(11,30,63,0.06)') : ''}</div>
    </td></tr>`).join('');
  const parts = [
    args.inspections.length ? `${args.inspections.length} new inspection${args.inspections.length === 1 ? '' : 's'}` : '',
    args.crashes.length ? `${args.crashes.length} new crash${args.crashes.length === 1 ? '' : 'es'}` : '',
  ].filter(Boolean);
  const headline = parts.join(' and ');
  const urgent = oosCount > 0 || args.crashes.length > 0;
  const body = `
<div style="display:inline-block;padding:4px 10px;background:${urgent ? 'rgba(220,38,38,0.08)' : 'rgba(11,30,63,0.06)'};color:${urgent ? '#DC2626' : '#0B1E3F'};border-radius:999px;font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px;">Your company · FMCSA safety record</div>
${h1(`${escapeHtml(headline.charAt(0).toUpperCase() + headline.slice(1))} on ${italicAccent('your record')}`)}
<div style="background:#F5F3EE;border-radius:12px;padding:20px;margin:0 0 24px 0;">
  <div style="font-size:13px;font-family:'SF Mono',Menlo,Consolas,monospace;color:rgba(11,30,63,0.55);margin-bottom:8px;">${escapeHtml(args.carrier.name)} · ${escapeHtml(idLine)}</div>
  ${insRows ? `<div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin:8px 0 4px;">Roadside inspections</div><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${insRows}</table>` : ''}
  ${crashRows ? `<div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin:16px 0 4px;">Crashes</div><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${crashRows}</table>` : ''}
</div>
${p(oosCount > 0
  ? 'Out-of-service results count most against your safety scores (CSA), and insurers look at them at renewal. If one looks wrong, you can challenge it through FMCSA&rsquo;s DataQs system.'
  : 'These now count toward your safety scores (CSA) for the next 24 months. If one looks wrong, you can challenge it through FMCSA&rsquo;s DataQs system.')}
${args.crashes.length ? p('FMCSA crash records don&rsquo;t say who was at fault. You can ask FMCSA to review a crash you didn&rsquo;t cause through DataQs.') : ''}
${button(args.siteUrl + '/dashboard', 'See your full record →')}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">Inspections reach FMCSA a few days after they happen. Manage these emails in <a href="${args.siteUrl}/settings" style="color:#0B1E3F;text-decoration:underline;">Settings &rarr; Notifications</a>.</div>`;
  return {
    subject: oosCount > 0
      ? `Out-of-service inspection on your DOT${parts.length > 1 || args.inspections.length > 1 ? ` (${headline})` : ''}`
      : `Your FMCSA safety record: ${headline}`,
    html: baseLayout({ preview: `${args.carrier.name}: ${headline}`, body, unsubEmail: args.recipientEmail }),
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
${p(`You didn&rsquo;t run any lookups or watchlist refreshes in the last 7 days. No news is good news, but if you&rsquo;ve got a load to book this week, verify the broker first. It only takes a moment.`)}
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

// ---------- Abandoned cart recovery ----------

// Sent ~1 hour after a user starts checkout but never confirms payment.
// Friendly nudge + 20% off first month (NEW20). The promo code is wired
// to the existing checkout URL (`?promoCode=NEW20`) so the discount is
// already applied when they land back on the page.
export function abandonedCart1hTemplate(args: {
  planLabel: string;
  priceLabel: string;          // e.g. "$49/mo"
  recipientEmail: string;
  recipientName?: string;
  resumeUrl: string;           // checkout URL with promo applied
  promoCode: string;           // 'NEW20'
}): { subject: string; html: string } {
  const greeting = args.recipientName ? `Hi ${escapeHtml(args.recipientName.split(' ')[0])},` : 'Hi,';
  const body = `
${h1(`${greeting} you left ${italicAccent('Haulock ' + escapeHtml(args.planLabel))} in your cart.`)}
${p(`Looks like something pulled you away during checkout. We&rsquo;ve got your spot held — and to make it easier, here&rsquo;s <strong style="color:#FF6B35;">20% off your first month</strong>.`)}

<div style="background:linear-gradient(135deg,#0B1E3F 0%,rgba(11,30,63,0.92) 100%);border-radius:14px;padding:22px 24px;margin:0 0 24px 0;color:#ffffff;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td>
        <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.55);margin-bottom:6px;">Your code</div>
        <div style="font-size:26px;font-weight:700;letter-spacing:0.04em;color:#ffffff;">${escapeHtml(args.promoCode)}</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.65);margin-top:6px;">20% off your first month of ${escapeHtml(args.planLabel)} (${escapeHtml(args.priceLabel)}). Renews at full price. One-time use.</div>
      </td>
    </tr>
  </table>
</div>

${button(args.resumeUrl, 'Finish checkout with 20% off →')}

${p(`The ride from "I&rsquo;ll deal with it later" to "I just got burned on a load" is short. Verifying brokers takes 2 seconds with Haulock — long before money or trailers move.`)}

<div style="background:rgba(11,30,63,0.04);border-radius:12px;padding:16px 18px;margin:0 0 24px 0;">
  <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:8px;">What you get</div>
  <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7;color:rgba(11,30,63,0.85);">
    <li>Live FMCSA broker verification with risk scoring</li>
    <li>Rate-con PDF scan — flags fraud before you book</li>
    <li>Watchlist alerts when a broker&rsquo;s status changes</li>
    <li>Cancel anytime from Settings</li>
  </ul>
</div>

<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">Code expires in 7 days. Questions? Just reply to this email.</div>`;
  return {
    subject: `You left Haulock ${args.planLabel} behind — 20% off if you finish today`,
    html: baseLayout({ preview: `Use NEW20 for 20% off your first month of Haulock ${args.planLabel}.`, body, unsubEmail: args.recipientEmail }),
  };
}

// Sent ~7 days after the abandoned checkout if the user still hasn't
// completed. Last-chance reminder — same code, ending soon framing.
export function abandonedCart7dTemplate(args: {
  planLabel: string;
  priceLabel: string;
  recipientEmail: string;
  recipientName?: string;
  resumeUrl: string;
  promoCode: string;
}): { subject: string; html: string } {
  const greeting = args.recipientName ? `Hi ${escapeHtml(args.recipientName.split(' ')[0])},` : 'Hi,';
  const body = `
<div style="display:inline-block;padding:4px 10px;background:rgba(255,107,53,0.12);color:#FF6B35;border-radius:999px;font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px;font-weight:600;">Last chance · code expires today</div>
${h1(`${greeting} your ${italicAccent('20% off')} is about to disappear.`)}
${p(`Quick one. We held the discount on your Haulock ${escapeHtml(args.planLabel)} cart for a week. After today the code <strong style="color:#0B1E3F;">${escapeHtml(args.promoCode)}</strong> goes away and the plan goes back to full price.`)}

<div style="background:linear-gradient(135deg,#FF6B35 0%,#FF8556 100%);border-radius:14px;padding:22px 24px;margin:0 0 24px 0;color:#ffffff;">
  <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.7);margin-bottom:6px;">Final reminder</div>
  <div style="font-size:24px;font-weight:700;color:#ffffff;line-height:1.2;">20% off your first month</div>
  <div style="font-size:14px;color:rgba(255,255,255,0.85);margin-top:8px;">Code <strong style="letter-spacing:0.04em;">${escapeHtml(args.promoCode)}</strong> · ${escapeHtml(args.planLabel)} (${escapeHtml(args.priceLabel)}) · expires today</div>
</div>

${button(args.resumeUrl, 'Lock in 20% off now →')}

${p(`The carriers who get burned by double-brokering and identity-fraud rate cons all say the same thing afterward: <em style="color:#0B1E3F;">"I should have just verified them first."</em> Haulock is the 2-second check that prevents the 6-month loss.`)}

<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;margin-top:8px;">Not the right fit? No worries — we won&rsquo;t bug you again.</div>`;
  return {
    subject: `Last day for 20% off Haulock ${args.planLabel}`,
    html: baseLayout({ preview: `Code ${args.promoCode} expires today — 20% off your first month.`, body, unsubEmail: args.recipientEmail }),
  };
}

// New affiliate application — sent to the operator inbox (marketing@) when
// someone fills out the public /affiliate form. Not a customer-facing email,
// so we skip the unsubscribe block.
export function affiliateApplicationTemplate(args: {
  name: string;
  email: string;
  audience?: string;
  audienceSize?: string;
  social?: string;
  message?: string;
  source?: string;
}): { subject: string; html: string } {
  const row = (label: string, value: string | undefined) => value
    ? `<div style="margin:0 0 14px 0;"><div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:4px;">${escapeHtml(label)}</div><div style="font-size:15px;color:#0B1E3F;line-height:1.55;">${escapeHtml(value)}</div></div>`
    : '';
  const body = `
<div style="display:inline-block;padding:4px 10px;background:rgba(11,30,63,0.08);color:#0B1E3F;border-radius:999px;font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px;">New affiliate application</div>
${h1(`${italicAccent(escapeHtml(args.name))} wants to promote Haulock.`)}
<div style="background:rgba(11,30,63,0.04);border-radius:12px;padding:20px 22px;margin:0 0 24px 0;">
  ${row('Name', args.name)}
  ${row('Email', args.email)}
  ${row('Audience', args.audience)}
  ${row('Audience size', args.audienceSize)}
  ${row('Social media profiles', args.social)}
  ${row('How they heard about us', args.source)}
  ${row('How they plan to promote', args.message)}
</div>
${p('Reply directly to this email to reach the applicant. To approve them, create a Stripe promotion code (or pick an existing one), then go to Admin → Users, find their account, and click <strong>Make affiliate</strong> to attach the code and set their commission.')}
${divider()}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">Internal notification · sent automatically by the Haulock affiliate form.</div>`;
  return {
    subject: `Affiliate application: ${args.name}`,
    html: baseLayout({ preview: `${args.name} (${args.email}) wants to promote Haulock.`, body }),
  };
}

// Free-user nurture sequence — sent weekly to users still on Free who
// haven't unsubscribed. Three rotating angles keep the inbox from feeling
// like a copy/paste loop: value-prop, proof-led, and limited-time-pitch.
// Always carries the same NEW20 promo code so a single affiliate code
// powers the redemption tracking.
export function nurtureFreeUserTemplate(args: {
  firstName: string;
  promoCode: string;       // 'NEW20'
  upgradeUrl: string;      // /pricing or /checkout/carrier?promoCode=NEW20
  recipientEmail: string;
  weekIndex: number;       // 0,1,2,3,... — drives the angle rotation
}): { subject: string; html: string } {
  const greeting = args.firstName ? `${args.firstName}, ` : '';
  const angles = [
    {
      subject: `${args.firstName ? `${args.firstName}, ` : ''}your free Haulock has 3 lookups. ${args.promoCode} unlocks unlimited.`,
      preview: `Carrier plan + your unlimited lookups for 20% off the first month.`,
      pill: 'You\'re on Free',
      pillBg: 'rgba(11,30,63,0.08)', pillColor: '#0B1E3F',
      headline: `${greeting}3 lookups isn&rsquo;t enough when ${italicAccent('one bad load')} costs $4,200.`,
      body: [
        'We built Haulock for the moment you&rsquo;re staring at a rate con and your gut says <em style="color:#0B1E3F;">something\'s off</em>. The free plan gives you 3 lookups a month — fine for the curious, not enough for the operator who runs five trucks a day.',
        'Carrier plan unlocks <strong>unlimited verifications, the rate-con PDF analyzer, and 25 watchlist slots</strong> for $49/month. With <strong>'+ args.promoCode +'</strong> it&rsquo;s $39.20 the first month.',
      ],
    },
    {
      subject: `Real fraud caught last week. Want unlimited Haulock for ${20}% off?`,
      preview: `One real story from a Carrier-plan user this week.`,
      pill: 'From the front lines',
      pillBg: 'rgba(220,38,38,0.1)', pillColor: '#DC2626',
      headline: `${greeting}a Haulock user dodged a $${italicAccent('5,400')} double-broker last week.`,
      body: [
        'Real story: a carrier ran a broker through Haulock before tendering a rate. Surety bond cancelled three weeks ago, FMCSA address was a UPS Store, and two trade-press hits flagged the same operator under a different MC last year. Three signals, scanned in 2 seconds, and they walked away from a load they would have eaten.',
        'You&rsquo;re on Free with 3 lookups a month. Carrier plan is unlimited. <strong>'+ args.promoCode +'</strong> takes 20% off your first month — and the kind of catch above is exactly what you start running into when verification stops being rationed.',
      ],
    },
    {
      subject: `${args.promoCode} won't sit forever. 20% off Haulock Carrier.`,
      preview: `Friendly reminder — your discount code is still active.`,
      pill: 'Last call',
      pillBg: 'rgba(255,107,53,0.12)', pillColor: '#FF6B35',
      headline: `${greeting}your code ${italicAccent(args.promoCode)} is still active.`,
      body: [
        'Quick one. We held <strong>'+ args.promoCode +'</strong> on your account for whenever you wanted to upgrade — 20% off your first month of Haulock Carrier, no card surprises.',
        'If freight fraud isn&rsquo;t hitting you right now, ignore this. If it is — and you keep getting <em style="color:#0B1E3F;">that feeling</em> when a rate con lands — Carrier plan covers unlimited verifications, the PDF analyzer, and the watchlist that emails you the moment something on a broker changes.',
      ],
    },
  ];
  const angle = angles[args.weekIndex % angles.length];

  const body = `
<div style="display:inline-block;padding:4px 10px;background:${angle.pillBg};color:${angle.pillColor};border-radius:999px;font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px;">${escapeHtml(angle.pill)}</div>
${h1(angle.headline)}
${angle.body.map((para) => p(para)).join('\n')}

<div style="background:linear-gradient(135deg,#FF6B35 0%,#FF8556 100%);border-radius:14px;padding:22px 24px;margin:6px 0 24px 0;color:#ffffff;">
  <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.7);margin-bottom:6px;">Your code</div>
  <div style="font-size:24px;font-weight:700;color:#ffffff;line-height:1.2;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.04em;">${escapeHtml(args.promoCode)}</div>
  <div style="font-size:14px;color:rgba(255,255,255,0.85);margin-top:6px;">20% off your first month &middot; applied automatically at checkout</div>
</div>

${button(args.upgradeUrl, `Upgrade with ${args.promoCode} →`)}
${divider()}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">Don&rsquo;t need this right now? No worries — toggle weekly nudges off in <a href="${args.upgradeUrl.replace(/\/pricing.*|\/checkout.*/, '')}/settings" style="color:#0B1E3F;text-decoration:underline;">Settings &rarr; Notifications</a> or unsubscribe below.</div>`;

  return {
    subject: angle.subject,
    html: baseLayout({ preview: angle.preview, body, unsubEmail: args.recipientEmail }),
  };
}

// ---------- Sales emails (admin Sales tab) ----------
// The operator writes plain text (blank line = new paragraph, **bold**,
// bare https:// links) with merge tags already applied. Optionally shows
// the recipient's OWN recent lookups so the email is about their freight,
// not a generic pitch. Users with no lookups get a clearly-labelled
// example check instead — never anyone else's real lookup.

export type SalesEmailLookup = {
  name: string;
  idLabel: string;
  verdict: 'low' | 'medium' | 'high';
  score: number;
  topFlag: string | null;
  flagCount: number;
  at: string;
  recheckedAt?: string | null;
  sample?: 'own';
};

const LOOKUPS_TOKEN = /\{\{\s*lookups\s*\}\}/gi;

function salesParagraph(para: string): string {
  let html = escapeHtml(para);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#0B1E3F;">$1</strong>');
  html = html.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" style="color:#0B1E3F;text-decoration:underline;">$1</a>');
  html = html.replace(/\n/g, '<br>');
  return p(html);
}

const VERDICT_STYLE: Record<SalesEmailLookup['verdict'], { label: string; bg: string; color: string }> = {
  low: { label: 'Low risk', bg: 'rgba(22,163,74,0.1)', color: '#16A34A' },
  medium: { label: 'Medium risk', bg: 'rgba(245,158,11,0.14)', color: '#B45309' },
  high: { label: 'High risk', bg: 'rgba(220,38,38,0.1)', color: '#DC2626' },
};

const EXAMPLE_LOOKUP: SalesEmailLookup = {
  name: 'Summit Freight Logistics',
  idLabel: 'MC 847291',
  verdict: 'high',
  score: 82,
  topFlag: 'Surety bond cancelled 3 weeks ago',
  flagCount: 3,
  at: '',
};

function lookupRow(l: SalesEmailLookup, last: boolean): string {
  const v = VERDICT_STYLE[l.verdict];
  const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
  // "checked Jun 3 · updated Oct 13" when we re-scanned it before sending.
  const meta = [
    l.idLabel,
    l.sample === 'own' ? (l.at ? `scanned ${fmt(l.at)}` : '') : l.at ? `checked ${fmt(l.at)}` : '',
    l.recheckedAt ? `updated ${fmt(l.recheckedAt)}` : '',
  ].filter(Boolean).join(' · ');
  const flag = l.topFlag
    ? `<div style="margin-top:6px;font-size:13px;color:${l.verdict === 'low' ? 'rgba(11,30,63,0.6)' : v.color};">&#9888; ${escapeHtml(l.topFlag)}${l.flagCount > 1 ? ` <span style="color:rgba(11,30,63,0.45);">+${l.flagCount - 1} more</span>` : ''}</div>`
    : `<div style="margin-top:6px;font-size:13px;color:#16A34A;">&#10003; No warning signs found</div>`;
  return `<tr><td style="padding:14px 16px;${last ? '' : 'border-bottom:1px solid rgba(11,30,63,0.08);'}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="vertical-align:top;">
      <div style="font-size:15px;font-weight:600;color:#0B1E3F;">${escapeHtml(l.name)}</div>
      ${meta ? `<div style="font-size:12px;color:rgba(11,30,63,0.5);font-family:'SF Mono',Menlo,Consolas,monospace;margin-top:2px;">${escapeHtml(meta)}</div>` : ''}
      ${flag}
    </td>
    <td style="vertical-align:top;text-align:right;white-space:nowrap;padding-left:12px;">
      <span style="display:inline-block;padding:4px 10px;background:${v.bg};color:${v.color};border-radius:999px;font-size:12px;font-weight:600;">${v.label} · ${l.score}</span>
    </td>
  </tr></table>
</td></tr>`;
}

// Three cases, each with its own intro line so the operator's message never
// has to guess which one a recipient gets: their own recent checks; a free
// scan of their own company when they've checked nothing ("on us"); or a
// clearly-labelled fictional example when we don't know their company.
function salesLookupsBlock(lookups: SalesEmailLookup[], siteUrl: string): string {
  const example = lookups.length === 0;
  const own = !example && lookups[0].sample === 'own';
  const rows = example ? [EXAMPLE_LOOKUP] : lookups;
  const flagged = rows.filter((l) => l.verdict !== 'low').length;
  const verifyLink = `<a href="${siteUrl}/verify" style="color:#0B1E3F;text-decoration:underline;">haulock.com/verify</a>`;
  const intro = example
    ? 'You haven&rsquo;t checked a company yet. Here&rsquo;s what a check looks like:'
    : own
      ? 'You haven&rsquo;t checked a company yet, so we ran a free check for you, on us. We picked the company we know best: yours. This is what anyone sees when they look you up on Haulock:'
      : 'Here&rsquo;s what you checked recently:';
  const label = example ? 'Example check' : own ? 'Free check · on us' : 'Your recent checks';
  const note = example
    ? `This is an example. Run your own in seconds at ${verifyLink}.`
    : own
      ? `Next time a rate con lands, run the broker through Haulock the same way at ${verifyLink}.`
      : flagged > 0
        ? `Haulock flagged ${flagged === 1 ? 'one of these' : `${flagged} of these`} &mdash; exactly what&rsquo;s easy to miss on a busy day.`
        : `All clear on these. That&rsquo;s the peace of mind you can have on every load.`;
  return `${p(intro)}<div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.5);margin:4px 0 8px 0;">${label}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(11,30,63,0.1);border-radius:12px;background:#FAF9F6;margin-bottom:10px;">
${rows.map((l, i) => lookupRow(l, i === rows.length - 1)).join('\n')}
</table>
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;margin-bottom:24px;">${note}</div>`;
}

export function salesEmailTemplate(args: {
  subject: string;
  body: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  showLookups: boolean;
  lookups?: SalesEmailLookup[] | null;
  recipientEmail: string;
  siteUrl: string;
}): { subject: string; html: string } {
  const block = args.showLookups ? salesLookupsBlock(args.lookups || [], args.siteUrl) : '';
  const cta = args.ctaLabel && args.ctaUrl && /^https?:\/\//i.test(args.ctaUrl) ? button(escapeHtml(args.ctaUrl), escapeHtml(args.ctaLabel)) : '';
  // A paragraph that is just {{lookups}} marks where the block goes. With
  // no marker it goes after the opening line(s), so the email starts with
  // a human sentence, then shows proof, then the pitch.
  const paras = args.body.trim().split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  let placed = false;
  const parts: string[] = [];
  for (const para of paras) {
    if (/^\{\{\s*lookups\s*\}\}$/i.test(para)) {
      if (block && !placed) parts.push(block);
      placed = true;
      continue;
    }
    const text = para.replace(LOOKUPS_TOKEN, '').trim();
    if (text) parts.push(salesParagraph(text));
  }
  if (block && !placed) {
    const at = paras.length > 1 && paras[0].length < 40 ? 2 : 1;
    parts.splice(Math.min(at, parts.length), 0, block);
  }
  // The button goes above a closing "Thanks, …" sign-off, not under it.
  const lastPara = paras[paras.length - 1] || '';
  if (cta && parts.length > 1 && /^(thanks|thank you|best|cheers|regards|talk soon)\b/i.test(lastPara)) {
    parts.splice(parts.length - 1, 0, cta);
  } else if (cta) {
    parts.push(cta);
  }
  const body = parts.join('\n');
  const preview = args.body.replace(LOOKUPS_TOKEN, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return {
    subject: args.subject,
    html: baseLayout({ preview, body, unsubEmail: args.recipientEmail }),
  };
}

// Operator notification when an affiliate requests a payout.
export function payoutRequestedTemplate(args: {
  affiliateName: string;
  affiliateEmail: string;
  amountCents: number;
  code: string;
  redemptions: number;
  adminUrl: string;
}): { subject: string; html: string } {
  const amount = `$${(args.amountCents / 100).toFixed(2)}`;
  const body = `
<div style="display:inline-block;padding:4px 10px;background:rgba(255,107,53,0.12);color:#FF6B35;border-radius:999px;font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px;">Payout requested</div>
${h1(`${italicAccent(escapeHtml(args.affiliateName))} requested ${amount}.`)}
<div style="background:rgba(11,30,63,0.04);border-radius:12px;padding:20px 22px;margin:0 0 24px 0;">
  <div style="margin:0 0 12px 0;"><div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:4px;">Amount</div><div style="font-size:22px;font-weight:600;color:#0B1E3F;">${escapeHtml(amount)}</div></div>
  <div style="margin:0 0 12px 0;"><div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:4px;">Affiliate</div><div style="font-size:15px;color:#0B1E3F;">${escapeHtml(args.affiliateName)} &middot; ${escapeHtml(args.affiliateEmail)}</div></div>
  <div style="margin:0 0 12px 0;"><div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:4px;">Promo code</div><div style="font-size:15px;color:#0B1E3F;font-family:'SF Mono',Menlo,Consolas,monospace;">${escapeHtml(args.code)}</div></div>
  <div><div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:4px;">Redemptions to date</div><div style="font-size:15px;color:#0B1E3F;">${args.redemptions}</div></div>
</div>
${button(args.adminUrl, 'Review in admin →')}
${p('You promised to pay within 30 days. When you send the money, click <strong>Mark paid</strong> in the admin Affiliates tab so the affiliate sees it cleared and the balance resets.')}
${divider()}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">Internal notification · sent automatically when an affiliate requests a payout.</div>`;
  return {
    subject: `Payout requested: ${amount} — ${args.affiliateName}`,
    html: baseLayout({ preview: `${args.affiliateName} requested ${amount} via code ${args.code}.`, body }),
  };
}

// Affiliate-facing email confirming a payout was sent.
export function payoutSentTemplate(args: {
  affiliateName: string;
  amountCents: number;
  code: string;
  paidAt: string;          // ISO
  recipientEmail: string;
  siteUrl: string;
  notes?: string;
}): { subject: string; html: string } {
  const amount = `$${(args.amountCents / 100).toFixed(2)}`;
  const paidDate = new Date(args.paidAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const notesBlock = args.notes && args.notes.trim() ? `
<div style="background:rgba(11,30,63,0.04);border-radius:12px;padding:18px 20px;margin:0 0 24px 0;">
  <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:8px;">Note from Haulock</div>
  <div style="font-size:14px;line-height:1.65;color:rgba(11,30,63,0.85);">${escapeHtml(args.notes)}</div>
</div>` : '';
  const body = `
<div style="display:inline-block;padding:4px 10px;background:rgba(22,163,74,0.12);color:#16A34A;border-radius:999px;font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px;">Payout sent</div>
${h1(`${escapeHtml(args.affiliateName.split(' ')[0])}, your ${italicAccent(amount)} is on the way.`)}
<div style="background:linear-gradient(135deg,#16A34A 0%,#15803d 100%);border-radius:14px;padding:22px 24px;margin:0 0 24px 0;color:#ffffff;">
  <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.7);margin-bottom:6px;">Sent</div>
  <div style="font-size:30px;font-weight:700;color:#ffffff;line-height:1.1;">${escapeHtml(amount)}</div>
  <div style="font-size:14px;color:rgba(255,255,255,0.85);margin-top:8px;">Code <strong style="letter-spacing:0.04em;">${escapeHtml(args.code)}</strong> &middot; paid ${escapeHtml(paidDate)}</div>
</div>
${notesBlock}
${p('Funds should hit your account within a few business days depending on your bank. Your earnings counter on Haulock has been reset for this payout — keep promoting and the next balance starts now.')}
${button(args.siteUrl + '/earnings', 'Open my earnings →')}
${divider()}
<div style="font-size:13px;color:rgba(11,30,63,0.55);line-height:1.6;">Questions? Reply to this email.</div>`;
  return {
    subject: `Your ${amount} Haulock affiliate payout`,
    html: baseLayout({ preview: `${amount} just left our account — code ${args.code}.`, body, unsubEmail: args.recipientEmail }),
  };
}

// ---------- Forward-to-scan replies (scan@haulock.com) ----------

export type InboundScanResult = {
  kind: 'ratecon' | 'coi' | 'mc';
  filename?: string;
  // Company the check is about and its identifiers line.
  headline: string;
  idLine?: string;
  tone: 'good' | 'warn' | 'bad';
  verdictLabel: string;
  score?: number;
  findings: { tone: 'good' | 'warn' | 'bad' | 'info'; title: string; desc: string }[];
  disclaimer: string;
};

export type InboundReplyMode =
  | { mode: 'full' }
  | { mode: 'preview'; remaining: number }
  | { mode: 'limit'; reason: string; upgrade: boolean }
  | { mode: 'nothing' }
  | { mode: 'error' };

const TONE_COLOR = { good: '#16A34A', warn: '#D97706', bad: '#DC2626', info: 'rgba(11,30,63,0.45)' } as const;
const TONE_BG = { good: 'rgba(22,163,74,0.07)', warn: 'rgba(245,158,11,0.08)', bad: 'rgba(220,38,38,0.06)' } as const;
const KIND_LABEL = { ratecon: 'Rate con · broker check', coi: 'Insurance certificate (COI) check', mc: 'MC / DOT check' } as const;

function scanCard(r: InboundScanResult, maxFindings: number): string {
  const shown = r.findings.slice(0, maxFindings);
  const hidden = r.findings.length - shown.length;
  const rows = shown.map((f) => `
      <tr><td style="padding:8px 0;border-top:1px solid rgba(11,30,63,0.06);">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
          <td style="width:10px;vertical-align:top;padding-top:6px;"><div style="width:6px;height:6px;border-radius:50%;background:${TONE_COLOR[f.tone]};"></div></td>
          <td style="padding-left:10px;">
            <div style="font-size:14px;font-weight:600;color:#0B1E3F;">${escapeHtml(f.title)}</div>
            <div style="font-size:13px;color:rgba(11,30,63,0.65);line-height:1.5;">${escapeHtml(f.desc)}</div>
          </td>
        </tr></table>
      </td></tr>`).join('');
  return `
<div style="background:${TONE_BG[r.tone]};border:1px solid ${TONE_COLOR[r.tone]}33;border-radius:12px;padding:20px;margin:0 0 20px 0;">
  <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:6px;">${KIND_LABEL[r.kind]}${r.filename ? ` · ${escapeHtml(r.filename)}` : ''}</div>
  <div style="font-size:20px;font-weight:600;color:#0B1E3F;margin-bottom:2px;">${escapeHtml(r.headline)}</div>
  ${r.idLine ? `<div style="font-size:13px;font-family:'SF Mono',Menlo,Consolas,monospace;color:rgba(11,30,63,0.55);margin-bottom:12px;">${escapeHtml(r.idLine)}</div>` : ''}
  <div style="display:inline-block;padding:5px 12px;background:${TONE_COLOR[r.tone]};color:#ffffff;border-radius:6px;font-size:13px;font-weight:600;margin-bottom:${shown.length ? '12px' : '0'};">${escapeHtml(r.verdictLabel)}${r.score != null ? ` · ${r.score}/100` : ''}</div>
  ${shown.length ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>` : ''}
  ${hidden > 0 ? `<div style="font-size:13px;color:rgba(11,30,63,0.6);margin-top:8px;">+ ${hidden} more finding${hidden === 1 ? '' : 's'} in the full report</div>` : ''}
</div>`;
}

export function inboundScanReplyTemplate(args: {
  results: InboundScanResult[];
  reply: InboundReplyMode;
  siteUrl: string;
  scanAddress: string;
  hasAccount: boolean;
}): { html: string; preview: string } {
  const { results, reply, siteUrl, scanAddress, hasAccount } = args;
  const signup = `${siteUrl}/signup?ref=email-scan`;
  let body = '';
  let preview = '';

  if (reply.mode === 'full' || reply.mode === 'preview') {
    const worst = results.some((r) => r.tone === 'bad') ? 'bad' : results.some((r) => r.tone === 'warn') ? 'warn' : 'good';
    const lead = worst === 'bad' ? 'We found things that don’t check out.' : worst === 'warn' ? 'A few things to confirm before you book.' : 'Nothing stood out in our checks.';
    preview = `${results[0]?.verdictLabel || 'Your Haulock check'} — ${results[0]?.headline || ''}`;
    body += h1(`Your Haulock check is ${italicAccent('ready.')}`);
    body += p(lead);
    body += results.map((r) => scanCard(r, reply.mode === 'full' ? 6 : 1)).join('');
    if (reply.mode === 'full') {
      body += button(`${siteUrl}/history`, 'Open in your Haulock history →');
    } else {
      body += p(`This is a preview. Full email reports, with every finding and the complete FMCSA record, are included on paid plans.${hasAccount ? '' : ' A free account lets you run broker lookups and PDF edit checks in the app.'}${reply.remaining > 0 ? ` You have ${reply.remaining} free email check${reply.remaining === 1 ? '' : 's'} left this month.` : ''}`);
      body += button(hasAccount ? `${siteUrl}/plan` : signup, hasAccount ? 'See plans →' : 'Create a free account →');
    }
    body += divider();
    body += results
      .map((r) => r.disclaimer)
      .filter((d, i, arr) => arr.indexOf(d) === i)
      .map((d) => `<div style="font-size:12px;color:rgba(11,30,63,0.55);line-height:1.6;margin-bottom:8px;">${escapeHtml(d)}</div>`)
      .join('');
  } else if (reply.mode === 'limit') {
    preview = 'You’ve reached your email check limit for this month';
    body += h1(`You’ve used this month’s ${italicAccent('email checks.')}`);
    body += p(escapeHtml(reply.reason));
    body += button(reply.upgrade ? `${siteUrl}/plan` : signup, reply.upgrade ? 'Upgrade your plan →' : 'Create a free account →');
  } else if (reply.mode === 'nothing') {
    preview = 'Attach the rate con or COI and send it again';
    body += h1(`We didn’t find anything ${italicAccent('to check.')}`);
    body += p(`Forward the email with the <strong>rate confirmation</strong> or <strong>certificate of insurance (COI)</strong> attached as a PDF, or include the MC or DOT number in your message, and send it to <strong>${escapeHtml(scanAddress)}</strong> again.`);
  } else {
    preview = 'We couldn’t finish this check';
    body += h1(`We couldn’t finish ${italicAccent('this check.')}`);
    body += p('Something went wrong reading your attachment. Try again in a few minutes, or upload it at haulock.com. If it keeps happening, reply to contact@haulock.com.');
  }

  body += `<div style="font-size:12px;color:rgba(11,30,63,0.5);line-height:1.6;margin-top:16px;">Haulock doesn’t keep your attachments. ${hasAccount ? 'The result is saved to your Haulock history.' : ''}</div>`;
  return {
    preview,
    html: baseLayout({
      preview,
      body,
      reason: `You’re receiving this because you emailed <a href="mailto:${scanAddress}" style="color:rgba(11,30,63,0.7);text-decoration:underline;">${scanAddress}</a>.`,
    }),
  };
}
