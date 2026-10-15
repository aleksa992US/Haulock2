import React from 'react';
import { AbsoluteFill, Html5Audio, Img, OffthreadVideo, Sequence, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Ring, Tap } from '../components/AppScreen';
import { Sfx, VoTrack } from '../components/audio';
import { Phone } from '../components/Devices';
import { Stamp, phraseVo } from '../components/FeatureReel';
import { Flash, Scanlines, glitchAt, rgbSplit, shake } from '../components/fx';
import pdfMarks from '../../public/recordings/pdf-tamper-tall.marks.json';
import coiMarks from '../../public/recordings/coi.marks.json';
import officersMarks from '../../public/recordings/report-officers.marks.json';
import authorityMarks from '../../public/recordings/report-authority.marks.json';
import inspMarks from '../../public/recordings/inspections.marks.json';
import plannerMarks from '../../public/recordings/load-planner.marks.json';
import { FPS, clamp, colors, fonts } from '../theme';

// 60 s, 16:9 product demo: six features, ~10 s each, on one phone that switches between
// the app recordings the reels use (scripts/record-*.mjs; all example data), with big
// captions on the left and the cream end card. VO: one ElevenLabs take (Desmond,
// eleven_v4, take A), cut into phrases at its measured pauses and placed so each feature
// starts on its 10-second mark.
export const DEMO_WIDE_W = 1920;
export const DEMO_WIDE_H = 1080;
export const DEMO_WIDE_DURATION = 1800;

// `at`: where the phrase starts in the video (s); otherwise `gap` after the one before.
type Line = { text: string; speech: [number, number]; at?: number; gap?: number };
const place = (lines: Line[]) => {
  let cursor = 0;
  return lines.map((l) => {
    const start = l.at ?? cursor + (l.gap ?? 0);
    const gap = start - cursor;
    cursor = start + l.speech[1] - l.speech[0];
    return { text: l.text, speech: l.speech, gap };
  });
};
export const VO = phraseVo(
  'voiceovers/demo-60.mp3',
  place([
    { text: 'Was your rate con edited?', speech: [0.07, 1.39], at: 0.35 }, // 0
    { text: 'Haulock shows exactly what changed.', speech: [1.9, 3.95], gap: 0.5 }, // 1
    { text: 'Fourteen hundred…', speech: [4.45, 5.34], gap: 0.8 }, // 2
    { text: 'cut to ELEVEN hundred.', speech: [5.72, 7.21], gap: 1.0 }, // 3
    { text: 'This COI says one MILLION in coverage.', speech: [7.65, 10.86], at: 10.35 }, // 4
    { text: "But the insurer's FMCSA filing?", speech: [11.21, 13.47], gap: 0.45 }, // 5
    { text: 'Cancelling in twelve days.', speech: [13.91, 15.44], gap: 0.6 }, // 6
    { text: 'A broker calls with a perfect load.', speech: [15.88, 17.71], at: 20.35 }, // 7
    { text: 'Hang up.', speech: [18.17, 18.58], gap: 0.6 }, // 8
    { text: 'Call the number FMCSA has…', speech: [18.96, 20.97], gap: 0.8 }, // 9
    { text: 'and ask for the officers by name.', speech: [21.2, 22.94], gap: 0.4 }, // 10
    { text: 'This MC looks twelve years old.', speech: [23.41, 25.51], at: 30.35 }, // 11
    { text: 'But it sat DEAD for over two years…', speech: [25.85, 28.09], gap: 0.45 }, // 12
    { text: 'then came back to life.', speech: [28.4, 29.88], gap: 0.4 }, // 13
    { text: 'Haulock flags it.', speech: [30.34, 31.24], gap: 0.7 }, // 14
    { text: 'Every roadside inspection and crash.', speech: [31.64, 33.99], at: 40.35 }, // 15
    { text: 'And an email as soon as FMCSA posts a new one on your DOT.', speech: [34.28, 38.53], gap: 1.2 }, // 16
    { text: 'Is the load worth it?', speech: [38.95, 39.77], at: 50.35 }, // 17
    { text: 'See the route,', speech: [40.16, 40.8], gap: 0.6 }, // 18
    { text: 'the miles…', speech: [41.1, 41.74], gap: 0.35 }, // 19
    { text: "and what's really left.", speech: [42.03, 43.13], gap: 0.35 }, // 20
    { text: 'Check any carrier free…', speech: [43.51, 44.85], at: 56.0 }, // 21
    { text: 'at haulock.com.', speech: [45.14, 46.35], gap: 0.3 }, // 22
  ]),
  46.55
);
export const W = VO.at;
export const BLOCKS = [0, 300, 600, 900, 1200, 1500];
export const END = W(21) - 12;

// ---------- the phone ----------
const CSS = { w: 430, h: 880 };
const SCREEN_W = 520;
const K = SCREEN_W / CSS.w;
const STATUS = Math.round(52 * K);
const SCREEN = { w: SCREEN_W, h: Math.round(CSS.h * K) + STATUS };
const PHONE_LEFT = 1430 - (SCREEN.w + 32) / 2;
const PHONE_TOP = 64;

const REC = {
  pdf: 'recordings/pdf-tamper-tall.mp4',
  coi: 'recordings/coi.mp4',
  officers: 'recordings/report-officers.mp4',
  authority: 'recordings/report-authority.mp4',
  insp: 'recordings/inspections.mp4',
  planner: 'recordings/load-planner.mp4',
};
const PM = pdfMarks.marks;
const CM = coiMarks.marks;
const OM = officersMarks.marks;
const AM = authorityMarks.marks;
const IM = inspMarks.marks;
const LM = plannerMarks.marks;
const LAND = 0.72; // a recorded scroll takes 0.6–0.7 s

// Each cut plays `src` from `from` s (at `rate`, to hold a still moment), shifted up `y` pt.
type Cut = { at: number; src: string; from: number; rate?: number; y?: number; punch?: boolean };
const PDF_LIFT = 100;
const COI_LIFT = 120;
export const HANG = W(8) + 4;
const CALL_BTN_Y = 640; // pt: the call screen's buttons
export const MAIL = W(16) + 50;
const CUTS: Cut[] = [
  // 1 · PDF edit check: upload → verdict → Version 3: line haul $1,400.00 → $1,100.00
  { at: 0, src: REC.pdf, from: 0.1, y: PDF_LIFT },
  { at: W(1) - 2, src: REC.pdf, from: PM.verdict.t + LAND, punch: true },
  { at: W(2) - 2, src: REC.pdf, from: PM.v3.t + LAND - 0.1, punch: true },
  { at: 240, src: REC.pdf, from: PM.v3.t + LAND },
  // 2 · COI check: the drop zone (held) → upload → "doesn't match" → cancellation pending
  { at: 300, src: REC.coi, from: 0.1, rate: 0.08, y: COI_LIFT },
  { at: 392, src: REC.coi, from: 0.62, y: COI_LIFT },
  { at: W(6) - 3, src: REC.coi, from: CM.verdict.t + LAND, punch: true },
  // 3 · Officers: an incoming call (overlay) → hang up → "call this number" → officers by name
  { at: 600, src: REC.officers, from: OM.verdict.t + LAND, rate: 0.05 },
  { at: HANG, src: REC.officers, from: OM.verdict.t + LAND, punch: true },
  { at: W(10) - 2, src: REC.officers, from: OM.identity.t + LAND, punch: true },
  { at: 860, src: REC.officers, from: OM.identity.t + LAND + 0.1 },
  // 4 · Authority history: 12y 4m · reactivated → the open flag → +30
  { at: 900, src: REC.authority, from: AM.age.t + LAND, punch: true },
  { at: W(12) - 2, src: REC.authority, from: AM.flagOpen.t + 0.62, punch: true },
  { at: 1060, src: REC.authority, from: AM.flagOpen.t + 0.7 },
  { at: W(14) - 2, src: REC.authority, from: AM.verdict.t + LAND, punch: true },
  // 5 · Inspections: totals → latest → tap opens the out-of-service one (then the alert)
  { at: 1200, src: REC.insp, from: 0.75 },
  { at: 1240, src: REC.insp, from: IM.latest.t + 0.7, punch: true },
  // 6 · Load planner: typing the delivery → the truck route → what's left
  { at: 1500, src: REC.planner, from: LM.delivery.t - 0.4 },
  { at: W(18) - 2, src: REC.planner, from: LM.map.t + LAND, punch: true },
  { at: W(20) - 2, src: REC.planner, from: LM.profit.t + LAND, punch: true },
];
const mid = (r: number[]) => ({ x: r[1] + r[3] / 2, y: r[2] + r[4] / 2 });
const rect = (m: { t: number; rect: { x: number; y: number; w: number; h: number } | null }) => [m.t, m.rect!.x, m.rect!.y, m.rect!.w, m.rect!.h];
const TAPS = [
  { at: Math.round((PM.tap.t - 0.1) * FPS), x: mid(rect(PM.tap)).x, y: mid(rect(PM.tap)).y - PDF_LIFT },
  { at: 392 + Math.round((CM.upload.t - 0.62) * FPS), x: 215, y: 760 - COI_LIFT },
  { at: HANG - 3, x: 120, y: CALL_BTN_Y }, // decline
  { at: 1240 + Math.round((IM.tap.t - IM.latest.t - 0.7) * FPS), x: IM.tap.rect!.x + IM.tap.rect!.w * 0.55, y: IM.tap.rect!.y + IM.tap.rect!.h / 2 },
  { at: MAIL - 4, x: 215, y: 60 }, // the notification
];
type RingSpec = { from: number; until: number; x: number; y: number; w: number; h: number; color: string };
const RINGS: RingSpec[] = [
  { from: W(2), until: W(3) - 2, x: 90, y: 222, w: 280, h: 48, color: colors.red },
  { from: W(3), until: 296, x: 90, y: 280, w: 280, h: 48, color: colors.green },
  { from: W(6), until: 596, x: 44, y: 326, w: 342, h: 214, color: colors.red },
  { from: W(9), until: W(10) - 2, x: 52, y: 264, w: 330, h: 130, color: colors.greenGlow },
  { from: W(10) + 2, until: 896, x: 48, y: 428, w: 340, h: 46, color: colors.orange },
  { from: 914, until: W(12) - 2, x: 40, y: 312, w: 350, h: 50, color: colors.amber },
  { from: W(12) + 4, until: W(13) - 2, x: 70, y: 375, w: 144, h: 80, color: colors.red },
  { from: W(13), until: W(14) - 2, x: 216, y: 309, w: 144, h: 66, color: colors.orange },
  { from: W(14) + 2, until: 1196, x: 48, y: 506, w: 340, h: 32, color: colors.red },
];

const CutView: React.FC<{ c: Cut }> = ({ c }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = c.punch ? 1 + 0.04 * (1 - spring({ frame, fps, config: { damping: 14, stiffness: 220 } })) : 1;
  return (
    <AbsoluteFill style={{ transform: `scale(${scale})`, backgroundColor: colors.cream }}>
      <OffthreadVideo
        src={staticFile(c.src)}
        trimBefore={Math.round(c.from * FPS)}
        playbackRate={c.rate ?? 1}
        muted
        style={{ position: 'absolute', left: 0, top: -(c.y ?? 0) * K, width: CSS.w * K, height: CSS.h * K, maxWidth: 'none' }}
      />
    </AbsoluteFill>
  );
};

// An incoming call on the phone; the decline button is pressed at `hangAt`.
// Phone screen geometry (CallScreen and Alert are drawn for it).
export const PHONE_SCREEN = { w: SCREEN_W, h: SCREEN.h, status: STATUS };

export const CallScreen: React.FC<{ hangAt: number; fadeOut?: boolean }> = ({ hangAt, fadeOut = true }) => {
  const frame = useCurrentFrame();
  const out = fadeOut ? interpolate(frame, [hangAt, hangAt + 8], [0, 1], clamp) : 0;
  const pulse = 1 + 0.06 * Math.sin(frame / 4);
  const btn = (left: number, color: string, label: string, rot: number, pressed: boolean) => (
    <div style={{ position: 'absolute', left: left - 52, top: CALL_BTN_Y * K - 52, width: 104, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={{ width: 104, height: 104, borderRadius: 52, backgroundColor: color, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${pressed ? 0.88 : pulse})`, boxShadow: `0 0 40px ${color}88` }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="#fff" style={{ transform: `rotate(${rot}deg)` }}>
          <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" />
        </svg>
      </div>
      <span style={{ fontFamily: fonts.sans, fontSize: 22, color: 'rgba(255,255,255,0.85)' }}>{label}</span>
    </div>
  );
  return (
    <AbsoluteFill style={{ opacity: 1 - out, background: 'linear-gradient(180deg, #2a3446 0%, #121822 70%)', fontFamily: fonts.sans, color: '#fff' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 120, textAlign: 'center' }}>
        <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.6)' }}>{frame >= hangAt ? 'Call ended' : 'incoming call'}</div>
        <div style={{ marginTop: 14, fontSize: 46, fontWeight: 500, letterSpacing: -1 }}>Quillmont Freight</div>
        <div style={{ marginTop: 8, fontSize: 26, color: 'rgba(255,255,255,0.7)' }}>(555) 016-3390</div>
      </div>
      <div style={{ position: 'absolute', left: SCREEN_W / 2 - 80, top: 330, width: 160, height: 160, borderRadius: 80, backgroundColor: '#4b5568', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 60, fontWeight: 500 }}>QF</div>
      {btn(120 * K, '#EF4444', 'Decline', 135, frame >= hangAt - 3)}
      {btn((CSS.w - 120) * K, '#22C55E', 'Accept', 0, false)}
    </AbsoluteFill>
  );
};

// The own-company alert: a notification drops in, then the email (public/recordings/
// alert-email.png — lib/email.ts rendered with the example inspection) opens and scrolls.
export const Alert: React.FC<{ openAt: number; scroll: [number, number] }> = ({ openAt, scroll }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drop = spring({ frame, fps, config: { damping: 15, stiffness: 180 } });
  const open = spring({ frame: frame - openAt, fps, config: { damping: 18, stiffness: 150 } });
  const y = interpolate(frame, scroll, [0, 330], { ...clamp, easing: (v) => (v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2) });
  const emailH = Math.round((3099 / 1170) * SCREEN_W);
  return (
    <AbsoluteFill>
      {frame >= openAt - 1 ? (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: '#F5F3EE', transform: `translateY(${(1 - open) * 100}%)` }}>
          <div style={{ height: 64, display: 'flex', alignItems: 'center', padding: '0 22px', fontFamily: fonts.sans, fontSize: 24, color: '#2563EB', backgroundColor: '#fff', borderBottom: '1px solid rgba(11,30,63,0.1)' }}>‹ Inbox</div>
          <div style={{ position: 'absolute', top: 64, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
            <Img src={staticFile('recordings/alert-email.png')} style={{ position: 'absolute', left: 0, top: -y, width: SCREEN_W, height: emailH }} />
          </div>
        </div>
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: 14,
          right: 14,
          top: 14,
          padding: '18px 20px',
          borderRadius: 28,
          backgroundColor: 'rgba(250,250,250,0.96)',
          boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
          display: 'flex',
          gap: 16,
          transform: `translateY(${(1 - drop) * -180}px)`,
          opacity: 1 - interpolate(frame, [openAt, openAt + 6], [0, 1], clamp),
          fontFamily: fonts.sans,
        }}
      >
        <div style={{ flexShrink: 0, width: 58, height: 58, borderRadius: 14, backgroundColor: colors.navy, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.orange, fontWeight: 800, fontSize: 28 }}>H</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, color: 'rgba(11,30,63,0.55)', letterSpacing: 0.5 }}>
            <span>HAULOCK</span>
            <span>now</span>
          </div>
          <div style={{ marginTop: 4, fontSize: 22, fontWeight: 600, color: colors.navy, lineHeight: 1.25 }}>Out-of-service inspection on your DOT</div>
          <div style={{ marginTop: 4, fontSize: 19, color: 'rgba(11,30,63,0.7)', lineHeight: 1.3 }}>Oct 2 · Joplin, MO · Level II · brake out of adjustment</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const DemoPhone: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16, stiffness: 120 } });
  const swap = BLOCKS.slice(1).reduce((s, b) => s + interpolate(frame, [b - 2, b + 2, b + 10], [0, 1, 0], clamp), 0);
  const exit = interpolate(frame, [END - 8, END + 4], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ opacity: Math.min(1, enter * 1.5) * (1 - exit), transform: `translateX(${(1 - enter) * 300}px) scale(${1 - 0.03 * swap})` }}>
      <Phone left={PHONE_LEFT} top={PHONE_TOP} screen={SCREEN} statusBar={STATUS}>
        {CUTS.map((c, i) => {
          const next = CUTS[i + 1];
          return (
            <Sequence key={i} from={c.at} durationInFrames={(next ? next.at : END + 6) - c.at}>
              <CutView c={c} />
            </Sequence>
          );
        })}
        <Sequence from={600} durationInFrames={HANG + 10 - 600}>
          <CallScreen hangAt={HANG - 600} />
        </Sequence>
        <Sequence from={W(16) + 6} durationInFrames={1500 - W(16) - 6}>
          <Alert openAt={MAIL - W(16) - 6} scroll={[MAIL + 30 - W(16) - 6, 1492 - W(16) - 6]} />
        </Sequence>
        {RINGS.map((r, i) => (
          <Sequence key={`r${i}`} from={r.from} durationInFrames={r.until - r.from}>
            <Ring x={r.x * K} y={r.y * K} w={r.w * K} h={r.h * K} color={r.color} out={r.until - r.from} />
          </Sequence>
        ))}
        {TAPS.map((t, i) => (
          <Tap key={i} at={t.at} x={t.x * K} y={t.y * K} />
        ))}
        {swap > 0.05 ? <AbsoluteFill style={{ backgroundColor: `rgba(4,11,26,${0.8 * swap})` }} /> : null}
      </Phone>
    </AbsoluteFill>
  );
};

// ---------- the left column ----------
export type Tok = { text: string; at: number; serif?: boolean; color?: string; size?: number };
type Chunk = { until: number; lines: Tok[][] };
const accent = (text: string, at: number, color: string = colors.orange, size?: number): Tok => ({ text, at, serif: true, color, size });
export const CHUNKS: Chunk[] = [
  { until: W(1) - 3, lines: [[{ text: 'Was your rate con', at: 0 }], [accent('edited?', 0)]] },
  { until: W(2) - 3, lines: [[{ text: 'Haulock shows', at: 1 }], [accent('exactly what changed.', 1, colors.orange, 104)]] },
  { until: 292, lines: [[{ text: 'Line haul', at: 2 }, { text: '$1,400', at: 2, color: colors.greenGlow }], [accent('cut to $1,100.', 3, colors.redGlow)]] },
  { until: W(5) - 3, lines: [[{ text: 'This COI says', at: 4 }], [accent('$1M in coverage.', 4)]] },
  { until: W(6) - 3, lines: [[{ text: "But the insurer's", at: 5 }], [accent('FMCSA filing?', 5)]] },
  { until: 592, lines: [[{ text: 'Cancelling', at: 6 }], [accent('in 12 days.', 6, colors.redGlow)]] },
  { until: W(8) - 3, lines: [[{ text: 'A broker calls with', at: 7 }], [accent('a perfect load.', 7)]] },
  { until: W(9) - 3, lines: [[{ text: 'Hang', at: 8 }], [accent('up.', 8, colors.redGlow)]] },
  { until: W(10) - 3, lines: [[{ text: 'Call the number', at: 9 }], [accent('FMCSA has…', 9)]] },
  { until: 892, lines: [[{ text: 'and ask for the officers', at: 10 }], [accent('by name.', 10)]] },
  { until: W(12) - 3, lines: [[{ text: 'This MC looks', at: 11 }], [accent('12 years old.', 11, colors.greenGlow)]] },
  { until: W(13) - 3, lines: [[{ text: 'But it sat dead', at: 12 }], [accent('for 2+ years…', 12, colors.redGlow)]] },
  { until: W(14) - 3, lines: [[{ text: 'then came back', at: 13 }], [accent('to life.', 13)]] },
  { until: 1192, lines: [[{ text: 'Haulock', at: 14 }], [accent('flags it.', 14, colors.redGlow)]] },
  { until: W(16) - 3, lines: [[{ text: 'Every roadside', at: 15 }], [accent('inspection & crash.', 15, colors.orange, 108)]] },
  { until: 1492, lines: [[{ text: 'An email as soon as', at: 16 }], [accent('FMCSA posts one.', 16)]] },
  { until: W(18) - 3, lines: [[{ text: 'Is the load', at: 17 }], [accent('worth it?', 17)]] },
  { until: W(20) - 3, lines: [[{ text: 'See the route,', at: 18 }], [accent('the miles…', 19)]] },
  { until: END, lines: [[{ text: "and what's", at: 20 }], [accent('really left.', 20, colors.greenGlow)]] },
];

const Caption: React.FC = () => {
  const frame = useCurrentFrame();
  const chunk = CHUNKS.find((c) => frame >= W(c.lines[0][0].at) - 3 && frame < c.until);
  if (!chunk) return null;
  return (
    <div style={{ position: 'absolute', left: 110, width: 960, top: 300 }}>
      {chunk.lines.map((line, li) => (
        <div key={li} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 22 }}>
          {line.map((tok, ti) => {
            const at = W(tok.at) - 2;
            if (frame < at) return null;
            const p = interpolate(frame, [at, at + 7], [0, 1], { ...clamp, easing: (x) => 1 - Math.pow(1 - x, 3) });
            return (
              <span
                key={ti}
                style={{
                  display: 'inline-block',
                  opacity: p,
                  transform: `translateY(${(1 - p) * 30}px)`,
                  filter: `blur(${(1 - p) * 10}px)`,
                  color: tok.color ?? colors.cream,
                  textShadow: '0 6px 30px rgba(0,0,0,0.55)',
                  lineHeight: 1.08,
                  fontFamily: tok.serif ? fonts.serif : fonts.sans,
                  fontStyle: tok.serif ? 'italic' : undefined,
                  fontWeight: tok.serif ? 400 : 400,
                  fontSize: tok.size ?? (tok.serif ? 128 : 86),
                  letterSpacing: tok.serif ? -2 : -3,
                }}
              >
                {tok.text}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

export const FEATURES = [
  { name: 'PDF EDIT CHECK', short: 'PDF EDITS', tag: 'FREE · 3 PDF CHECKS A MONTH', paid: false },
  { name: 'COI CHECK', short: 'COI CHECK', tag: 'PAID PLANS', paid: true },
  { name: "WHO'S REALLY CALLING", short: 'OFFICERS', tag: 'FREE · IN EVERY REPORT', paid: false },
  { name: 'AUTHORITY HISTORY', short: 'AUTHORITY', tag: 'FREE · IN EVERY REPORT', paid: false },
  { name: 'INSPECTIONS, CRASHES & ALERTS', short: 'INSPECTIONS', tag: 'FREE · ALERTS ON PAID PLANS', paid: false },
  { name: 'LOAD PLANNER', short: 'LOAD PLANNER', tag: 'FREE · 10 LOAD PLANS A MONTH', paid: false },
];
export const blockOf = (frame: number) => BLOCKS.reduce((b, start, i) => (frame >= start ? i : b), 0);

const FeatureHeader: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const b = blockOf(frame);
  const f = FEATURES[b];
  const local = frame - BLOCKS[b];
  const pop = spring({ frame: local, fps, config: { damping: 15, stiffness: 190 } });
  const g = glitchAt(frame, BLOCKS[b], 8);
  const shown = Math.round(interpolate(local, [0, 12], [0, f.name.length], clamp));
  return (
    <div style={{ position: 'absolute', left: 110, top: 150, opacity: Math.min(1, pop * 1.5), transform: `translateX(${(1 - pop) * -40 + g * 14}px)` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 22 }}>
        <span style={{ fontFamily: fonts.mono, fontWeight: 700, fontSize: 44, color: colors.orange, textShadow: rgbSplit(g * 6) }}>{String(b + 1).padStart(2, '0')}</span>
        <span style={{ fontFamily: fonts.mono, fontSize: 26, color: colors.dim }}>/ 06</span>
        <span style={{ fontFamily: fonts.mono, fontWeight: 600, fontSize: 34, letterSpacing: 5, color: colors.cream }}>{f.name.slice(0, shown)}</span>
      </div>
      <div
        style={{
          display: 'inline-block',
          marginTop: 16,
          padding: '8px 18px',
          borderRadius: 999,
          fontFamily: fonts.mono,
          fontWeight: 600,
          fontSize: 20,
          letterSpacing: 3,
          color: f.paid ? colors.orange : colors.greenGlow,
          backgroundColor: f.paid ? 'rgba(255,107,53,0.14)' : 'rgba(74,222,128,0.12)',
          border: `2px solid ${f.paid ? 'rgba(255,107,53,0.5)' : 'rgba(74,222,128,0.4)'}`,
        }}
      >
        {f.tag}
      </div>
    </div>
  );
};

const Progress: React.FC = () => {
  const frame = useCurrentFrame();
  const b = blockOf(frame);
  return (
    <div style={{ position: 'absolute', left: 110, width: 960, top: 968, display: 'flex', gap: 12 }}>
      {FEATURES.map((f, i) => {
        const fill = i < b ? 1 : i > b ? 0 : interpolate(frame, [BLOCKS[i], (BLOCKS[i + 1] ?? END)], [0, 1], clamp);
        return (
          <div key={f.short} style={{ flex: 1 }}>
            <div style={{ fontFamily: fonts.mono, fontWeight: 600, fontSize: 15, letterSpacing: 2, color: i === b ? colors.cream : 'rgba(245,243,238,0.4)', whiteSpace: 'nowrap' }}>{f.short}</div>
            <div style={{ marginTop: 8, height: 5, borderRadius: 3, backgroundColor: 'rgba(245,243,238,0.14)', overflow: 'hidden' }}>
              <div style={{ width: `${fill * 100}%`, height: '100%', backgroundColor: colors.orange }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Stamps, under the caption.
export const STAMPS: { from: number; until: number; big: string; small: string[]; color: string }[] = [
  { from: W(3) + 8, until: 294, big: '−$300', small: ['LINE HAUL', 'CUT'], color: colors.red },
  { from: W(6) + 6, until: 594, big: 'Oct 27', small: ['CANCELLATION', 'PENDING'], color: colors.red },
  { from: W(9) + 6, until: W(10) - 2, big: '(555) 019-7744', small: ['ON FMCSA', 'RECORD'], color: colors.navy },
  { from: W(10) + 6, until: 894, big: 'Laura Bennett', small: ['ASK FOR', 'BY NAME'], color: colors.green },
  { from: W(12) + 10, until: W(14) - 2, big: '2y 3m', small: ['NO ACTIVE', 'AUTHORITY'], color: colors.red },
  { from: W(14) + 4, until: 1194, big: '+30', small: ['RED', 'FLAG'], color: colors.red },
  { from: MAIL + 6, until: 1494, big: 'Emailed', small: ['NEW INSPECTION', 'ON YOUR DOT'], color: colors.orange },
  { from: W(19) + 4, until: W(20) - 2, big: '927 mi', small: ['LOADED'], color: colors.orange },
  { from: W(20) + 6, until: END, big: '$1,194', small: ['LEFT AFTER', 'COSTS'], color: colors.green },
];

// ---------- frame pieces sized for 16:9 ----------
export const WideBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / 30;
  return (
    <AbsoluteFill style={{ backgroundColor: colors.void, overflow: 'hidden' }}>
      <AbsoluteFill style={{ background: `radial-gradient(70% 90% at 30% 40%, ${colors.navy} 0%, rgba(4,11,26,0) 75%)` }} />
      <div style={{ position: 'absolute', left: 1100 + Math.sin(t * 0.5) * 120, top: -200 + Math.cos(t * 0.4) * 80, width: 1000, height: 1000, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,107,53,0.2) 0%, rgba(255,107,53,0) 65%)' }} />
      <div style={{ position: 'absolute', left: -300 + Math.cos(t * 0.35) * 120, top: 500 + Math.sin(t * 0.45) * 90, width: 1100, height: 1100, borderRadius: '50%', background: 'radial-gradient(circle, rgba(220,38,38,0.14) 0%, rgba(220,38,38,0) 65%)' }} />
      <AbsoluteFill
        style={{
          backgroundImage: 'linear-gradient(rgba(245,243,238,0.04) 2px, transparent 2px), linear-gradient(90deg, rgba(245,243,238,0.04) 2px, transparent 2px)',
          backgroundSize: '80px 80px',
          backgroundPosition: `0 ${(frame * 0.6) % 80}px`,
          maskImage: 'linear-gradient(to bottom, transparent 0%, #000 60%)',
        }}
      />
    </AbsoluteFill>
  );
};

const WideHud: React.FC<{ tone?: 'dark' | 'light'; offset?: number }> = ({ tone = 'dark', offset = 0 }) => {
  const frame = useCurrentFrame() + offset;
  const stroke = tone === 'dark' ? 'rgba(245,243,238,0.5)' : 'rgba(11,30,63,0.35)';
  const text = tone === 'dark' ? colors.dim : 'rgba(11,30,63,0.55)';
  const L = 60;
  const corner = (x: number, y: number, dx: number, dy: number) => <path d={`M${x + dx * L} ${y} L${x} ${y} L${x} ${y + dy * L}`} fill="none" stroke={stroke} strokeWidth={3} />;
  const s = Math.floor(frame / 30);
  const label: React.CSSProperties = { position: 'absolute', fontFamily: fonts.mono, fontWeight: 500, fontSize: 18, letterSpacing: 3, color: text };
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <svg width={DEMO_WIDE_W} height={DEMO_WIDE_H} style={{ position: 'absolute', inset: 0 }}>
        {corner(36, 36, 1, 1)}
        {corner(DEMO_WIDE_W - 36, 36, -1, 1)}
        {corner(36, DEMO_WIDE_H - 36, 1, -1)}
        {corner(DEMO_WIDE_W - 36, DEMO_WIDE_H - 36, -1, -1)}
      </svg>
      <div style={{ ...label, left: 66, top: 52 }}>HAULOCK // PRODUCT DEMO</div>
      <div style={{ ...label, right: 66, top: 52, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: colors.orange, opacity: Math.floor(frame / 12) % 2 ? 0.3 : 1 }} />
        00:00:{String(s).padStart(2, '0')}:{String(frame % 30).padStart(2, '0')}
      </div>
      <div style={{ ...label, left: 110, bottom: 40, fontSize: 15 }}>EXAMPLE DATA · HAULOCK.COM</div>
    </AbsoluteFill>
  );
};

export const WideGlitch: React.FC<{ at: number; dur?: number }> = ({ at, dur = 8 }) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0 || t >= dur) return null;
  const r = (k: string, i: number) => random(`wg${at}-${t}-${i}-${k}`);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'screen' }}>
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: r('x', i) * 900 - 200,
            top: r('y', i) * DEMO_WIDE_H,
            width: 500 + r('w', i) * 1400,
            height: 6 + r('h', i) * 40,
            backgroundColor: r('c', i) > 0.5 ? 'rgba(255,107,53,0.55)' : 'rgba(0,210,255,0.4)',
            opacity: 1 - t / dur,
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

// ---------- the end card ----------
const EndList = ['See what changed on a rate con', 'COI vs. the insurer’s FMCSA filing', 'Officers & phone on record', 'Authority history', 'Inspections, crashes & alerts', 'Load planner'];
export const WideEnd: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const wipe = interpolate(frame, [0, 10], [0, 1], { ...clamp, easing: (v) => 1 - Math.pow(1 - v, 3) });
  const pop = (at: number) => spring({ frame: frame - at, fps, config: { damping: 13, stiffness: 200 } });
  const urlAt = W(22) - END;
  const head = pop(W(21) - END - 2);
  const url = pop(urlAt);
  return (
    <AbsoluteFill style={{ clipPath: `inset(${(1 - wipe) * 100}% 0 0 0)`, backgroundColor: colors.cream, fontFamily: fonts.sans, color: colors.ink }}>
      <AbsoluteFill style={{ backgroundImage: 'linear-gradient(rgba(11,30,63,0.045) 2px, transparent 2px), linear-gradient(90deg, rgba(11,30,63,0.045) 2px, transparent 2px)', backgroundSize: '72px 72px' }} />
      <AbsoluteFill style={{ background: 'radial-gradient(50% 50% at 30% 30%, rgba(255,107,53,0.16) 0%, rgba(245,243,238,0) 100%)' }} />
      <WideHud tone="light" offset={END} />
      <div style={{ position: 'absolute', left: 150, top: 190, opacity: pop(4) }}>
        <Img src={staticFile('brand/logo.png')} style={{ width: 600 }} />
      </div>
      <div style={{ position: 'absolute', left: 150, top: 360, opacity: Math.min(1, head * 1.4), transform: `translateY(${(1 - head) * 30}px)`, lineHeight: 1.02 }}>
        <div style={{ fontSize: 120, letterSpacing: -5 }}>Check any carrier</div>
        <div style={{ fontFamily: fonts.serif, fontStyle: 'italic', fontSize: 150, letterSpacing: -2, color: colors.orange }}>free.</div>
      </div>
      <div style={{ position: 'absolute', left: 150, top: 690, transform: `scale(${interpolate(url, [0, 1], [0.6, 1])})`, transformOrigin: 'left center', opacity: Math.min(1, url * 1.5) }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 22, padding: '20px 48px 24px', borderRadius: 999, backgroundColor: colors.navy, color: '#fff', fontWeight: 500, fontSize: 64, letterSpacing: -2, boxShadow: '0 30px 60px rgba(11,30,63,0.35)' }}>
          haulock.com
          <svg width={50} height={50} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 150, top: 850, fontFamily: fonts.mono, fontSize: 22, letterSpacing: 2, color: 'rgba(11,30,63,0.6)', opacity: pop(urlAt + 6) }}>
        FREE PLAN: 3 LOOKUPS, 3 PDF CHECKS, 10 LOAD PLANS A MONTH · NO CREDIT CARD
      </div>
      <div style={{ position: 'absolute', left: 1180, top: 250, display: 'flex', flexDirection: 'column', gap: 26 }}>
        {EndList.map((t, i) => {
          const p = pop(8 + i * 4);
          return (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 22, opacity: Math.min(1, p * 1.4), transform: `translateX(${(1 - p) * 40}px)` }}>
              <span style={{ flexShrink: 0, width: 54, height: 54, borderRadius: 27, backgroundColor: colors.navy, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.mono, fontWeight: 700, fontSize: 24 }}>{String(i + 1).padStart(2, '0')}</span>
              <span style={{ fontSize: 38, letterSpacing: -0.5 }}>{t}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ---------- the video ----------
export const DemoWide: React.FC = () => {
  const frame = useCurrentFrame();
  const jolt = STAMPS.reduce((s, st) => s + shake(frame, st.from, 7), 0);
  return (
    <AbsoluteFill style={{ backgroundColor: colors.void, fontFamily: fonts.sans }}>
      <AbsoluteFill style={{ transform: `translate(${jolt}px, ${jolt * 0.5}px)` }}>
        <WideBackground />
        <Scanlines opacity={0.5} />
        <Sequence durationInFrames={END}>
          <WideHud />
          <DemoPhone />
          <FeatureHeader />
          <Caption />
          <div style={{ position: 'absolute', left: 60, top: 0, width: 1060, height: DEMO_WIDE_H }}>
            {STAMPS.map((s, i) => (
              <Sequence key={i} from={s.from} durationInFrames={s.until - s.from}>
                <Stamp big={s.big} small={s.small} color={s.color} top={690} exitAt={s.until - s.from - 6} />
              </Sequence>
            ))}
          </div>
          <Progress />
        </Sequence>
      </AbsoluteFill>
      <Sequence from={END}>
        <WideEnd />
      </Sequence>

      {BLOCKS.slice(1).map((b) => (
        <React.Fragment key={b}>
          <WideGlitch at={b - 1} />
          <Flash at={b} strength={0.12} />
        </React.Fragment>
      ))}
      <WideGlitch at={END - 2} dur={8} />
      {STAMPS.map((s, i) => (
        <Flash key={i} at={s.from} color={s.color === colors.navy ? colors.orange : s.color} strength={0.12} />
      ))}

      <VoTrack vo={VO} />
      <Html5Audio
        src={staticFile('music/driving-ambition.mp3')}
        volume={(f) =>
          interpolate(f, [0, 4], [0, 1], clamp) *
          interpolate(f, [0, 1000, 1140, VO.end, VO.end + 12], [0.19, 0.19, 0.13, 0.13, 0.4], clamp) *
          interpolate(f, [DEMO_WIDE_DURATION - 24, DEMO_WIDE_DURATION - 1], [1, 0], clamp)
        }
      />
      {BLOCKS.slice(1).map((b) => (
        <Sfx key={b} src="sfx/glitch-a.mp3" at={b - 1} volume={0.26} />
      ))}
      {STAMPS.map((s, i) => (
        <Sfx key={`s${i}`} src="sfx/impact.mp3" at={s.from - 1} volume={0.18} />
      ))}
      {TAPS.map((t, i) => (
        <Sfx key={`t${i}`} src="sfx/beep.mp3" at={t.at} volume={0.2} />
      ))}
      <Sfx src="sfx/scan.mp3" at={30} volume={0.3} />
      <Sfx src="sfx/scan.mp3" at={406} volume={0.3} />
      <Sfx src="sfx/beep.mp3" at={W(16) + 6} volume={0.3} />
      <Sfx src="sfx/glitch-b.mp3" at={END - 2} volume={0.3} />
      <Sfx src="sfx/impact.mp3" at={W(22) - 1} volume={0.18} />
    </AbsoluteFill>
  );
};
