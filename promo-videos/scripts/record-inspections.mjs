// Screen-records the homepage's "Inspections, crashes & alerts" panel for the
// `inspections` reel, and screenshots the real own-company alert email.
//
//   inspections.mp4        a full phone screen (430×880 pt at 3×): the example panel's totals, the
//                          month-by-month chart, a tap that opens the out-of-service
//                          inspection (its violations), then the crash.
//   inspections.marks.json when each step starts (seconds into the video).
//   alert-email.png        lib/email.ts safetyEventsTemplate rendered with the same example
//                          inspection (scripts/render-alert-email.cts), full length, 390 pt
//                          wide at 3×, for the phone mockup. alert-email.json: its subject.
//   phone-inspections.png  a full-height phone screenshot (430×880 pt at 3×) of the panel with
//                          the out-of-service inspection open, for the carousel.
//
// The panel is the homepage's own example ("Example Trucking LLC · Example data"), the
// same layout as the panel in every carrier report, so no real carrier's record is shown.
// Needs the app running (`npm run dev` in the repo root).
// Usage: node scripts/record-inspections.mjs [--url http://localhost:3000]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REC, REPO, ROOT, URL, createCapture, launch, sleep } from './capture-kit.mjs';

const PHONE = { width: 430, height: 880, deviceScaleFactor: 3, isMobile: true, hasTouch: true }; // the reel shows it on a phone mockup
const HOLD = 3.4;

const browser = await launch();
const page = await browser.newPage();
await page.setViewport(PHONE);
const { rectOf, makeTake, live, scrollTo, cleanup } = createCapture(page);

await page.goto(`${URL}/`, { waitUntil: 'networkidle0', timeout: 120000 });
await sleep(800);

const PANEL = `[...document.querySelectorAll('#inspections div.rounded-3xl')].find((d) => d.textContent.includes('Example Trucking LLC'))`;
const inPanel = (text) => `[...${PANEL}.querySelectorAll('div')].find((d) => d.textContent.trim() === '${text}')`;
const FIND = {
  panel: PANEL,
  chart: inPanel('Inspections per month'),
  latest: inPanel('Latest inspections'),
  oos: `[...${PANEL}.querySelectorAll('button')].find((b) => b.textContent.includes('Joplin, MO'))`,
  // The crash list's label (the totals tile above it is also called "Crashes").
  crashes: `[...${PANEL}.querySelectorAll('div')].filter((d) => d.textContent.trim() === 'Crashes').pop()`,
};

// Height of the homepage's sticky nav, if it sticks.
const NAV = await page.evaluate(() => {
  const el = document.elementFromPoint(200, 4)?.closest('nav, header');
  return el && /fixed|sticky/.test(getComputedStyle(el).position) ? Math.round(el.getBoundingClientRect().bottom) : 0;
});
console.log('sticky nav:', NAV);

// Start with the out-of-service inspection closed, so the take can open it.
await page.evaluate((f) => { const el = eval(f); window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 120); }, FIND.panel);
await sleep(300);
if (await page.evaluate((f) => !!eval(f)?.parentElement?.querySelector('div.space-y-1'), FIND.oos)) await page.evaluate((f) => eval(f).click(), FIND.oos);
await sleep(400);

const take = makeTake('inspections');
for (const [key, finder, offset] of [
  ['panel', FIND.panel, 12],
  ['chart', FIND.chart, 14],
]) {
  const t = take.t;
  take.mark(key, await scrollTo(take, finder, NAV + offset, 0.7), t);
  take.hold(HOLD);
}
// The crash before the tap, so the out-of-service inspection is still closed here.
{
  const t = take.t;
  // Low on the screen, so the inspection list stays above the crash on a full phone screen.
  take.mark('crashes', await scrollTo(take, FIND.crashes, NAV + 520, 0.7), t);
  take.hold(HOLD);
}
{
  const t = take.t;
  // Lower on the screen, so the panel (not the next homepage section) fills the phone.
  take.mark('latest', await scrollTo(take, FIND.latest, NAV + 210, 0.7), t);
  await live(take, async (mark) => {
    await sleep(900);
    mark('tap', await rectOf(FIND.oos));
    await page.evaluate((f) => eval(f).click(), FIND.oos); // open: each violation
    await sleep(HOLD * 1000);
  });
}
take.mark('end');
take.encode({ width: PHONE.width * PHONE.deviceScaleFactor, height: PHONE.height * PHONE.deviceScaleFactor, scale: PHONE.deviceScaleFactor, nav: NAV });

// ---------- still: the panel on a full phone screen, for the carousel ----------
await page.evaluate((f, top) => { const el = eval(f); window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - top); }, FIND.panel, NAV + 10);
await sleep(500);
fs.writeFileSync(path.join(REC, 'phone-inspections.png'), await page.screenshot({ type: 'png', captureBeyondViewport: false }));
console.log(path.join(REC, 'phone-inspections.png'));

// ---------- the alert email ----------
const email = JSON.parse(execFileSync('npx', ['tsx', path.join(ROOT, 'scripts/render-alert-email.cts')], { cwd: REPO, encoding: 'utf8' }));
// A fresh tab: the app's tab keeps a dev-server connection open, so it never goes idle.
const mail = await browser.newPage();
await mail.setViewport({ ...PHONE, width: 390, height: 844 });
await mail.setContent(email.html, { waitUntil: 'load', timeout: 60000 });
await sleep(1500); // the logo image
fs.writeFileSync(path.join(REC, 'alert-email.png'), await mail.screenshot({ type: 'png', fullPage: true }));
fs.writeFileSync(path.join(REC, 'alert-email.json'), JSON.stringify({ subject: email.subject, cssWidth: 390, scale: 3 }, null, 2));
console.log(path.join(REC, 'alert-email.png'), '—', email.subject);

await browser.close();
cleanup();
