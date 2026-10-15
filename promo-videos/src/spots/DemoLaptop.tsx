import React from 'react';
import { AbsoluteFill, Html5Audio, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Ring } from '../components/AppScreen';
import { Sfx, VoTrack } from '../components/audio';
import { Laptop, Phone } from '../components/Devices';
import { Stamp } from '../components/FeatureReel';
import { Flash, Scanlines, shake } from '../components/fx';
import { Alert, BLOCKS, CHUNKS, CallScreen, END, FEATURES, HANG, MAIL, PHONE_SCREEN, STAMPS, VO, W, WideBackground, WideEnd, WideGlitch, blockOf } from './DemoWide';
import pdfMarks from '../../public/recordings/desk-pdf.marks.json';
import coiMarks from '../../public/recordings/desk-coi.marks.json';
import officersMarks from '../../public/recordings/desk-officers.marks.json';
import authorityMarks from '../../public/recordings/desk-authority.marks.json';
import inspMarks from '../../public/recordings/desk-inspections.marks.json';
import plannerMarks from '../../public/recordings/desk-planner.marks.json';
import { FPS, clamp, colors, fonts } from '../theme';

// The 60 s, 16:9 demo on a laptop: the same six features, voice, captions and end card as
// `demo-60`, but the real app at desktop size (scripts/record-desktop.mjs, 1280×770 at 2×)
// on a big laptop screen, with a camera that zooms into each detail so it reads clearly.
// The incoming call and the own-company alert come in on a phone beside the laptop.
export const DEMO_LAPTOP_DURATION = 1800;

// ---------- the laptop ----------
const CSS = { w: 1280, h: 770 }; // the recordings, in CSS px
const SCREEN = { w: 1328, h: 830 };
const CHROME = 31;
const S0 = SCREEN.w / CSS.w; // recording px → screen px at zoom 1
const VIEW_H = SCREEN.h - CHROME;
const LID_W = SCREEN.w + 36;
const LAPTOP = { left: (1920 - LID_W) / 2, top: 170 };

const REC = {
  pdf: 'recordings/desk-pdf.mp4',
  coi: 'recordings/desk-coi.mp4',
  officers: 'recordings/desk-officers.mp4',
  authority: 'recordings/desk-authority.mp4',
  insp: 'recordings/desk-inspections.mp4',
  planner: 'recordings/desk-planner.mp4',
};
const PM = pdfMarks.marks;
const CM = coiMarks.marks;
const OM = officersMarks.marks;
const AM = authorityMarks.marks;
const IM = inspMarks.marks;
const LM = plannerMarks.marks;
const LAND = 0.72;

type Cut = { at: number; src: string; from: number; rate?: number; url: string };
const CUTS: Cut[] = [
  // 1 · PDF edit check: upload → "Likely tampered" → the page with its boxes → Version 3
  { at: 0, src: REC.pdf, from: 0.2, url: 'haulock.com/verify' },
  { at: 40, src: REC.pdf, from: PM.verdict.t + LAND, url: 'haulock.com/verify' },
  { at: W(1) - 2, src: REC.pdf, from: PM.preview.t + LAND, url: 'haulock.com/verify' },
  { at: W(2) - 2, src: REC.pdf, from: PM.v3.t + LAND, url: 'haulock.com/verify' },
  { at: 225, src: REC.pdf, from: PM.v3.t + LAND + 0.1, url: 'haulock.com/verify' },
  // 2 · COI check: the certificate drops in → "Doesn't match" → cancellation pending
  { at: 300, src: REC.coi, from: 0.2, rate: 0.1, url: 'haulock.com/verify' },
  { at: 392, src: REC.coi, from: CM.result.t - 0.43, url: 'haulock.com/verify' },
  { at: 520, src: REC.coi, from: CM.verdict.t + LAND + 0.35, url: 'haulock.com/verify' },
  // 3 · Officers: the phone rings while the broker is looked up → the verdict's call tip → Identity
  { at: 600, src: REC.officers, from: 0.2, rate: 0.05, url: 'haulock.com/dashboard' },
  { at: 610, src: REC.officers, from: OM.search.t - 0.1, url: 'haulock.com/report' },
  { at: W(10) - 2, src: REC.officers, from: OM.identity.t + LAND, url: 'haulock.com/report' },
  { at: 860, src: REC.officers, from: OM.identity.t + LAND + 0.2, url: 'haulock.com/report' },
  // 4 · Authority: 12y 4m · reactivated → the open flag → +30 in the verdict
  { at: 900, src: REC.authority, from: AM.identity.t + LAND, url: 'haulock.com/report' },
  { at: W(12) - 2, src: REC.authority, from: AM.flagTap.t + 0.63, url: 'haulock.com/report' },
  { at: 1050, src: REC.authority, from: AM.flagTap.t + 0.73, url: 'haulock.com/report' },
  { at: W(14) - 2, src: REC.authority, from: AM.shown.t + 1.0, url: 'haulock.com/report' },
  // 5 · Inspections: every inspection and crash → open the latest (then the alert on the phone)
  { at: 1200, src: REC.insp, from: LAND + 0.03, url: 'haulock.com/report' },
  { at: 1380, src: REC.insp, from: IM.end.t - 0.4, rate: 0.05, url: 'haulock.com/report' },
  // 6 · Load planner: typing the delivery → the truck route → what's left
  { at: 1500, src: REC.planner, from: LM.delivery.t - 0.8, url: 'haulock.com/planner' },
  { at: W(18) - 2, src: REC.planner, from: LM.planned.t + 1.5, url: 'haulock.com/planner' },
  { at: W(20) - 2, src: REC.planner, from: LM.profit.t + LAND, url: 'haulock.com/planner' },
];

// Camera keys: look at (cx, cy) in recording CSS px at zoom z; each move eases over 16 frames.
type Cam = { at: number; cx: number; cy: number; z: number };
const CAMS: Cam[] = [
  { at: 0, cx: 700, cy: 560, z: 1.3 },
  { at: 40, cx: 768, cy: 265, z: 1.45 },
  { at: W(1) - 2, cx: 700, cy: 410, z: 1.15 },
  { at: W(2) - 2, cx: 780, cy: 280, z: 1.5 },
  { at: 300, cx: 700, cy: 520, z: 1.35 },
  { at: 452, cx: 768, cy: 300, z: 1.3 },
  { at: W(6) - 4, cx: 770, cy: 270, z: 1.45 },
  { at: 600, cx: 640, cy: 385, z: 1.0 },
  { at: 612, cx: 520, cy: 226, z: 1.7 },
  { at: 706, cx: 839, cy: 400, z: 1.45 },
  { at: W(10) - 2, cx: 520, cy: 440, z: 1.55 },
  { at: 900, cx: 520, cy: 470, z: 1.55 },
  { at: W(12) - 2, cx: 770, cy: 505, z: 1.45 },
  { at: W(14) - 2, cx: 760, cy: 460, z: 1.25 },
  { at: 1200, cx: 700, cy: 380, z: 1.2 },
  { at: 1258, cx: 720, cy: 530, z: 1.6 },
  { at: 1500, cx: 420, cy: 500, z: 1.55 },
  { at: W(18) - 2, cx: 880, cy: 500, z: 1.6 },
  { at: W(20) - 2, cx: 904, cy: 260, z: 1.7 },
];
const MOVE = 16;
const camAt = (frame: number) => {
  let i = 0;
  while (i + 1 < CAMS.length && frame >= CAMS[i + 1].at) i++;
  const cur = CAMS[i];
  const prev = CAMS[Math.max(0, i - 1)];
  const p = i === 0 ? 1 : interpolate(frame, [cur.at, cur.at + MOVE], [0, 1], { ...clamp, easing: (v) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2) });
  const z = prev.z + (cur.z - prev.z) * p;
  const w = CSS.w / z;
  const h = CSS.h / z;
  const cx = Math.min(CSS.w - w / 2, Math.max(w / 2, prev.cx + (cur.cx - prev.cx) * p));
  const cy = Math.min(CSS.h - h / 2, Math.max(h / 2, prev.cy + (cur.cy - prev.cy) * p));
  return { x0: cx - w / 2, y0: cy - h / 2, z };
};

type RingSpec = { from: number; until: number; x: number; y: number; w: number; h: number; color: string };
const RINGS: RingSpec[] = [
  { from: W(2), until: W(3) - 2, x: 362, y: 258, w: 404, h: 64, color: colors.red },
  { from: W(3), until: 296, x: 776, y: 258, w: 428, h: 64, color: colors.green },
  { from: W(6), until: 596, x: 334, y: 248, w: 874, h: 124, color: colors.red },
  { from: W(9), until: W(10) - 2, x: 712, y: 456, w: 496, h: 94, color: colors.greenGlow },
  { from: W(10) + 2, until: 896, x: 322, y: 430, w: 410, h: 52, color: colors.orange },
  { from: 914, until: W(12) - 2, x: 322, y: 562, w: 430, h: 58, color: colors.amber },
  { from: W(12) + 4, until: W(13) - 2, x: 912, y: 618, w: 286, h: 66, color: colors.red },
  { from: W(13), until: W(14) - 2, x: 624, y: 618, w: 286, h: 66, color: colors.orange },
  { from: W(14) + 2, until: 1196, x: 722, y: 632, w: 260, h: 28, color: colors.red },
  { from: 1292, until: 1340, x: 330, y: 486, w: 880, h: 64, color: colors.amber },
];
// Mouse clicks, in recording CSS px.
const CLICKS = [
  { at: 610 + Math.round(0.1 * FPS), x: 500, y: 34 }, // the header search
  { at: 1200 + Math.round((IM.tap.t - LAND - 0.03) * FPS), x: IM.tap.rect!.x + IM.tap.rect!.w / 2, y: IM.tap.rect!.y + IM.tap.rect!.h / 2 }, // the latest inspection
  { at: 1500 + Math.round(0.8 * FPS), x: 496, y: 547 }, // the delivery field
];

const CutView: React.FC<{ c: Cut }> = ({ c }) => (
  <OffthreadVideo
    src={staticFile(c.src)}
    trimBefore={Math.round(c.from * FPS)}
    playbackRate={c.rate ?? 1}
    muted
    style={{ position: 'absolute', left: 0, top: 0, width: SCREEN.w, height: VIEW_H, maxWidth: 'none' }}
  />
);

const Cursor: React.FC<{ x: number; y: number; at: number }> = ({ x, y, at }) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < -16 || t > 16) return null;
  const move = interpolate(t, [-16, -2], [0, 1], { ...clamp, easing: (v) => 1 - Math.pow(1 - v, 3) });
  const px = x + (1 - move) * 90;
  const py = y + (1 - move) * 60;
  const ring = interpolate(t, [0, 14], [0, 1], clamp);
  return (
    <>
      {t >= 0 ? <div style={{ position: 'absolute', left: x - 30, top: y - 30, width: 60, height: 60, borderRadius: 30, border: `4px solid ${colors.orange}`, opacity: 1 - ring, transform: `scale(${0.4 + ring})` }} /> : null}
      <svg width="30" height="30" viewBox="0 0 24 24" style={{ position: 'absolute', left: px - 4, top: py - 2, opacity: interpolate(t, [-16, -12, 10, 16], [0, 1, 1, 0], clamp), transform: `scale(${t >= 0 && t < 4 ? 0.88 : 1})` }}>
        <path d="M4 2l15 11-6.5 1.3L16 21l-3 1.4-3.6-6.8L4 19z" fill="#0B1E3F" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </>
  );
};

const Screen: React.FC = () => {
  const frame = useCurrentFrame();
  const cam = camAt(frame);
  const cut = [...CUTS].reverse().find((c) => frame >= c.at) ?? CUTS[0];
  return (
    <AbsoluteFill style={{ backgroundColor: '#F5F3EE' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: CHROME, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 14, backgroundColor: '#e9e7e1', borderBottom: '1px solid rgba(11,30,63,0.12)' }}>
        <span style={{ display: 'flex', gap: 7 }}>
          {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
            <span key={c} style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: c }} />
          ))}
        </span>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <div style={{ minWidth: 360, padding: '3px 18px', borderRadius: 8, backgroundColor: '#fff', fontFamily: fonts.sans, fontSize: 14, color: 'rgba(11,30,63,0.75)', textAlign: 'center' }}>🔒 {cut.url}</div>
        </div>
        <span style={{ width: 60 }} />
      </div>
      <div style={{ position: 'absolute', left: 0, top: CHROME, width: SCREEN.w, height: VIEW_H, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: SCREEN.w, height: VIEW_H, transformOrigin: '0 0', transform: `translate(${-cam.x0 * S0 * cam.z}px, ${-cam.y0 * S0 * cam.z}px) scale(${cam.z})` }}>
          {CUTS.map((c, i) => {
            const next = CUTS[i + 1];
            return (
              <Sequence key={i} from={c.at} durationInFrames={(next ? next.at : END + 6) - c.at}>
                <CutView c={c} />
              </Sequence>
            );
          })}
          {RINGS.map((r, i) => (
            <Sequence key={`r${i}`} from={r.from} durationInFrames={r.until - r.from}>
              <Ring x={r.x * S0} y={r.y * S0} w={r.w * S0} h={r.h * S0} color={r.color} out={r.until - r.from} />
            </Sequence>
          ))}
          {CLICKS.map((c, i) => (
            <Cursor key={i} at={c.at} x={c.x * S0} y={c.y * S0} />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// "This COI says $1M": the certificate, before it's dropped on the check.
const CertCard: React.FC<{ dropAt: number }> = ({ dropAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 15, stiffness: 170 } });
  const drop = interpolate(frame, [dropAt - 10, dropAt], [0, 1], { ...clamp, easing: (v) => v * v });
  return (
    <div
      style={{
        position: 'absolute',
        left: 1180,
        top: 330,
        width: 560,
        padding: '30px 34px 34px',
        borderRadius: 20,
        backgroundColor: '#fff',
        color: colors.navy,
        boxShadow: '0 40px 100px rgba(0,0,0,0.55)',
        opacity: Math.min(1, pop * 1.5) * (1 - drop),
        transform: `translate(${-drop * 320}px, ${drop * 260 + (1 - pop) * 60}px) scale(${1 - 0.5 * drop}) rotate(${3 - 3 * pop}deg)`,
        fontFamily: fonts.sans,
      }}
    >
      <div style={{ fontFamily: fonts.mono, fontWeight: 600, fontSize: 18, letterSpacing: 3, color: 'rgba(11,30,63,0.55)' }}>CERTIFICATE OF LIABILITY INSURANCE · ACORD 25</div>
      <div style={{ marginTop: 14, fontSize: 30, fontWeight: 600 }}>Kestrelon Freight Group LLC</div>
      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', fontSize: 22, color: 'rgba(11,30,63,0.75)' }}>
        <span>Automobile liability</span>
        <span style={{ fontWeight: 600, color: colors.navy }}>$1,000,000</span>
      </div>
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 20, color: 'rgba(11,30,63,0.6)' }}>
        <span>Policy GP-4471209</span>
        <span>Mar 1, 2026 – Mar 1, 2027</span>
      </div>
      <div style={{ marginTop: 18, fontFamily: fonts.mono, fontSize: 16, color: 'rgba(11,30,63,0.45)' }}>coi-kestrelon-freight.pdf</div>
    </div>
  );
};

// A phone beside the laptop: the incoming call, then the own-company alert.
const SidePhone: React.FC<{ from: number; until: number; children: React.ReactNode }> = ({ from, until, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - from, fps, config: { damping: 16, stiffness: 140 } });
  const exit = interpolate(frame, [until - 12, until], [0, 1], { ...clamp, easing: (v) => v * v });
  const k = 0.62;
  return (
    <div style={{ position: 'absolute', left: 1500, top: 300, width: 1080, height: 1920, transformOrigin: '0 0', transform: `translate(${(1 - enter) * 500 + exit * 520}px, 0) scale(${k}) rotate(${(1 - enter) * 8}deg)` }}>
      <Phone left={0} top={0} screen={{ w: PHONE_SCREEN.w, h: PHONE_SCREEN.h }} statusBar={PHONE_SCREEN.status}>
        {children}
      </Phone>
    </div>
  );
};

// ---------- the top band: feature, caption, progress ----------
const Header: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const b = blockOf(frame);
  const f = FEATURES[b];
  const pop = spring({ frame: frame - BLOCKS[b], fps, config: { damping: 15, stiffness: 190 } });
  return (
    <>
      <div style={{ position: 'absolute', left: 70, top: 34, display: 'flex', alignItems: 'center', gap: 16, opacity: Math.min(1, pop * 1.5), transform: `translateX(${(1 - pop) * -30}px)` }}>
        <span style={{ fontFamily: fonts.mono, fontWeight: 700, fontSize: 30, color: colors.orange }}>{String(b + 1).padStart(2, '0')}</span>
        <span style={{ fontFamily: fonts.mono, fontSize: 18, color: colors.dim }}>/ 06</span>
        <span style={{ fontFamily: fonts.mono, fontWeight: 600, fontSize: 22, letterSpacing: 4, color: colors.cream }}>{f.name}</span>
        <span style={{ padding: '5px 12px', borderRadius: 999, fontFamily: fonts.mono, fontWeight: 600, fontSize: 14, letterSpacing: 2, color: f.paid ? colors.orange : colors.greenGlow, border: `2px solid ${f.paid ? 'rgba(255,107,53,0.5)' : 'rgba(74,222,128,0.4)'}` }}>{f.tag}</span>
      </div>
      <div style={{ position: 'absolute', right: 70, top: 40, display: 'flex', gap: 10 }}>
        {FEATURES.map((ft, i) => {
          const fill = i < b ? 1 : i > b ? 0 : interpolate(frame, [BLOCKS[i], BLOCKS[i + 1] ?? END], [0, 1], clamp);
          return (
            <div key={ft.short} style={{ width: 104 }}>
              <div style={{ fontFamily: fonts.mono, fontWeight: 600, fontSize: 11, letterSpacing: 1, color: i === b ? colors.cream : 'rgba(245,243,238,0.4)', whiteSpace: 'nowrap', overflow: 'hidden' }}>{ft.short}</div>
              <div style={{ marginTop: 6, height: 4, borderRadius: 2, backgroundColor: 'rgba(245,243,238,0.14)', overflow: 'hidden' }}>
                <div style={{ width: `${fill * 100}%`, height: '100%', backgroundColor: colors.orange }} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

const Caption: React.FC = () => {
  const frame = useCurrentFrame();
  const chunk = CHUNKS.find((c) => frame >= W(c.lines[0][0].at) - 3 && frame < c.until);
  if (!chunk) return null;
  return (
    <div style={{ position: 'absolute', left: 60, right: 60, top: 78, display: 'flex', justifyContent: 'center', alignItems: 'baseline', columnGap: 18, whiteSpace: 'nowrap' }}>
      {chunk.lines.flat().map((tok, i) => {
        const at = W(tok.at) - 2;
        if (frame < at) return null;
        const p = interpolate(frame, [at, at + 7], [0, 1], { ...clamp, easing: (x) => 1 - Math.pow(1 - x, 3) });
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              opacity: p,
              transform: `translateY(${(1 - p) * 24}px)`,
              filter: `blur(${(1 - p) * 8}px)`,
              color: tok.color ?? colors.cream,
              textShadow: '0 6px 30px rgba(0,0,0,0.55)',
              lineHeight: 1,
              fontFamily: tok.serif ? fonts.serif : fonts.sans,
              fontStyle: tok.serif ? 'italic' : undefined,
              fontSize: tok.serif ? 70 : 54,
              letterSpacing: tok.serif ? -1 : -2,
            }}
          >
            {tok.text}
          </span>
        );
      })}
    </div>
  );
};

const LaptopRig: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 18, stiffness: 110 } });
  const exit = interpolate(frame, [END - 8, END + 4], [0, 1], clamp);
  const swap = BLOCKS.slice(1).reduce((s, b) => s + interpolate(frame, [b - 2, b + 2, b + 10], [0, 1, 0], clamp), 0);
  return (
    <AbsoluteFill style={{ opacity: Math.min(1, enter * 1.4) * (1 - exit), transform: `translateY(${(1 - enter) * 120}px) scale(${1 - 0.015 * swap})`, transformOrigin: '50% 60%' }}>
      <Laptop left={LAPTOP.left} top={LAPTOP.top} screen={SCREEN}>
        <Screen />
        {swap > 0.05 ? <AbsoluteFill style={{ backgroundColor: `rgba(4,11,26,${0.75 * swap})` }} /> : null}
      </Laptop>
    </AbsoluteFill>
  );
};

export const DemoLaptop: React.FC = () => {
  const frame = useCurrentFrame();
  const jolt = STAMPS.reduce((s, st) => s + shake(frame, st.from, 6), 0);
  return (
    <AbsoluteFill style={{ backgroundColor: colors.void, fontFamily: fonts.sans }}>
      <AbsoluteFill style={{ transform: `translate(${jolt}px, ${jolt * 0.5}px)` }}>
        <WideBackground />
        <Scanlines opacity={0.4} />
        <Sequence durationInFrames={END}>
          <LaptopRig />
          <Sequence from={312} durationInFrames={398 - 312}>
            <CertCard dropAt={398 - 312 - 2} />
          </Sequence>
          <Sequence durationInFrames={HANG + 30}>
            <SidePhone from={598} until={HANG + 30}>
              <Sequence from={598} durationInFrames={HANG + 30 - 598}>
                <CallScreen hangAt={HANG - 598} fadeOut={false} />
              </Sequence>
            </SidePhone>
          </Sequence>
          <Sequence from={1296} durationInFrames={1500 - 1296}>
            <AlertPhone />
          </Sequence>
          <Header />
          <Caption />
          {STAMPS.map((s, i) => (
            <Sequence key={i} from={s.from} durationInFrames={s.until - s.from}>
              {/* Bottom right, or bottom left while the phone is beside the laptop. */}
              <div style={{ position: 'absolute', left: s.from > 1200 && s.from < 1500 ? 60 : 980, top: 0, width: 900, height: 1080, transform: 'scale(0.8)', transformOrigin: '60% 85%' }}>
                <Stamp big={s.big} small={s.small} color={s.color} top={800} exitAt={s.until - s.from - 6} />
              </div>
            </Sequence>
          ))}
        </Sequence>
      </AbsoluteFill>
      <Sequence from={END}>
        <WideEnd />
      </Sequence>

      {BLOCKS.slice(1).map((b) => (
        <React.Fragment key={b}>
          <WideGlitch at={b - 1} />
          <Flash at={b} strength={0.1} />
        </React.Fragment>
      ))}
      <WideGlitch at={END - 2} dur={8} />

      <VoTrack vo={VO} />
      <Html5Audio
        src={staticFile('music/driving-ambition.mp3')}
        volume={(f) =>
          interpolate(f, [0, 4], [0, 1], clamp) *
          interpolate(f, [0, 1000, 1140, VO.end, VO.end + 12], [0.19, 0.19, 0.13, 0.13, 0.4], clamp) *
          interpolate(f, [DEMO_LAPTOP_DURATION - 24, DEMO_LAPTOP_DURATION - 1], [1, 0], clamp)
        }
      />
      {BLOCKS.slice(1).map((b) => (
        <Sfx key={b} src="sfx/glitch-a.mp3" at={b - 1} volume={0.24} />
      ))}
      {STAMPS.map((s, i) => (
        <Sfx key={`s${i}`} src="sfx/impact.mp3" at={s.from - 1} volume={0.18} />
      ))}
      {CLICKS.map((c, i) => (
        <Sfx key={`c${i}`} src="sfx/beep.mp3" at={c.at} volume={0.16} />
      ))}
      <Sfx src="sfx/scan.mp3" at={20} volume={0.28} />
      <Sfx src="sfx/scan.mp3" at={400} volume={0.28} />
      <Sfx src="sfx/beep.mp3" at={HANG - 3} volume={0.2} />
      <Sfx src="sfx/beep.mp3" at={W(16) + 6} volume={0.3} />
      <Sfx src="sfx/glitch-b.mp3" at={END - 2} volume={0.3} />
      <Sfx src="sfx/impact.mp3" at={W(22) - 1} volume={0.18} />
    </AbsoluteFill>
  );
};

// A plain lock screen under the notification.
const LockScreen: React.FC = () => (
  <AbsoluteFill style={{ background: 'linear-gradient(180deg, #1e2a3f 0%, #0b1220 75%)', color: '#fff', fontFamily: fonts.sans, textAlign: 'center' }}>
    <div style={{ marginTop: 150, fontSize: 26, color: 'rgba(255,255,255,0.75)' }}>Thursday, October 15</div>
    <div style={{ fontSize: 150, fontWeight: 500, letterSpacing: -4, lineHeight: 1 }}>9:41</div>
  </AbsoluteFill>
);

// The alert phone: in from the side as the notification drops, then the email.
const AlertPhone: React.FC = () => {
  const start = 1296;
  return (
    <SidePhone from={0} until={1500 - start}>
      <LockScreen />
      <Sequence from={W(16) + 6 - start}>
        <Alert openAt={MAIL - W(16) - 6} scroll={[MAIL + 30 - W(16) - 6, 1492 - W(16) - 6]} />
      </Sequence>
    </SidePhone>
  );
};
