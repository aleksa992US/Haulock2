// Builds the app's PDF report (lib/report-pdf.ts buildReportPdf) for the example carrier in
// scripts/examples.mjs, as /api/report/pdf would. FMCSA's inspection files are stubbed with
// the example's rows (its DOT is masked).
// Usage (from the repo root): npx tsx promo-videos/scripts/render-report-pdf.cts
import fs from 'node:fs';
import path from 'node:path';

(async () => {
  const { BRAXTONE, BRAXTONE_INSPECTION_ROWS, BRAXTONE_VIOLATION_ROWS } = await import('../scripts/examples.mjs' as string);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('data.transportation.gov')) {
      const rows = u.includes('viol_code') ? BRAXTONE_VIOLATION_ROWS : u.includes('insp_date') ? BRAXTONE_INSPECTION_ROWS : [];
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(url, init);
  }) as typeof fetch;
  const { buildReportPdf, reportPdfFilename } = await import('../../lib/report-pdf');
  const bytes = await buildReportPdf(BRAXTONE);
  const out = path.resolve('promo-videos/public/recordings/report-braxtone.pdf');
  fs.writeFileSync(out, bytes);
  console.log(out, bytes.length, 'bytes ·', reportPdfFilename(BRAXTONE));
})();
