import React from 'react';
import { AbsoluteFill, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { FPS, clamp, colors, fonts } from '../theme';
import { Phone } from './Devices';

// A phone-browser window playing screen recordings of the real app
// (public/recordings, made by scripts/record-screens.mjs), cut to the voice.
export const SCREEN = { left: 90, top: 584, size: 900, bar: 64 };

// Where the window looks: the recording's point (cx, cy) in CSS px sits at the window's
// centre, magnified to k window px per CSS px.
export type Camera = { cx: number; cy: number; k: number };
export type Recording = { src: string; css: number; scale: number }; // square, `css` pt wide at `scale`×

export type ScreenCut = {
  at: number; // frame in the parent Sequence where this cut starts
  rec: Recording;
  from: number; // second of the recording it starts at
  camera: (f: number) => Camera; // f = frames since the cut started
  punch?: boolean; // a hard cut on a word: small scale punch
  fade?: number; // crossfade in over this many frames
};

export const fit = (rec: Recording): Camera => ({ cx: rec.css / 2, cy: rec.css / 2, k: SCREEN.size / rec.css });

// Window coordinates (px, relative to the window's top-left) of a recording point.
export const toWindow = (cam: Camera, x: number, y: number) => ({
  x: SCREEN.size / 2 + (x - cam.cx) * cam.k,
  y: SCREEN.bar + SCREEN.size / 2 + (y - cam.cy) * cam.k,
});

export const AppScreen: React.FC<{ cuts: ScreenCut[]; until: number; url: string; taps: { at: number; x: number; y: number }[] }> = ({ cuts, until, url, taps }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16, stiffness: 150 } });
  return (
    <div
      style={{
        position: 'absolute',
        left: SCREEN.left,
        top: SCREEN.top,
        width: SCREEN.size,
        height: SCREEN.size + SCREEN.bar,
        borderRadius: 40,
        overflow: 'hidden',
        backgroundColor: colors.cream,
        opacity: Math.min(1, enter * 1.6),
        transform: `translateY(${(1 - enter) * 90}px) scale(${0.88 + 0.12 * enter})`,
        boxShadow: '0 40px 120px rgba(0,0,0,0.65), 0 0 0 2px rgba(245,243,238,0.2), 0 0 90px rgba(255,107,53,0.28)',
      }}
    >
      <div style={{ position: 'absolute', left: 0, right: 0, top: SCREEN.bar, height: SCREEN.size, overflow: 'hidden' }}>
        {cuts.map((c, i) => {
          const next = cuts[i + 1];
          const end = next ? next.at + (next.fade ?? 0) : until;
          return (
            <Sequence key={i} from={c.at} durationInFrames={end - c.at}>
              <Cut cut={c} />
            </Sequence>
          );
        })}
      </div>
      <UrlBar url={url} />
      {taps.map((t, i) => (
        <Tap key={i} {...t} />
      ))}
    </div>
  );
};

const Cut: React.FC<{ cut: ScreenCut }> = ({ cut }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cam = cut.camera(frame);
  const size = cut.rec.css * cam.k;
  const punch = cut.punch ? 1 + 0.05 * (1 - spring({ frame, fps, config: { damping: 14, stiffness: 220 } })) : 1;
  const opacity = cut.fade ? interpolate(frame, [0, cut.fade], [0, 1], clamp) : 1;
  return (
    <AbsoluteFill style={{ opacity, transform: `scale(${punch})` }}>
      <OffthreadVideo
        src={staticFile(cut.rec.src)}
        trimBefore={Math.round(cut.from * FPS)}
        muted
        style={{ position: 'absolute', width: size, height: size, left: SCREEN.size / 2 - cam.cx * cam.k, top: SCREEN.size / 2 - cam.cy * cam.k, maxWidth: 'none' }}
      />
    </AbsoluteFill>
  );
};

const UrlBar: React.FC<{ url: string }> = ({ url }) => (
  <div
    style={{
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      height: SCREEN.bar,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#fff',
      borderBottom: '2px solid rgba(11,30,63,0.08)',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 26px', borderRadius: 999, backgroundColor: 'rgba(11,30,63,0.05)', fontFamily: fonts.sans, fontSize: 26, color: 'rgba(11,30,63,0.7)' }}>
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="rgba(11,30,63,0.6)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <rect x={4} y={11} width={16} height={10} rx={2} />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      {url}
    </div>
  </div>
);

// A finger tap: a dot that presses in, then a ring that spreads out.
export const Tap: React.FC<{ at: number; x: number; y: number }> = ({ at, x, y }) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < -8 || t > 22) return null;
  const dot = interpolate(t, [-8, -2, 0, 10, 18], [0, 0.9, 1, 0.8, 0], clamp);
  const press = interpolate(t, [-8, -1, 3], [1.3, 1, 0.82], clamp);
  const ring = interpolate(t, [0, 18], [0, 1], { ...clamp, easing: (v) => 1 - Math.pow(1 - v, 3) });
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: x - 34,
          top: y - 34,
          width: 68,
          height: 68,
          borderRadius: 34,
          backgroundColor: 'rgba(11,30,63,0.28)',
          border: '3px solid rgba(255,255,255,0.9)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
          opacity: dot,
          transform: `scale(${press})`,
        }}
      />
      {t >= 0 ? (
        <div
          style={{
            position: 'absolute',
            left: x - 90 * ring,
            top: y - 90 * ring,
            width: 180 * ring,
            height: 180 * ring,
            borderRadius: '50%',
            border: `4px solid ${colors.orange}`,
            opacity: 1 - ring,
          }}
        />
      ) : null}
    </>
  );
};

// The same cut list on a phone mockup, for a full-height phone recording (`css` pt wide,
// `cssH` tall). Taps are in recording pt. Each cut plays the recording from `from` seconds,
// shifted up `y` pt (the phone's bottom runs off the frame, so low content needs lifting).
// Boxes ring a region of the screen (recording pt, as shown) from `from` to `until`.
export type PhoneCut = { at: number; from: number; punch?: boolean; y?: number };
export type PhoneBox = { from: number; until: number; x: number; y: number; w: number; h: number; color?: string };
export const PhoneRecording: React.FC<{
  src: string;
  css: { w: number; h: number };
  screenW: number;
  top: number;
  cuts: PhoneCut[];
  until: number;
  taps: { at: number; x: number; y: number }[];
  boxes?: PhoneBox[];
}> = ({ src, css, screenW, top, cuts, until, taps, boxes = [] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16, stiffness: 140 } });
  const k = screenW / css.w;
  const status = Math.round(52 * k);
  const screen = { w: screenW, h: Math.round(css.h * k) + status };
  return (
    <AbsoluteFill style={{ opacity: Math.min(1, enter * 1.5), transform: `translateY(${(1 - enter) * 160}px)` }}>
      <Phone left={(1080 - (screen.w + 32)) / 2} top={top} screen={screen} statusBar={status}>
        {cuts.map((c, i) => {
          const next = cuts[i + 1];
          return (
            <Sequence key={i} from={c.at} durationInFrames={(next ? next.at : until) - c.at}>
              <PhoneCutView src={src} from={c.from} punch={c.punch} w={css.w * k} h={css.h * k} y={(c.y ?? 0) * k} />
            </Sequence>
          );
        })}
        {boxes.map((b, i) => (
          <Sequence key={`b${i}`} from={b.from} durationInFrames={b.until - b.from}>
            <Ring x={b.x * k} y={b.y * k} w={b.w * k} h={b.h * k} color={b.color ?? colors.orange} out={b.until - b.from} />
          </Sequence>
        ))}
        {taps.map((t, i) => (
          <Tap key={i} at={t.at} x={t.x * k} y={t.y * k} />
        ))}
      </Phone>
    </AbsoluteFill>
  );
};

// A highlight ring that snaps around a region, glows, and fades out at `out`.
export const Ring: React.FC<{ x: number; y: number; w: number; h: number; color: string; out: number }> = ({ x, y, w, h, color, out }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 13, stiffness: 200 } });
  const fade = interpolate(frame, [out - 6, out], [1, 0], clamp);
  const pad = 10 + (1 - pop) * 26;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - pad,
        top: y - pad,
        width: w + pad * 2,
        height: h + pad * 2,
        borderRadius: 22,
        border: `6px solid ${color}`,
        boxShadow: `0 0 0 4000px rgba(4,11,26,${0.28 * pop * fade}), 0 0 36px ${color}`,
        opacity: Math.min(1, pop * 1.5) * fade,
      }}
    />
  );
};

const PhoneCutView: React.FC<{ src: string; from: number; punch?: boolean; w: number; h: number; y?: number }> = ({ src, from, punch, w, h, y = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = punch ? 1 + 0.04 * (1 - spring({ frame, fps, config: { damping: 14, stiffness: 220 } })) : 1;
  return (
    <AbsoluteFill style={{ transform: `scale(${scale})`, backgroundColor: colors.cream }}>
      <OffthreadVideo src={staticFile(src)} trimBefore={Math.round(from * FPS)} muted style={{ position: 'absolute', left: 0, top: -y, width: w, height: h, maxWidth: 'none' }} />
    </AbsoluteFill>
  );
};
