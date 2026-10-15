import React from 'react';
import { Img, staticFile } from 'remotion';
import { ChangesCard } from '../components/ChangesCard';
import { CreamCta } from './CreamCta';
import { Laptop, PdfViewer, Phone } from '../components/Devices';
import { Icon } from '../components/VerifyCard';
import { colors, fonts } from '../theme';
import { Headline, POST_W, Post } from './Posts';

// 4-slide carousel (4:5) for the `pdf-tamper` reel, in English and Serbian:
// 1 edited → 2 by how much → 3 everything that changed → 4 check yours free.
// Same sample rate con, recording and findings as the reel.
export type Lang = 'en' | 'sr';

const T = {
  en: {
    hook: [[{ text: 'Your rate con was' }], [{ text: 'edited.', accent: true, color: colors.redGlow }]],
    sub: 'Now see by how much.',
    asReceived: 'AS RECEIVED',
    swipe: 'SWIPE → SEE WHAT CHANGED',
    stamp: ['LINE HAUL', 'CUT'],
    shows: [[{ text: 'Haulock shows you' }], [{ text: 'exactly what changed.', accent: true }]],
    chip: 'SEE WHAT CHANGED ON YOUR RATE CON',
    cta: [['Check your'], ['rate con', 'free.']],
    steps: ['Upload your rate con (PDF)', 'We rebuild every saved version inside it', 'See each change: before → after'],
    facts: ['3 free PDF scans a month', 'No credit card'],
  },
  sr: {
    hook: [[{ text: 'Sumnjaš da je tvoj' }], [{ text: 'rate con' }, { text: 'izmenjen?', accent: true, color: colors.redGlow }]],
    sub: 'Evo kako da proveriš.',
    asReceived: 'KAKO JE STIGAO',
    swipe: 'PREVUCI → VIDI ŠTA JE IZMENJENO',
    stamp: ['LINE HAUL', 'SMANJEN'],
    shows: [[{ text: 'Haulock ti pokazuje' }], [{ text: 'tačno šta je izmenjeno.', accent: true }]],
    chip: 'VIDI ŠTA JE IZMENJENO NA RATE CON-U',
    cta: [['Proveri svoj'], ['rate con', 'besplatno.']],
    steps: ['Ubaci svoj rate con (PDF)', 'Otvaramo svaku sačuvanu verziju u fajlu', 'Vidiš svaku izmenu: pre → posle'],
    facts: ['3 besplatne PDF provere mesečno', 'Bez kreditne kartice'],
  },
};

const hud = (n: number): [string, string] => ['HAULOCK // PDF TAMPER CHECK', `${n} / 4`];

// ---------- 1: the rate con, as received, open on a laptop ----------
const PAGE_PT = { w: 612, h: 792 };
export const TamperSlide1: React.FC<{ lang: Lang }> = ({ lang }) => {
  const t = T[lang];
  const screen = { w: 880, h: 520 };
  const view = { w: screen.w, h: screen.h - 52 }; // under the viewer's title bar
  const z = 2.0; // px per pt ("200%"): rate & accessorials down to the signatures
  const fx = 268; // page margin (x 48) at the left edge
  const fy = 409; // top edge just above the line-haul row
  return (
    <Post hud={hud(1)}>
      <Headline top={104} size={88} accentSize={132} lines={t.hook} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 352, textAlign: 'center', fontFamily: fonts.serif, fontStyle: 'italic', fontSize: 72, color: colors.orange, textShadow: '0 6px 30px rgba(0,0,0,0.55)' }}>{t.sub}</div>
      <Laptop left={(POST_W - (screen.w + 36)) / 2} top={500} screen={screen}>
        <PdfViewer file="rate-con-4821.pdf" zoom="200%">
          <Img
            src={staticFile('recordings/rate-con-received.png')}
            style={{ position: 'absolute', width: PAGE_PT.w * z, height: PAGE_PT.h * z, left: view.w / 2 - fx * z, top: view.h / 2 - (PAGE_PT.h - fy) * z, maxWidth: 'none' }}
          />
        </PdfViewer>
      </Laptop>
      <div style={{ position: 'absolute', right: 70, top: 474, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', borderRadius: 999, background: 'linear-gradient(90deg, #DC2626, #C2410C)', color: '#fff', fontFamily: fonts.mono, fontSize: 20, letterSpacing: 3, boxShadow: '0 12px 30px rgba(220,38,38,0.45)' }}>
        <Icon kind="file" color="#fff" size={22} /> {t.asReceived}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1176, textAlign: 'center', fontFamily: fonts.mono, fontWeight: 600, fontSize: 28, letterSpacing: 4, color: colors.orange }}>{t.swipe}</div>
    </Post>
  );
};

// ---------- 2: $1,400 → $1,100, on the app's own before/after card, on a phone ----------
const SHOT = { css: { w: 430, h: 880 }, statusBar: 52 }; // public/recordings/phone-v3.png
export const TamperSlide2: React.FC<{ lang: Lang }> = ({ lang }) => {
  const t = T[lang];
  const k = 560 / SHOT.css.w;
  const screen = { w: 560, h: Math.round((SHOT.css.h + SHOT.statusBar) * k) };
  return (
    <Post hud={hud(2)}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 112, textAlign: 'center', fontFamily: fonts.mono, fontSize: 30, letterSpacing: 6, color: colors.dim }}>LINE HAUL</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 158, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 26, fontFamily: fonts.sans, fontWeight: 500, fontSize: 124, letterSpacing: -5 }}>
        <span style={{ color: 'rgba(245,243,238,0.5)', textDecoration: 'line-through', textDecorationColor: colors.red, textDecorationThickness: 8 }}>$1,400</span>
        <svg width={70} height={70} viewBox="0 0 24 24" fill="none" stroke={colors.cream} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
        <span style={{ color: colors.redGlow, textShadow: '0 6px 40px rgba(220,38,38,0.5)' }}>$1,100</span>
      </div>
      <Phone left={(POST_W - (screen.w + 32)) / 2} top={366} screen={screen} statusBar={Math.round(SHOT.statusBar * k)}>
        <Img src={staticFile('recordings/phone-v3.png')} style={{ width: SHOT.css.w * k, height: SHOT.css.h * k, display: 'block' }} />
      </Phone>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1060, display: 'flex', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 30, padding: '18px 44px 22px', borderRadius: 26, backgroundColor: colors.red, color: '#fff', boxShadow: '0 30px 80px rgba(220,38,38,0.55), 0 0 0 6px rgba(255,255,255,0.9)', transform: 'rotate(-5deg)' }}>
          <span style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 150, letterSpacing: -6, lineHeight: 1 }}>−$300</span>
          <span style={{ fontFamily: fonts.mono, fontWeight: 600, fontSize: 26, letterSpacing: 3, lineHeight: 1.35 }}>
            {t.stamp[0]}
            <br />
            {t.stamp[1]}
          </span>
        </div>
      </div>
    </Post>
  );
};

// ---------- 3: everything that changed ----------
export const TamperSlide3: React.FC<{ lang: Lang }> = ({ lang }) => (
  <Post hud={hud(3)}>
    <Headline top={84} size={84} accentSize={lang === 'sr' ? 84 : 96} lines={T[lang].shows} />
    <ChangesCard
      lang={lang}
      shown={[1, 1, 1, 1]}
      footer={1}
      style={{ left: 90, top: 300, width: 900, height: 964, boxShadow: '0 40px 120px rgba(0,0,0,0.65), 0 0 0 3px rgba(220,38,38,0.55), 0 0 90px rgba(220,38,38,0.3)' }}
    />
  </Post>
);

// ---------- 4: check yours free (the reels' cream end card) ----------
export const TamperSlide4: React.FC<{ lang: Lang }> = ({ lang }) => {
  const t = T[lang];
  return <CreamCta hudRight="4 / 4" chip={t.chip} cta={t.cta as [string[], string[]]} steps={t.steps} facts={t.facts} />;
};

export const TAMPER_SLIDES = [TamperSlide1, TamperSlide2, TamperSlide3, TamperSlide4];
