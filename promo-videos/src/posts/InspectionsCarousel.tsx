import React from 'react';
import { Img, staticFile } from 'remotion';
import { AlertPhone } from '../components/AlertPhone';
import { Phone } from '../components/Devices';
import { FootageLayer } from '../components/FootageLayer';
import { colors, fonts } from '../theme';
import { CreamCta } from './CreamCta';
import { Headline, POST_W, Post } from './Posts';

// 4-slide carousel (4:5) for the `inspections` reel, in English and Serbian:
// 1 totals only tell you so much → 2 every inspection, every crash → 3 alerts on your own
// DOT → 4 check any carrier free. Same example data, recording and alert as the reel.
export type Lang = 'en' | 'sr';

const T = {
  en: {
    hook: [[{ text: 'Totals only' }], [{ text: 'tell you so much.', accent: true, color: colors.cream }]],
    totals: ['INSPECTIONS', 'OUT OF SERVICE', 'CRASHES'],
    swipe: 'SWIPE → SEE EVERY INSPECTION',
    every: [[{ text: 'Every inspection.' }], [{ text: 'Every crash.', accent: true, color: colors.redGlow }]],
    everySub: 'LAST 24 MONTHS · STRAIGHT FROM FMCSA',
    when: ['WHEN', '& WHERE'],
    what: ['WHAT THE', 'OFFICER FOUND'],
    alert: [[{ text: 'Your own DOT?' }], [{ text: 'Know as soon as', accent: true }], [{ text: 'FMCSA posts it.', accent: true }]],
    alertSub: 'NEW INSPECTION OR CRASH → AN EMAIL · PAID PLANS',
    chip: 'INSPECTIONS · CRASHES · ALERTS',
    cta: [['Check any'], ['carrier', 'free.']] as [string[], string[]],
    steps: ['Every inspection & crash, 24 months', 'Open one to see each violation', 'Email alerts for your own DOT'],
    facts: ['Free plan: 3 lookups a month', 'Alerts on paid plans'],
  },
  sr: {
    hook: [[{ text: 'Ukupni brojevi' }], [{ text: 'ne govore sve.', accent: true, color: colors.cream }]],
    totals: ['INSPEKCIJA', 'OUT OF SERVICE', 'SUDARA'],
    swipe: 'PREVUCI → VIDI SVAKU INSPEKCIJU',
    every: [[{ text: 'Svaka inspekcija.' }], [{ text: 'Svaki sudar.', accent: true, color: colors.redGlow }]],
    everySub: 'POSLEDNJA 24 MESECA · DIREKTNO IZ FMCSA',
    when: ['KADA', 'I GDE'],
    what: ['ŠTA JE', 'INSPEKTOR NAŠAO'],
    alert: [[{ text: 'Tvoj DOT?' }], [{ text: 'Saznaj čim', accent: true }], [{ text: 'FMCSA objavi.', accent: true }]],
    alertSub: 'NOVA INSPEKCIJA ILI SUDAR → EMAIL · PLAĆENI PLANOVI',
    chip: 'INSPEKCIJE · SUDARI · UPOZORENJA',
    cta: [['Proveri prevoznika'], ['', 'besplatno.']] as [string[], string[]],
    steps: ['Sve inspekcije i sudari, 24 meseca', 'Otvori inspekciju, vidi prekršaje', 'Upozorenja za tvoj DOT na email'],
    facts: ['Besplatno: 3 provere mesečno', 'Upozorenja: plaćeni planovi'],
  },
};

const hud = (n: number, extra = ''): [string, string] => [`HAULOCK // INSPECTIONS & CRASHES${extra}`, `${n} / 4`];

// ---------- 1: the totals, over the road ----------
export const InspSlide1: React.FC<{ lang: Lang }> = ({ lang }) => {
  const t = T[lang];
  const rows = [
    { n: '90', label: t.totals[0], color: colors.cream },
    { n: '8', label: t.totals[1], color: colors.redGlow },
    { n: '3', label: t.totals[2], color: colors.cream },
  ];
  return (
    <Post hud={hud(1)}>
      <FootageLayer segments={[{ from: 0, to: 300, clip: 'truck-fog', dim: 0.6 }]} />
      <Headline top={110} size={92} accentSize={124} lines={t.hook} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 410, textAlign: 'center', fontFamily: fonts.mono, fontSize: 24, letterSpacing: 4, color: colors.dim }}>DOT-3271••• · {lang === 'sr' ? 'POSLEDNJA 24 MESECA' : 'LAST 24 MONTHS'}</div>
      {rows.map((x, i) => (
        <div
          key={x.label}
          style={{
            position: 'absolute',
            left: 150,
            right: 150,
            top: 470 + i * 200,
            height: 170,
            display: 'flex',
            alignItems: 'center',
            gap: 34,
            padding: '0 44px',
            borderRadius: 28,
            backgroundColor: 'rgba(6,16,38,0.78)',
            border: `2px solid ${i === 1 ? 'rgba(248,113,113,0.6)' : 'rgba(245,243,238,0.22)'}`,
            boxShadow: i === 1 ? '0 0 50px rgba(220,38,38,0.35)' : '0 20px 60px rgba(0,0,0,0.45)',
          }}
        >
          <span style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 116, letterSpacing: -4, color: x.color, minWidth: 150 }}>{x.n}</span>
          <span style={{ fontFamily: fonts.mono, fontWeight: 600, fontSize: 32, letterSpacing: 4, color: colors.cream }}>{x.label}</span>
        </div>
      ))}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1150, textAlign: 'center', fontFamily: fonts.mono, fontWeight: 600, fontSize: 28, letterSpacing: 4, color: colors.orange }}>{t.swipe}</div>
    </Post>
  );
};

// ---------- 2: the panel on a phone, with what each part tells you ----------
const SHOT = { w: 430, h: 880, status: 52 }; // public/recordings/phone-inspections.png
export const InspSlide2: React.FC<{ lang: Lang }> = ({ lang }) => {
  const t = T[lang];
  const k = 480 / SHOT.w;
  const screen = { w: 480, h: Math.round((SHOT.h + SHOT.status) * k) };
  const left = (POST_W - (screen.w + 32)) / 2;
  const top = 356;
  const y = (css: number) => top + 16 + SHOT.status * k + css * k; // slide y of a screenshot point
  const callout = (lines: string[], side: 'left' | 'right', atY: number, color: string) => (
    <div style={{ position: 'absolute', top: atY - 34, [side]: 26, width: left - 40, display: 'flex', flexDirection: 'column', alignItems: side === 'left' ? 'flex-end' : 'flex-start', fontFamily: fonts.mono, fontWeight: 600, fontSize: 26, letterSpacing: 2, lineHeight: 1.35, color, textAlign: side === 'left' ? 'right' : 'left' }}>
      {lines.map((l) => (
        <span key={l}>{l}</span>
      ))}
      <span style={{ marginTop: 8, width: 70, height: 3, backgroundColor: color, borderRadius: 2 }} />
    </div>
  );
  return (
    <Post hud={hud(2, ' · EXAMPLE DATA')}>
      <Headline top={96} size={84} accentSize={112} lines={t.every} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 300, textAlign: 'center', fontFamily: fonts.mono, fontSize: 22, letterSpacing: 4, color: colors.dim }}>{t.everySub}</div>
      <Phone left={left} top={top} screen={screen} statusBar={Math.round(SHOT.status * k)}>
        <Img src={staticFile('recordings/phone-inspections.png')} style={{ width: SHOT.w * k, height: SHOT.h * k, display: 'block' }} />
      </Phone>
      {callout(t.when, 'left', y(688), colors.orange)}
      {callout(t.what, 'right', y(735), colors.redGlow)}
    </Post>
  );
};

// ---------- 3: the alert on your own DOT ----------
export const InspSlide3: React.FC<{ lang: Lang }> = ({ lang }) => {
  const t = T[lang];
  return (
    <Post hud={hud(3, ' · EXAMPLE DATA')}>
      <Headline top={84} size={84} accentSize={104} lines={t.alert} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 404, textAlign: 'center', fontFamily: fonts.mono, fontSize: 22, letterSpacing: 3, color: colors.dim }}>{t.alertSub}</div>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, transform: 'scale(0.92)', transformOrigin: '540px 470px' }}>
        <AlertPhone t={{ notifyAt: 0, openAt: 100000, scroll: [100000, 100001] }} top={470} />
      </div>
    </Post>
  );
};

// ---------- 4: check any carrier free ----------
export const InspSlide4: React.FC<{ lang: Lang }> = ({ lang }) => {
  const t = T[lang];
  return <CreamCta hudRight="4 / 4" chip={t.chip} cta={t.cta} steps={t.steps} facts={t.facts} stepsLeft={130} />;
};

export const INSPECTION_SLIDES = [InspSlide1, InspSlide2, InspSlide3, InspSlide4];
