// Preview of the "What's new" email (lib/email.ts whatsNewTemplate): writes the HTML and
// full-page screenshots (desktop and phone width) to promo-videos/out/email/. Images load
// from the local app (public/email/whats-new/), so run it with `npm run dev` up. Sends
// nothing.
// Usage (from the repo root): npx tsx promo-videos/scripts/preview-whats-new.cts [--url http://localhost:3000]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { whatsNewTemplate } from '../../lib/email';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  const out = path.resolve('promo-videos/out/email');
  fs.mkdirSync(out, { recursive: true });
  const { subject, html } = whatsNewTemplate({ firstName: 'Marcus', recipientEmail: 'dispatch@example.com', siteUrl: url });
  fs.writeFileSync(path.join(out, 'whats-new.html'), html);
  fs.writeFileSync(path.join(out, 'whats-new.subject.txt'), subject + '\n');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  for (const [name, width, scale] of [['desktop', 680, 2], ['phone', 390, 3]] as const) {
    await page.setViewport({ width, height: 900, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(out, `whats-new-${name}.png`), fullPage: true });
  }
  await browser.close();
  console.log(subject);
  console.log(out);
})();
