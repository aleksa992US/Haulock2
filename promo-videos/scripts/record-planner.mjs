// Screen-records the real load planner for the `load-planner` reel: a full phone screen
// (430×880 pt at 3×). Truck in Gary, IN, empty to Joliet, IL, loaded to Dallas, TX, at
// $2,400 with the driver at $0.65/mile; the route, miles and drive time are the app's own
// (public truck routing, offline city list). The diesel price is typed in (the weekly EIA
// average needs the production key), so the reel doesn't claim "this week's" price.
//
//   load-planner.mp4 / .marks.json   type pickup + delivery (live), the plan runs, then the
//                                    map, "What's left after costs" and the stats.
//   phone-planner.png                a full phone screenshot of the result, for the carousel.
//
// Needs the app running locally WITHOUT Supabase env (demo login). The planner throttles to
// 8 plans per 5 minutes per server process; restart `npm run dev` if a retake hits it.
// Usage: node scripts/record-planner.mjs [--url http://localhost:3000]
import fs from 'node:fs';
import path from 'node:path';
import { REC, URL, createCapture, launch, sleep } from './capture-kit.mjs';

const PHONE = { width: 430, height: 880, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const HEADER = 62;
const HOLD = 3.4;
const DIESEL = '3.85';

const browser = await launch();
const page = await browser.newPage();
await page.setViewport(PHONE);
const { makeTake, live, scrollTo, cleanup } = createCapture(page);
const clickText = (re) =>
  page.evaluate((src) => {
    const el = [...document.querySelectorAll('button, a')].find((b) => new RegExp(src, 'i').test(b.innerText.trim()) && b.offsetParent !== null);
    el?.click();
    return !!el;
  }, re.source);
const pickOption = (re) =>
  page.evaluate((src) => {
    const li = [...document.querySelectorAll('ul[role=listbox] li[role=option]')].find((l) => new RegExp(src, 'i').test(l.innerText));
    li?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return !!li;
  }, re.source);

// Demo sign-in → Free plan → /planner.
await page.goto(`${URL}/login`, { waitUntil: 'networkidle0', timeout: 120000 });
await page.type('input[type=email]', 'demo@example.com');
await page.type('input[type=password]', 'password123');
await page.keyboard.press('Enter');
await sleep(1200);
if (!(await clickText(/^Choose Free$/))) throw new Error('Plan picker not found — is the app running without Supabase env?');
await sleep(1200);
await page.evaluate(() => { history.pushState({}, '', '/planner'); window.dispatchEvent(new PopStateEvent('popstate')); });
await sleep(1500);

// Fill everything but pickup and delivery first: a plan only runs once both are set.
const rate = await page.$('input[placeholder="$2,400"]');
await rate.click({ clickCount: 3 });
await rate.type('2400');
await clickText(/^\$ \/ mile$/);
await sleep(200);
const ppm = await page.$('input[placeholder="Not set (e.g. 0.65)"]');
await ppm.click({ clickCount: 3 });
await ppm.type('0.65');
await clickText(/^More: mpg, diesel price/);
await sleep(300);
const diesel = await page.$('input[placeholder^="This week"]');
await diesel.click({ clickCount: 3 });
await diesel.type(DIESEL);
const origin = await page.$('input[placeholder="US city, ZIP or address"]');
await origin.click();
await origin.type('Gary');
await sleep(800);
if (!(await pickOption(/Gary.*IN/))) throw new Error('No "Gary, IN" suggestion');
await sleep(500);

const FIND = {
  title: `[...document.querySelectorAll('h1, h2')].find((h) => /worth it/i.test(h.textContent))`,
  map: `document.querySelector('.maplibregl-map')`,
  profit: `[...document.querySelectorAll('div')].find((d) => d.textContent.trim() === 'What’s left after costs')?.closest('div.rounded-2xl, div.rounded-3xl')`,
  stats: `[...document.querySelectorAll('div')].find((d) => d.textContent.trim() === 'Empty miles')?.closest('div.grid')`,
};

const take = makeTake('load-planner');
await page.evaluate((f) => { const el = eval(f); window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 90); }, FIND.title);
await sleep(500);
await live(take, async (mark) => {
  await sleep(700);
  const [pickup, delivery] = await page.$$('input[placeholder="Start typing a US city or ZIP"]');
  mark('pickup');
  await pickup.click();
  await pickup.type('Joliet', { delay: 110 });
  await sleep(700);
  if (!(await pickOption(/Joliet.*IL/))) throw new Error('No "Joliet, IL" suggestion');
  await sleep(500);
  mark('delivery');
  await delivery.click();
  await delivery.type('Dallas', { delay: 110 });
  await sleep(700);
  if (!(await pickOption(/Dallas.*TX/))) throw new Error('No "Dallas, TX" suggestion');
  mark('planning');
  await page.waitForFunction(() => [...document.querySelectorAll('div')].some((d) => d.textContent.trim() === 'What’s left after costs') && !document.body.innerText.includes('Planning the route'), { timeout: 60000 });
  mark('planned');
  await sleep(2500); // the route draws and the map settles
});
for (const [key, finder, offset] of [
  ['map', FIND.map, 12],
  ['profit', FIND.profit, 12],
  ['stats', FIND.stats, 12],
]) {
  const t = take.t;
  take.mark(key, await scrollTo(take, finder, HEADER + offset, 0.7), t);
  take.hold(HOLD);
}
take.mark('end');
take.encode({ width: PHONE.width * PHONE.deviceScaleFactor, height: PHONE.height * PHONE.deviceScaleFactor, scale: PHONE.deviceScaleFactor, diesel: DIESEL });

// Still for the carousel: map with the profit card under it.
await page.evaluate((f, top) => { const el = eval(f); window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - top); }, FIND.map, HEADER + 12);
await sleep(800);
fs.writeFileSync(path.join(REC, 'phone-planner.png'), await page.screenshot({ type: 'png', captureBeyondViewport: false }));
console.log(path.join(REC, 'phone-planner.png'));

await browser.close();
cleanup();
