// Screen-records the real app's carrier report, COI check and "Your company" screens for the
// feature reels, on a full phone screen (430×880 pt at 3×). These screens need live FMCSA /
// Document AI keys or a real login, so their API responses are served from scripts/
// examples.mjs (fictional companies, 555 phones, masked MC/DOT); the UI is the app's own.
//
//   report-officers   header search "Quillmont Freight" → report → "Our verdict" (call the
//                     FMCSA number, ask for the officers by name) → Identity panel
//   report-authority  "Ironvale Freight" → score → "How we got 35/100" → Identity (authority
//                     age: reactivated) → the red flag, opened
//   report-pdf        "Braxtone Transport" report → Email → "Send report" → Export PDF
//   coi               Verify → COI check → upload → mismatch: cancellation pending → filings
//   company           Dashboard → "Score, monitoring & who's checking" → checks chart →
//                     FMCSA monitoring
//   phone-*.png       a full phone screenshot of each, for the carousels
//
// Needs the app running locally WITHOUT Supabase env (demo login) and with
// NEXT_PUBLIC_COI_CHECK=on (the COI tab is behind that launch switch, on in production).
// Usage: node scripts/record-reports.mjs [--url http://localhost:3000] [--only pdf,authority]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REC, URL, createCapture, launch, sleep } from './capture-kit.mjs';
import { BRAXTONE, COI_MISMATCH, COMPANY, IRONVALE, OWN_SCORE, QUILLMONT, safetyActivity } from './examples.mjs';

const PHONE = { width: 430, height: 880, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const HEADER = 62;
const HOLD = 3.4;
// The app's PDF for the example carrier (scripts/render-report-pdf.cts).
const REPORT_PDF = fs.readFileSync(path.join(REC, 'report-braxtone.pdf'));
// Takes to record (default: all): officers, authority, pdf, coi, company.
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const want = (name) => !ONLY || ONLY.includes(name);
// The file the COI take uploads (its content isn't read: the check's answer is the example).
const COI_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'haulock-coi-')), 'coi-kestrelon-freight.pdf');
fs.writeFileSync(COI_FILE, REPORT_PDF);

const browser = await launch();
const page = await browser.newPage();
await page.setViewport(PHONE);
await page.setRequestInterception(true);
const json = (req, body, delay = 0) => setTimeout(() => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }), delay);
page.on('request', (req) => {
  const u = decodeURIComponent(req.url());
  if (u.includes('/api/verify')) return json(req, /ironvale/i.test(u) ? IRONVALE : /braxtone/i.test(u) ? BRAXTONE : QUILLMONT, 700);
  if (u.includes('/api/search/suggest')) {
    const r = /iron/i.test(u) ? IRONVALE : /quill/i.test(u) ? QUILLMONT : /brax/i.test(u) ? BRAXTONE : null;
    return json(req, { suggestions: r ? [{ name: r.name, mc: r.mc, dot: r.dot, role: r.brokerAuthority === 'Active' ? 'broker' : 'carrier', active: true, query: r.searchedFor, matchedOn: 'name' }] : [] });
  }
  if (u.includes('/api/fmcsa/safety-activity')) return json(req, safetyActivity('example'));
  if (u.includes('/api/carrier-history')) return json(req, { history: [], count: 0 });
  if (u.includes('/api/coi/check')) return json(req, COI_MISMATCH, 1800);
  if (u.includes('/api/profile/own-score')) return json(req, OWN_SCORE);
  if (u.includes('/api/profile/company/new-checks')) return json(req, { enabled: true, count: 0 });
  if (u.includes('/api/profile/company')) return json(req, COMPANY);
  if (u.includes('/api/report/pdf')) return setTimeout(() => req.respond({ status: 200, contentType: 'application/pdf', body: REPORT_PDF }), 1200);
  if (u.includes('/api/report/email')) return json(req, { ok: true, sentTo: 1 }, 900);
  if (u.includes('/api/watchlist') && req.method() === 'POST') return json(req, {});
  req.continue();
});
const { rectOf, makeTake, live, scrollTo, cleanup } = createCapture(page);

const clickText = (re) =>
  page.evaluate((src) => {
    const el = [...document.querySelectorAll('button, a')].find((b) => new RegExp(src, 'i').test(b.innerText.trim().replace(/\s+/g, ' ')) && b.offsetParent !== null);
    el?.click();
    return !!el;
  }, re.source);
const go = async (route) => {
  await page.evaluate((r) => { history.pushState({}, '', r); window.dispatchEvent(new PopStateEvent('popstate')); window.scrollTo(0, 0); }, route);
  await sleep(1400);
};
// Case-insensitive: the UI upper-cases many labels with CSS, which innerText reflects.
const waitText = (text, timeout = 30000) => page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), { timeout }, text);
const still = async (name, finder, top) => {
  if (finder) await page.evaluate((f, top) => { const el = eval(f); el.scrollIntoView(); const b = window.__scrollBox; if (b) b.scrollTop += el.getBoundingClientRect().top - top; else window.scrollBy(0, el.getBoundingClientRect().top - top); }, finder, top);
  await sleep(600);
  fs.writeFileSync(path.join(REC, `phone-${name}.png`), await page.screenshot({ type: 'png', captureBeyondViewport: false }));
};

// Elements, by their visible text.
const card = (text) => `[...document.querySelectorAll('div, h2, h3')].filter((d) => d.textContent.trim().toLowerCase() === '${text.toLowerCase()}').pop()?.closest('div.rounded-2xl, div.rounded-3xl, div.rounded-xl')`;
const row = (text) => `[...document.querySelectorAll('div, span')].filter((d) => d.textContent.trim().toLowerCase() === '${text.toLowerCase()}').pop()`;

// Search by name from the header, the way users do.
const search = async (take, text, mark) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await live(take, async (m) => {
    await sleep(700);
    const q = await page.$('input[placeholder="Quick lookup — MC, DOT, or name…"]');
    m(mark);
    await q.click();
    await q.type(text, { delay: 85 });
    await sleep(900);
    await page.keyboard.press('Enter');
    await waitText('Our verdict');
    m(`${mark}Shown`);
    await sleep(1400);
  });
};

// ---------- demo sign-in → Free plan → dashboard ----------
await page.goto(`${URL}/login`, { waitUntil: 'networkidle0', timeout: 120000 });
await page.type('input[type=email]', 'demo@example.com');
await page.type('input[type=password]', 'password123');
await page.keyboard.press('Enter');
await sleep(1200);
if (!(await clickText(/^Choose Free$/))) throw new Error('Plan picker not found — is the app running without Supabase env?');
await sleep(1500);

// ---------- 1. officers & phone on the FMCSA filing ----------
if (want('officers')) {
  const take = makeTake('report-officers');
  await search(take, 'Quillmont Freight', 'search');
  for (const [key, finder, offset] of [
    ['verdict', card('Our verdict'), 12],
    ['identity', card('Identity'), 12],
  ]) {
    const t = take.t;
    take.mark(key, await scrollTo(take, finder, HEADER + offset, 0.7), t);
    take.hold(HOLD);
  }
  take.mark('end');
  take.encode({ width: 1290, height: 2640, scale: 3 });
  await still('officers', card('Our verdict'), HEADER + 12);
}

// ---------- 2. authority history: reactivated after a long gap ----------
if (want('authority')) {
  await go('/dashboard');
  const take = makeTake('report-authority');
  await search(take, 'Ironvale Freight', 'search');
  take.mark('top', null);
  take.hold(2.2);
  for (const [key, finder, offset] of [
    ['verdict', card('Our verdict'), 12],
    ['age', row('Authority age'), 260],
  ]) {
    const t = take.t;
    take.mark(key, await scrollTo(take, finder, HEADER + offset, 0.7), t);
    take.hold(HOLD);
  }
  {
    const t = take.t;
    const flag = `[...document.querySelectorAll('button, div')].filter((d) => d.textContent.trim().startsWith('Authority recently reactivated')).pop()`;
    take.mark('flag', await scrollTo(take, flag, HEADER + 140, 0.7), t);
    await live(take, async (m) => {
      await sleep(800);
      m('flagTap', await rectOf(flag));
      await page.evaluate((f) => eval(f)?.click(), flag); // open: what it means, the dates, what to do
      await sleep(900);
    });
    // The red flags sit at the page's end: once open, bring the whole flag into view.
    const t2 = take.t;
    take.mark('flagOpen', await scrollTo(take, flag, HEADER + 16, 0.6), t2);
    take.hold(HOLD);
  }
  take.mark('end');
  take.encode({ width: 1290, height: 2640, scale: 3 });
  await still('authority', row('Authority age'), HEADER + 260);
}

// ---------- 3. the PDF report: export, email to dispatch ----------
if (want('pdf')) {
  await go('/dashboard');
  await page.evaluate(() => window.scrollTo(0, 0));
  const q = await page.$('input[placeholder="Quick lookup — MC, DOT, or name…"]');
  await q.click();
  await q.type('Braxtone Transport');
  await page.keyboard.press('Enter');
  await waitText('Our verdict');
  await sleep(1200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(400);
  const take = makeTake('report-pdf');
  // Email first: the Export PDF tap starts a download, so it comes last.
  await live(take, async (m) => {
    await sleep(900);
    m('email', await rectOf(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Email')`));
    await clickText(/^Email$/);
    await sleep(1000);
    // Focus the fields and type with the keyboard: a pointer tap here lands on the dialog's
    // backdrop and closes it.
    const focus = (sel) => page.evaluate((s) => { const el = document.querySelector(s); el?.focus(); return !!el; }, sel);
    if (!(await focus('input[placeholder^="dispatch@yourcompany.com"]'))) {
      await page.screenshot({ path: path.join(os.tmpdir(), 'haulock-email-fail.png') });
      throw new Error(`Email dialog didn't open (screenshot: ${path.join(os.tmpdir(), 'haulock-email-fail.png')})`);
    }
    await page.keyboard.type('dispatch@yourcompany.com', { delay: 55 });
    if (await focus('textarea')) await page.keyboard.type('Checked on Haulock: OK to book.', { delay: 45 });
    await sleep(500);
    m('send', await rectOf(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Send report')`));
    await clickText(/^Send report$/);
    await sleep(2600);
    m('sent');
    await page.keyboard.press('Escape');
    await clickText(/^(Close|Done)$/);
    await sleep(800);
    m('export', await rectOf(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Export PDF')`));
    await clickText(/^Export PDF$/);
    await sleep(1600);
  });
  take.mark('end');
  take.encode({ width: 1290, height: 2640, scale: 3 });
}

// ---------- 4. COI check ----------
if (want('coi')) {
  await go('/verify');
  if (!(await clickText(/^COI check/))) throw new Error('No COI check tab — start the app with NEXT_PUBLIC_COI_CHECK=on');
  await sleep(900);
  const upload = `document.querySelector('input[type=file][accept="application/pdf,image/png,image/jpeg"]')?.closest('label')`;
  await page.evaluate((f) => { const el = eval(f); window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 330); }, upload);
  await sleep(500);
  const take = makeTake('coi');
  await live(take, async (m) => {
    await sleep(900);
    m('upload', await rectOf(upload));
    await (await page.$('input[type=file][accept="application/pdf,image/png,image/jpeg"]')).uploadFile(COI_FILE);
    await waitText('Cancellation pending on FMCSA');
    m('result');
    await sleep(900);
  });
  for (const [key, finder, offset] of [
    ['verdict', `[...document.querySelectorAll('div')].filter((d) => d.textContent.trim().startsWith('Doesn’t match FMCSA filings')).pop()?.closest('div.rounded-2xl, div.rounded-xl')`, 12],
    ['checks', row('Cancellation pending on FMCSA'), 120],
    ['filings', row('Filed with FMCSA (liability)'), 220],
  ]) {
    const t = take.t;
    take.mark(key, await scrollTo(take, finder, HEADER + offset, 0.7), t);
    take.hold(HOLD);
  }
  take.mark('end');
  take.encode({ width: 1290, height: 2640, scale: 3 });
  await still('coi', row('Cancellation pending on FMCSA'), HEADER + 200);
}

// ---------- 5. Your company: who's checking you ----------
if (want('company')) {
  await go('/dashboard');
  const button = `[...document.querySelectorAll('button')].find((b) => /Score, monitoring & who's checking/.test(b.innerText))`;
  await page.evaluate((f) => { const el = eval(f); window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 400); }, button);
  await sleep(500);
  const take = makeTake('company');
  await live(take, async (m) => {
    await sleep(900);
    m('tap', await rectOf(button));
    await page.evaluate((f) => eval(f).click(), button);
    await waitText('checks in the last 30 days');
    m('open');
    await sleep(2200);
  });
  for (const [key, finder, offset] of [
    ['checks', row('Checked on Haulock'), 40],
    ['monitoring', row('FMCSA monitoring'), 40],
  ]) {
    const t = take.t;
    take.mark(key, await scrollTo(take, finder, offset, 0.7), t);
    take.hold(HOLD);
  }
  take.mark('end');
  take.encode({ width: 1290, height: 2640, scale: 3 });
  await still('company', row('Checked on Haulock'), 40);
}

await browser.close();
cleanup();
