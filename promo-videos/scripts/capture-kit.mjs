// Shared pieces for the screen recorders (record-screens.mjs, record-inspections.mjs):
// a headless Chrome, and "takes" — videos assembled frame by frame from screenshots.
//
// Live moments (taps, spinners) are screenshots back to back, resampled to 30 fps
// (15–20 fps real; CDP screencasts would be faster but come out at CSS size, not 3×).
// Scrolls are captured frame by frame (scroll, paint, screenshot) so they're a smooth
// 30 fps.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const REPO = path.resolve(ROOT, '..');
export const REC = path.join(ROOT, 'public/recordings');
export const FPS = 30;
export const URL = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FFMPEG = path.join(ROOT, 'node_modules/@remotion/compositor-darwin-arm64/ffmpeg');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const launch = () => puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars', '--font-render-hinting=none'] });

export const createCapture = (page) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'haulock-rec-'));

  // captureBeyondViewport off: otherwise each shot briefly resizes the page, which resets
  // hover/active state (the PDF preview's tooltips never showed).
  const shot = () => page.screenshot({ type: 'jpeg', quality: 94, captureBeyondViewport: false });
  const rectOf = (finder) =>
    page.evaluate((f) => { const el = eval(f); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, finder);

  // A video assembled frame by frame; `encode` writes <name>.mp4 and <name>.marks.json.
  const makeTake = (name) => {
    const dir = path.join(tmpRoot, name);
    fs.mkdirSync(dir);
    let n = 0;
    let last = null;
    const marks = {};
    return {
      get t() { return n / FPS; },
      push(jpeg) { last = jpeg; fs.writeFileSync(path.join(dir, `${String(n++).padStart(5, '0')}.jpg`), jpeg); },
      hold(sec) { for (let i = 0; i < Math.round(sec * FPS); i++) this.push(last); },
      mark(key, rect = null, t = n / FPS) { marks[key] = { t: Math.round(t * 1000) / 1000, rect }; },
      encode(size) {
        const out = path.join(REC, `${name}.mp4`);
        execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%05d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '14', '-preset', 'slow', out], {
          env: { ...process.env, DYLD_LIBRARY_PATH: path.dirname(FFMPEG) },
        });
        fs.writeFileSync(path.join(REC, `${name}.marks.json`), JSON.stringify({ fps: FPS, frames: n, size, marks }, null, 2));
        console.log(`${out} — ${n} frames (${(n / FPS).toFixed(1)} s)`);
      },
    };
  };

  // Live capture while `fn` runs. `fn` gets a mark(key, rect) that stamps the moment on
  // the take's clock.
  const live = async (take, fn) => {
    const shots = [];
    let running = true;
    const t0 = Date.now() / 1000;
    const start = take.t;
    const loop = (async () => {
      while (running) {
        const before = Date.now() / 1000;
        const data = await shot();
        shots.push({ t: (before + Date.now() / 1000) / 2, data });
      }
    })();
    await fn((key, rect) => take.mark(key, rect, start + Date.now() / 1000 - t0));
    const dur = Date.now() / 1000 - t0;
    running = false;
    await loop;
    let fi = 0;
    for (let i = 0; i < Math.round(dur * FPS); i++) {
      while (fi + 1 < shots.length && shots[fi + 1].t <= t0 + i / FPS) fi++;
      take.push(shots[fi].data);
    }
    console.log(`live: ${shots.length} shots in ${dur.toFixed(1)} s`);
  };

  // Eased scroll, one captured frame per 1/30 s, landing the element's top `top` pt down.
  // Scrolls the element's nearest scrolling box (a modal, say), or the page.
  const scrollTo = async (take, finder, top, dur = 0.6) => {
    const plan = await page.evaluate((f, top) => {
      const el = eval(f);
      if (!el) return null;
      let box = el.parentElement;
      while (box && box !== document.body) {
        const cs = getComputedStyle(box);
        if (/auto|scroll/.test(cs.overflowY) && box.scrollHeight > box.clientHeight + 4) break;
        box = box.parentElement;
      }
      const inBox = box && box !== document.body;
      window.__scrollBox = inBox ? box : null;
      const from = inBox ? box.scrollTop : window.scrollY;
      const max = inBox ? box.scrollHeight - box.clientHeight : document.documentElement.scrollHeight - innerHeight;
      return { from, to: Math.max(0, Math.min(max, from + el.getBoundingClientRect().top - top)) };
    }, finder, top);
    if (!plan) throw new Error(`Not on the page: ${finder}`);
    const n = Math.round(dur * FPS);
    for (let i = 1; i <= n; i++) {
      const p = i / n;
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      await page.evaluate(
        (y) => new Promise((r) => { const b = window.__scrollBox; if (b) b.scrollTop = y; else window.scrollTo(0, y); requestAnimationFrame(() => requestAnimationFrame(r)); }),
        plan.from + (plan.to - plan.from) * e
      );
      take.push(await shot());
    }
    return rectOf(finder);
  };

  const cleanup = () => fs.rmSync(tmpRoot, { recursive: true, force: true });
  return { shot, rectOf, makeTake, live, scrollTo, cleanup };
};
