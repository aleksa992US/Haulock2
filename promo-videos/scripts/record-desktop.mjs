// Screen-records the real app at desktop size (1280×770 at 2×) for the 16:9 laptop demo
// (`demo-60-laptop`): the same six features and example data as the phone reels.
//
//   desk-pdf          Verify → PDF forensics: upload rate-con-4821.pdf → "Likely tampered" →
//                     the page preview with its boxes → Version 3 ($1,400.00 → $1,100.00)
//   desk-coi          Verify → COI check: upload → "Doesn't match FMCSA filings" →
//                     cancellation pending → the filings side by side
//   desk-officers     header search "Quillmont Freight" → the report: the verdict's "call
//                     (555) 019-7744 … ask for Laura Bennett or Victor Hale" → Identity
//   desk-authority    "Ironvale Freight" → CAUTION 35, +30 reactivated → Identity (authority
//                     age) → the red flag, opened
//   desk-inspections  the same report: every inspection and crash → open the latest one
//   desk-planner      Load planner: Gary, IN → Joliet, IL → Dallas, TX at $2,400 → the route
//                     and what's left
//
// API answers come from scripts/examples.mjs (and the PDF analyzer run on the sample file),
// as in record-reports.mjs / record-screens.mjs; the planner is the app's own. Needs the app
// running locally WITHOUT Supabase env (demo login) and with NEXT_PUBLIC_COI_CHECK=on.
// Usage: node scripts/record-desktop.mjs [--url http://localhost:3000] [--only pdf,coi,…]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REC, REPO, ROOT, URL, createCapture, launch, sleep } from './capture-kit.mjs';
import { BRAXTONE, COI_MISMATCH, COMPANY, IRONVALE, OWN_SCORE, QUILLMONT, safetyActivity } from './examples.mjs';

const DESK = { width: 1280, height: 770, deviceScaleFactor: 2 };
const SIZE = { width: DESK.width * 2, height: DESK.height * 2, scale: 2 };
const HEADER = 64;
const HOLD = 3.4;
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const want = (name) => !ONLY || ONLY.includes(name);

const PDF = path.join(ROOT, 'public/recordings/rate-con-4821.pdf');
const forensics = execFileSync('npx', ['tsx', path.join(ROOT, 'scripts/analyze-pdf.cts'), PDF], { cwd: REPO, encoding: 'utf8' });
const REPORT_PDF = fs.readFileSync(path.join(REC, 'report-braxtone.pdf'));
// The file the COI take uploads (its content isn't read: the check's answer is the example).
const COI_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'haulock-coi-')), 'coi-kestrelon-freight.pdf');
fs.writeFileSync(COI_FILE, REPORT_PDF);

const browser = await launch();
const page = await browser.newPage();
await page.setViewport(DESK);
await page.setRequestInterception(true);
const json = (req, body, delay = 0) => setTimeout(() => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }), delay);
page.on('request', (req) => {
  const u = decodeURIComponent(req.url());
  if (u.endsWith('/api/pdf-forensics') && req.method() === 'POST') return setTimeout(() => req.respond({ status: 200, contentType: 'application/json', body: forensics }), 1500);
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
  await sleep(1500);
};
const waitText = (text, timeout = 30000) => page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), { timeout }, text);
const pickOption = (re) =>
  page.evaluate((src) => {
    const li = [...document.querySelectorAll('ul[role=listbox] li[role=option]')].find((l) => new RegExp(src, 'i').test(l.innerText));
    li?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return !!li;
  }, re.source);
// Elements, by their visible text.
const card = (text) => `[...document.querySelectorAll('div, h2, h3')].filter((d) => d.textContent.trim().toLowerCase() === '${text.toLowerCase()}').pop()?.closest('div.rounded-2xl, div.rounded-3xl, div.rounded-xl')`;
const row = (text) => `[...document.querySelectorAll('div, span, h2, h3, h4, p')].filter((d) => d.textContent.trim().toLowerCase() === '${text.toLowerCase()}').pop()`;
// Scroll stops: [mark, element, its top (pt below the window top)], each held HOLD s.
const stops = async (take, list) => {
  for (const [key, finder, top] of list) {
    const t = take.t;
    take.mark(key, await scrollTo(take, finder, top, 0.7), t);
    take.hold(HOLD);
  }
};
// Search by name from the header, the way users do.
const search = async (take, text) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await live(take, async (m) => {
    await sleep(700);
    const q = await page.$('input[placeholder="Quick lookup — MC, DOT, or name…"]');
    m('search', await rectOf(`document.querySelector('input[placeholder="Quick lookup — MC, DOT, or name…"]')`));
    await q.click();
    await q.type(text, { delay: 85 });
    await sleep(900);
    await page.keyboard.press('Enter');
    await waitText('Our verdict').catch(async (e) => {
      await page.screenshot({ path: path.join(os.tmpdir(), 'haulock-desk-search.png') });
      throw new Error(`No report after searching "${text}" (screenshot: ${path.join(os.tmpdir(), 'haulock-desk-search.png')}): ${e.message}`);
    });
    m('shown');
    await sleep(HOLD * 1000);
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

// ---------- 1. PDF forensics ----------
if (want('pdf')) {
  await go('/verify');
  if (!(await clickText(/PDF forensics/))) throw new Error('PDF forensics tab not found');
  await sleep(900);
  const choose = `[...document.querySelectorAll('label div.inline-block')].find((d) => /Choose PDF/i.test(d.innerText))`;
  const verdict = `[...document.querySelectorAll('div')].find((d) => /^Likely tampered/i.test(d.innerText.trim()) && d.querySelector('.text-3xl'))`;
  const take = makeTake('desk-pdf');
  await live(take, async (m) => {
    await sleep(900);
    m('tap', await rectOf(choose));
    await (await page.$('input[type=file][accept="application/pdf"]')).uploadFile(PDF);
    await page.waitForFunction((f) => !!eval(f), { timeout: 30000 }, verdict);
    m('result', await rectOf(verdict));
    await sleep(1200);
  });
  await stops(take, [
    ['verdict', verdict, HEADER + 16],
    ['preview', row('See it on the page'), HEADER + 10],
    ['v3', `[...document.querySelectorAll('li')].find((li) => li.querySelector('span.font-semibold')?.textContent === 'Version 3')`, HEADER + 120],
  ]);
  take.mark('end');
  take.encode(SIZE);
}

// ---------- 2. COI check ----------
if (want('coi')) {
  await go('/verify');
  if (!(await clickText(/^COI check/))) throw new Error('No COI check tab — start the app with NEXT_PUBLIC_COI_CHECK=on');
  await sleep(900);
  const upload = `document.querySelector('input[type=file][accept="application/pdf,image/png,image/jpeg"]')?.closest('label')`;
  const take = makeTake('desk-coi');
  await live(take, async (m) => {
    await sleep(900);
    m('upload', await rectOf(upload));
    await (await page.$('input[type=file][accept="application/pdf,image/png,image/jpeg"]')).uploadFile(COI_FILE);
    await waitText('Cancellation pending on FMCSA');
    m('result');
    await sleep(1200);
  });
  await stops(take, [
    ['verdict', `[...document.querySelectorAll('div')].filter((d) => d.textContent.trim().startsWith('Doesn’t match FMCSA filings')).pop()?.closest('div.rounded-2xl, div.rounded-xl')`, HEADER + 16],
    ['filings', row('Filed with FMCSA (liability)'), HEADER + 330],
  ]);
  take.mark('end');
  take.encode(SIZE);
}

// ---------- 3. officers & phone on the FMCSA filing ----------
if (want('officers')) {
  await go('/dashboard');
  const take = makeTake('desk-officers');
  await search(take, 'Quillmont Freight');
  await stops(take, [['identity', card('Identity'), HEADER + 16]]);
  take.mark('end');
  take.encode(SIZE);
}

// ---------- 4. authority history, 5. inspections (the same report) ----------
if (want('authority') || want('inspections')) {
  await go('/dashboard');
  const take = makeTake('desk-authority');
  await search(take, 'Ironvale Freight');
  await stops(take, [['identity', card('Identity'), HEADER + 16]]);
  const flag = `[...document.querySelectorAll('button, div')].filter((d) => d.textContent.trim().startsWith('Authority recently reactivated')).pop()`;
  {
    const t = take.t;
    take.mark('flags', await scrollTo(take, row('Red flags detected'), HEADER + 16, 0.7), t);
    await live(take, async (m) => {
      await sleep(900);
      m('flagTap', await rectOf(flag));
      await page.evaluate((f) => eval(f)?.click(), flag);
      await sleep(HOLD * 1000);
    });
  }
  take.mark('end');
  take.encode(SIZE);

  if (want('inspections')) {
    const insp = makeTake('desk-inspections');
    const panel = row('Every inspection and crash');
    const latest = `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Oct 6, 2026') && b.textContent.includes('Gary'))`;
    await page.evaluate((f) => { const el = eval(f); window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 400); }, panel);
    await sleep(600);
    {
      const t = insp.t;
      insp.mark('panel', await scrollTo(insp, panel, HEADER + 16, 0.7), t);
      insp.hold(2.4);
    }
    await live(insp, async (m) => {
      await sleep(400);
      m('tap', await rectOf(latest));
      await page.evaluate((f) => eval(f)?.click(), latest);
      await sleep(HOLD * 1000);
    });
    insp.mark('end');
    insp.encode(SIZE);
  }
}

// ---------- 6. load planner ----------
if (want('planner')) {
  await go('/planner');
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
  await diesel.type('3.85');
  const origin = await page.$('input[placeholder="US city, ZIP or address"]');
  await origin.click();
  await origin.type('Gary');
  await sleep(800);
  if (!(await pickOption(/Gary.*IN/))) throw new Error('No "Gary, IN" suggestion');
  await sleep(500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  const take = makeTake('desk-planner');
  await live(take, async (m) => {
    await sleep(700);
    const [pickup, delivery] = await page.$$('input[placeholder="Start typing a US city or ZIP"]');
    m('pickup', await rectOf(`document.querySelector('input[placeholder="Start typing a US city or ZIP"]')`));
    await pickup.click();
    await pickup.type('Joliet', { delay: 110 });
    await sleep(700);
    if (!(await pickOption(/Joliet.*IL/))) throw new Error('No "Joliet, IL" suggestion');
    await sleep(500);
    m('delivery');
    await delivery.click();
    await delivery.type('Dallas', { delay: 110 });
    await sleep(700);
    if (!(await pickOption(/Dallas.*TX/))) throw new Error('No "Dallas, TX" suggestion');
    m('planning');
    await page.waitForFunction(() => [...document.querySelectorAll('div')].some((d) => d.textContent.trim() === 'What’s left after costs') && !document.body.innerText.includes('Planning the route'), { timeout: 60000 });
    m('planned');
    await sleep(3000); // the route draws and the map settles
  });
  await stops(take, [['profit', `[...document.querySelectorAll('div')].find((d) => d.textContent.trim() === 'What’s left after costs')?.closest('div.rounded-2xl, div.rounded-3xl')`, HEADER + 16]]);
  take.mark('end');
  take.encode(SIZE);
}

await browser.close();
cleanup();
