import { NextResponse } from 'next/server';
import { isResendConfigured, sendEmail, reportShareTemplate } from '@/lib/email';
import { buildReportPdf, reportPdfFilename } from '@/lib/report-pdf';
import { getServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Loose RFC-5322-ish email validation. Good enough for a UI guard; the real
// authority is the SMTP server.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  if (!isResendConfigured()) {
    return NextResponse.json({ error: 'Email is not configured. Set RESEND_API_KEY.' }, { status: 503 });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const report = body?.report;
  if (!report || typeof report !== 'object') {
    return NextResponse.json({ error: 'Missing report' }, { status: 400 });
  }

  // Accept "to" as a string ("a@b.com, c@d.com") or an array.
  const rawTo: unknown = body?.to;
  const tos: string[] = Array.isArray(rawTo)
    ? rawTo.map((s) => String(s).trim()).filter(Boolean)
    : String(rawTo || '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  if (tos.length === 0) return NextResponse.json({ error: 'Missing recipient(s)' }, { status: 400 });
  if (tos.length > 10) return NextResponse.json({ error: 'Maximum 10 recipients per send' }, { status: 400 });
  const bad = tos.find((e) => !EMAIL_RE.test(e));
  if (bad) return NextResponse.json({ error: `Invalid email: ${bad}` }, { status: 400 });

  const message = typeof body?.message === 'string' ? body.message.slice(0, 1000) : undefined;

  // Sender identity — pulled from the signed-in user. Used for "From: Sender Name"
  // attribution in the email body and to set Reply-To so the recipient can
  // respond directly to the person who shared the report.
  const supabase = getServerSupabase();
  let senderName: string | undefined;
  let senderEmail: string | undefined;
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    senderEmail = data?.user?.email;
    senderName = data?.user?.user_metadata?.full_name || data?.user?.user_metadata?.name || undefined;
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://haulock.com';

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await buildReportPdf(report);
  } catch (err: any) {
    console.error('[report/email] PDF build failed:', err?.message);
    return NextResponse.json({ error: 'Could not generate the PDF report' }, { status: 500 });
  }

  const tpl = reportShareTemplate({
    report: {
      name: report.name || 'Carrier',
      mc: report.mc,
      dot: report.dot,
      score: typeof report.score === 'number' ? report.score : 0,
      verdict: report.verdict || 'low',
      flags: report.flags,
      address: report.address,
      insuranceSummary: report.insuranceSummary,
      safetyRating: report.safetyRating,
      authorityStatus: report.authorityStatus,
      brokerAuthority: report.brokerAuthority,
    },
    senderName,
    senderEmail,
    message,
    siteUrl,
  });

  try {
    await sendEmail({
      to: tos,
      subject: tpl.subject,
      html: tpl.html,
      replyTo: senderEmail,
      attachments: [
        {
          filename: reportPdfFilename(report),
          content: Buffer.from(pdfBytes),
          contentType: 'application/pdf',
        },
      ],
    });
  } catch (err: any) {
    console.error('[report/email] send failed:', err?.message);
    return NextResponse.json({ error: err?.message || 'Failed to send email' }, { status: 502 });
  }

  return NextResponse.json({ ok: true, sentTo: tos.length });
}
