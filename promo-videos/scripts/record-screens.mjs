// Screen-records the real app for the `pdf-tamper` reel: Verify → PDF forensics,
// upload public/recordings/rate-con-4821.pdf, then move through the result.
//
//   pdf-tamper.mp4       phone screen (430×430 pt at 3×): tap "Choose PDF", "Taking the
//                        PDF apart…", the verdict, then each finding in turn.
//   pdf-tamper-zoom.mp4  the page preview at 1000 pt wide (the preview draws at most 2×, so a
//                        wider layout is what makes the page sharp): tap the white box over
//                        the detention terms, then the hidden lumper line.
//   phone-v3.png         a full-height phone screenshot (430×880 pt at 3×) of the Version 3
//                        before/after card, for the carousel's phone mockup.
//   *.marks.json         when each step starts (seconds into that video) and where the
//                        element was on screen (pt).
//
// The upload, spinner and box taps are captured live; scrolls frame by frame (see
// capture-kit.mjs).
//
// Needs the app running locally WITHOUT Supabase env (`npm run dev` in the repo root):
// the login form then signs in a demo user. /api/pdf-forensics needs a real login, so
// its response is served from the same analyzer run on the same file
// (scripts/analyze-pdf.cts). Everything on screen is the app's own UI.
//
//   --tall               record only the phone take, on a full phone screen (430×880 pt) →
//                        pdf-tamper-tall.mp4, for the 16:9 demo
//
// Usage: npm run record [-- --url http://localhost:3000] [-- --tall]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REC, REPO, ROOT, URL, createCapture, launch, sleep } from './capture-kit.mjs';

const PDF = path.join(ROOT, 'public/recordings/rate-con-4821.pdf');
const TALL = process.argv.includes('--tall');
const PHONE = { width: 430, height: TALL ? 880 : 430, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
// Same isMobile/hasTouch as PHONE: changing those makes Puppeteer reload the page (and drop the demo login).
const ZOOM = { width: 1000, height: 1000, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const HEADER = 62; // the app's sticky mobile header, pt
const HOLD = 3.4; // seconds held on each finding: longer than any beat the reel holds it for

const forensics = execFileSync('npx', ['tsx', path.join(ROOT, 'scripts/analyze-pdf.cts'), PDF], { cwd: REPO, encoding: 'utf8' });

const browser = await launch();
const page = await browser.newPage();
await page.setViewport(PHONE);
await page.setRequestInterception(true);
page.on('request', async (req) => {
  if (req.url().endsWith('/api/pdf-forensics') && req.method() === 'POST') {
    await sleep(1500); // "Taking the PDF apart…"
    return req.respond({ status: 200, contentType: 'application/json', body: forensics });
  }
  req.continue();
});
const { rectOf, makeTake, live, scrollTo, cleanup } = createCapture(page);

const clickText = (re) =>
  page.evaluate((src) => {
    const el = [...document.querySelectorAll('button, a')].find((b) => new RegExp(src, 'i').test(b.innerText.trim()) && b.offsetParent !== null);
    el?.click();
    return !!el;
  }, re.source);

// ---------- app: demo sign-in → Free plan → Verify → PDF forensics ----------
await page.goto(`${URL}/login`, { waitUntil: 'networkidle0', timeout: 120000 });
await page.type('input[type=email]', 'demo@example.com');
await page.type('input[type=password]', 'password123');
await page.keyboard.press('Enter');
await sleep(1200);
if (!(await clickText(/^Choose Free$/))) throw new Error('Plan picker not found — is the app running without Supabase env?');
await sleep(1200);
await page.evaluate(() => { history.pushState({}, '', '/verify'); window.dispatchEvent(new PopStateEvent('popstate')); });
await sleep(1200);
if (!(await clickText(/PDF forensics/))) throw new Error('PDF forensics tab not found');
await sleep(800);

const FIND = {
  drop: `[...document.querySelectorAll('label')].find((l) => /Drop a PDF|rate-con/.test(l.innerText))`,
  choose: `[...document.querySelectorAll('label div.inline-block')].find((d) => /Choose PDF/i.test(d.innerText))`,
  verdict: `[...document.querySelectorAll('div')].find((d) => /^Likely tampered/i.test(d.innerText.trim()) && d.querySelector('.text-3xl'))`,
  versions: `[...document.querySelectorAll('div')].find((d) => d.textContent === 'Every saved version inside this file')`,
  v: (n) => `[...document.querySelectorAll('li')].find((li) => li.querySelector('span.font-semibold')?.textContent === 'Version ${n}')`,
  signed: `[...document.querySelectorAll('span.font-semibold')].find((s) => /changed after it was signed/i.test(s.textContent))?.closest('div.rounded-xl')`,
  preview: `document.querySelector('canvas')?.parentElement`,
};

// ---------- take 1: phone ----------
const phone = makeTake(TALL ? 'pdf-tamper-tall' : 'pdf-tamper');
await page.evaluate((f) => { const el = eval(f); window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 40); }, FIND.drop);
await sleep(400);
await live(phone, async (mark) => {
  await sleep(800);
  mark('tap', await rectOf(FIND.choose));
  await (await page.$('input[type=file][accept="application/pdf"]')).uploadFile(PDF);
  await sleep(150);
  mark('spinner');
  await page.waitForFunction((f) => !!eval(f), { timeout: 30000 }, FIND.verdict);
  mark('result', await rectOf(FIND.verdict));
  await sleep(450);
});
for (const [key, finder, offset] of [
  ['verdict', FIND.verdict, 14],
  ['versions', FIND.versions, 10],
  ['v3', FIND.v(3), 8],
  ['v4', FIND.v(4), 8],
  ['v5', FIND.v(5), 8],
  ['v6', FIND.v(6), 8],
  ['signed', FIND.signed, 10],
  ['preview', FIND.preview, 26],
]) {
  const t = phone.t;
  phone.mark(key, await scrollTo(phone, finder, HEADER + offset), t);
  phone.hold(HOLD);
}
phone.mark('end');
phone.encode({ width: PHONE.width * PHONE.deviceScaleFactor, height: PHONE.height * PHONE.deviceScaleFactor, scale: PHONE.deviceScaleFactor });
if (TALL) {
  await browser.close();
  cleanup();
  process.exit(0);
}

// ---------- take 2: the page preview, close up ----------
await page.setViewport(ZOOM);
// The preview redraws at the new width; its boxes come back once the page is drawn.
await page.waitForSelector('#fx-box-0', { timeout: 20000 }).catch(async (e) => {
  await page.screenshot({ path: path.join(os.tmpdir(), 'haulock-zoom-fail.png') });
  throw new Error(`No preview boxes after resizing (screenshot in ${os.tmpdir()}): ${e.message}`);
});
await sleep(800);
await page.evaluate(() => { const r = document.getElementById('fx-box-0').getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top + r.height / 2 - 500); });
await sleep(600);
const zoom = makeTake('pdf-tamper-zoom');
zoom.mark('canvas', await rectOf(`document.querySelector('canvas')`));
await live(zoom, async (mark) => {
  await sleep(700);
  // Box 2 (white box over the text) sits on top of box 0 (the changed text).
  mark('tap1', await rectOf(`document.getElementById('fx-box-2')`));
  // A DOM click: after the resize from the phone take, a pointer click at the box's
  // position no longer reaches it.
  await page.evaluate(() => document.querySelector('#fx-box-2 button').click());
  await sleep(1900);
  mark('tap2', await rectOf(`document.getElementById('fx-box-3')`));
  await page.evaluate(() => document.querySelector('#fx-box-3 button').click());
  await sleep(1900);
});
zoom.mark('end');
zoom.encode({ width: ZOOM.width * ZOOM.deviceScaleFactor, height: ZOOM.height * ZOOM.deviceScaleFactor, scale: ZOOM.deviceScaleFactor });

// ---------- still: phone screen for the carousel ----------
await page.setViewport({ ...PHONE, height: 880 });
await sleep(1500);
await page.evaluate((f, top) => { const el = eval(f); window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - top); }, FIND.v(3), HEADER + 8);
await sleep(600);
fs.writeFileSync(path.join(REC, 'phone-v3.png'), await page.screenshot({ type: 'png', captureBeyondViewport: false }));
console.log(path.join(REC, 'phone-v3.png'));

await browser.close();
cleanup();
