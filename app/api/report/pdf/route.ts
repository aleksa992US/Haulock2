import { NextResponse } from 'next/server';
import { buildReportPdf, reportPdfFilename } from '@/lib/report-pdf';
import { getServerSupabase } from '@/lib/supabase/server';
import { checkSimpleRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Building the PDF fetches FMCSA's 24-month inspection data (up to 10s).
export const maxDuration = 30;

export async function POST(req: Request) {
  // Signed-in users only: the PDF is Haulock-branded and built from the
  // posted report, so an open endpoint could mint fake "Haulock" reports.
  const supabase = getServerSupabase();
  if (supabase) {
    const { data: userData } = await supabase.auth.getUser();
    const me = userData?.user;
    if (!me) return NextResponse.json({ error: 'Sign in to export a report.' }, { status: 401 });
    const rl = checkSimpleRateLimit({ bucket: 'report-pdf', identity: me.id, max: 60, windowMs: 60 * 60_000 });
    if (!rl.ok) return NextResponse.json({ error: 'Too many exports — try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });
  }
  let report: any;
  try {
    const body = await req.json();
    report = body?.report;
    if (!report || typeof report !== 'object') {
      return NextResponse.json({ error: 'Missing report' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const bytes = await buildReportPdf(report);
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${reportPdfFilename(report)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
