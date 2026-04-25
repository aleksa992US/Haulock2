import { NextResponse } from 'next/server';
import { buildReportPdf, reportPdfFilename } from '@/lib/report-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
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
