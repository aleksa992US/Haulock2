// Renders PDF pages to PNG with the app's own pdf.js. Needs the app running (it serves
// /pdfjs).
//   (no args)            page 1 of the sample rate con, as signed (version 2) and as received
//                        (last version), for the `pdf-tamper` hook
//   --pdf <file> --name <prefix>   every page of <file> → public/recordings/<prefix>-p<N>.png
// Usage: node scripts/render-pdf-pages.mjs [--pdf file --name prefix] [--url http://localhost:3000]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const URL = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const SCALE = 3;

// [output name, PDF bytes, page number]
const jobs = [];
if (arg('--pdf')) {
  const bytes = fs.readFileSync(path.resolve(arg('--pdf')));
  // Pages past the end are skipped by pdf.js below (it knows the real count).
  for (let n = 1; n <= 12; n++) jobs.push([`${arg('--name')}-p${n}`, bytes, n]);
} else {
  const bytes = fs.readFileSync(path.join(ROOT, 'public/recordings/rate-con-4821.pdf'));
  const eofs = [...bytes.toString('latin1').matchAll(/%%EOF\n?/g)].map((m) => m.index + m[0].length);
  jobs.push(['rate-con-signed', bytes.subarray(0, eofs[1]), 1], ['rate-con-received', bytes, 1]);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.goto(`${URL}/robots.txt`); // same origin as /pdfjs
for (const [name, buf, pageNo] of jobs) {
  const png = await page.evaluate(
    async (b64, scale, pageNo) => {
      const pdfjs = await import('/pdfjs/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const doc = await pdfjs.getDocument({ data }).promise;
      if (pageNo > doc.numPages) return null;
      const p = await doc.getPage(pageNo);
      const vp = p.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      await p.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      return canvas.toDataURL('image/png').split(',')[1];
    },
    buf.toString('base64'),
    SCALE,
    pageNo
  );
  if (!png) continue;
  const out = path.join(ROOT, `public/recordings/${name}.png`);
  fs.writeFileSync(out, Buffer.from(png, 'base64'));
  console.log(out);
}
await browser.close();
