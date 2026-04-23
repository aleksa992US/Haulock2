import { Resend } from 'resend';

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

export type SendArgs = { to: string; subject: string; html: string; replyTo?: string };

export async function sendEmail({ to, subject, html, replyTo }: SendArgs) {
  const resend = getResend();
  if (!resend) throw new Error('RESEND_API_KEY is not set');
  const from = process.env.RESEND_FROM || 'Haulock <onboarding@resend.dev>';
  const { data, error } = await resend.emails.send({ from, to, subject, html, replyTo });
  if (error) throw new Error(error.message || 'Resend send failed');
  return data;
}

// ---------- Shared layout ----------

type LayoutArgs = {
  preview: string;
  body: string;
};

function baseLayout({ preview, body }: LayoutArgs): string {
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
        You&rsquo;re receiving this because you have an account at <a href="https://haulock.com" style="color:rgba(11,30,63,0.7);text-decoration:underline;">haulock.com</a>.
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

export function welcomeTemplate({ name, siteUrl }: { name?: string; siteUrl: string }): { subject: string; html: string } {
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
    html: baseLayout({ preview: 'Verify any broker in seconds. Start with your first lookup.', body }),
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
  <strong style="color:#0B1E3F;">Why we sent this:</strong> you just ran a broker verification on Haulock and the result returned as HIGH RISK. This alert is transactional and can&rsquo;t be unsubscribed — manage notification preferences in <a href="${siteUrl}" style="color:#0B1E3F;text-decoration:underline;">Settings → Notifications</a>.
</div>`;
  return {
    subject: `HIGH RISK alert: ${report.name}`,
    html: baseLayout({ preview: `Haulock flagged ${report.name} as HIGH RISK — here is why.`, body }),
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
