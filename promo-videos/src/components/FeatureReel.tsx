import React from 'react';
import { AbsoluteFill, Html5Audio, Sequence, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { FPS, clamp, colors, fonts } from '../theme';
import { makeVo, type Vo } from '../vo';
import { Sfx, VoTrack } from './audio';
import { Background } from './Background';
import { Captions, type CaptionChunk } from './Captions';
import { EndCard, type EndCardProps } from './EndCard';
import { FootageLayer } from './FootageLayer';
import { Flash, GlitchBars, HudFrame, Scanlines, glitchAt, rgbSplit, shake } from './fx';
import type { FootageName } from '../footage';

// The feature reels (load planner, COI check, …): a hook over footage, the app on a phone,
// voice-synced captions and the cream end card. Each spot supplies its scenes and timing.

// A take cut into phrases at its measured pauses. Each phrase is one "word" for timing:
// captions and cuts hang off phrase starts (vo.at(i) = phrase i).
export const phraseVo = (src: string, phrases: { text: string; speech: [number, number]; gap: number }[], takeEnd: number): Vo =>
  makeVo(
    src,
    phrases.map((p) => ({ text: p.text, start: p.speech[0], end: p.speech[1] })),
    phrases.map(({ speech, gap }) => ({ speech, gap })),
    takeEnd
  );

export type Hit = { at: number; color?: string; flash?: number; glitch?: number; shake?: number };
export type Scene = { from: number; until: number; node: React.ReactNode; exitOut?: boolean };

export type FeatureReelProps = {
  vo: Vo;
  duration: number;
  captions: CaptionChunk[];
  hudTop: string;
  hook: { until: number; node: React.ReactNode };
  scenes: Scene[];
  end: { at: number; urlAt: number } & Omit<EndCardProps, 'vo' | 'from' | 'urlAt'>;
  music: { src: string; startAt?: number; bed: [number[], number[]]; swell?: number };
  sfx: { src: string; at: number; volume: number }[];
  hits: Hit[];
};

export const FeatureReel: React.FC<FeatureReelProps> = ({ vo, duration, captions, hudTop, hook, scenes, end, music, sfx, hits }) => {
  const frame = useCurrentFrame();
  const jolt = hits.reduce((s, h) => s + (h.shake ? shake(frame, h.at, h.shake) : 0), 0);
  return (
    <AbsoluteFill style={{ backgroundColor: colors.void, fontFamily: fonts.sans }}>
      <AbsoluteFill style={{ transform: `translate(${jolt}px, ${jolt * 0.6}px)` }}>
        <Background />
        <Scanlines opacity={0.7} />
        <Sequence durationInFrames={end.at}>
          <HudFrame topLeft={hudTop} bottomLeft="" bottomRight="" />
        </Sequence>
        <Sequence durationInFrames={hook.until + 8}>{hook.node}</Sequence>
        {scenes.map((s, i) => (
          <Sequence key={i} from={s.from} durationInFrames={s.until - s.from + (s.exitOut ? 12 : 0)}>
            {s.exitOut ? <ScreenOut at={s.until - s.from}>{s.node}</ScreenOut> : s.node}
          </Sequence>
        ))}
        <Captions vo={vo} chunks={captions} />
      </AbsoluteFill>

      <Sequence from={end.at}>
        <EndCard vo={vo} from={end.at} urlAt={end.urlAt - end.at} chip={end.chip} headline={end.headline} checks={end.checks} hud={end.hud} />
      </Sequence>

      {hits.map((h, i) => (
        <React.Fragment key={i}>
          {h.glitch ? <GlitchBars at={h.at} dur={h.glitch} /> : null}
          {h.flash ? <Flash at={h.at} color={h.color} strength={h.flash} /> : null}
        </React.Fragment>
      ))}
      <GlitchBars at={end.at - 2} dur={8} />

      <VoTrack vo={vo} />
      <Html5Audio
        src={staticFile(music.src)}
        trimBefore={Math.round((music.startAt ?? 0) * FPS)}
        volume={(f) =>
          interpolate(f, [0, 4], [0, 1], clamp) *
          interpolate(f, [...music.bed[0], vo.end, vo.end + 12], [...music.bed[1], music.bed[1][music.bed[1].length - 1], music.swell ?? 0.7], clamp) *
          interpolate(f, [duration - 24, duration - 1], [1, 0], clamp)
        }
      />
      {sfx.map((s, i) => (
        <Sfx key={i} src={s.src} at={s.at} volume={s.volume} />
      ))}
      <Sfx src="sfx/glitch-b.mp3" at={end.at - 2} volume={0.32} />
      <Sfx src="sfx/impact.mp3" at={end.urlAt - 1} volume={0.18} />
    </AbsoluteFill>
  );
};

// A scene that drops back (scale, blur, fade) over 10 frames at `at`.
export const ScreenOut: React.FC<{ at: number; children: React.ReactNode }> = ({ at, children }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + 10], [0, 1], { ...clamp, easing: (v) => v * v });
  return <AbsoluteFill style={{ opacity: 1 - p, transform: `scale(${1 - 0.12 * p})`, filter: `blur(${p * 8}px)` }}>{children}</AbsoluteFill>;
};

// Hook: footage under a glass card (a mono label, a big line, smaller lines) and a stamp
// that slams in on `stampAt`. `swap` replaces the big line on `swapAt`, with a glitch.
export const HookCard: React.FC<{
  clip: FootageName;
  exitAt: number;
  label: string;
  title: string;
  lines: string[];
  stamp?: { text: string; at: number; color: string };
  swap?: { at: number; title: string; lines: string[]; color: string };
}> = ({ clip, exitAt, label, title, lines, stamp, swap }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - 4, fps, config: { damping: 15, stiffness: 170 } });
  const exit = interpolate(frame, [exitAt - 4, exitAt + 6], [1, 0], clamp);
  const swapped = swap && frame >= swap.at;
  const g = swap ? glitchAt(frame, swap.at, 12) : 0;
  const st = stamp ? spring({ frame: frame - stamp.at, fps, config: { damping: 11, stiffness: 240 } }) : 0;
  const shown = swapped ? swap! : { title, lines, color: colors.cream };
  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <FootageLayer segments={[{ from: 0, to: exitAt + 8, clip, dim: 0.55 }]} />
      <div
        style={{
          position: 'absolute',
          left: 110,
          right: 110,
          top: 760,
          padding: '44px 50px 50px',
          borderRadius: 32,
          backgroundColor: 'rgba(6,16,38,0.78)',
          border: `2px solid ${swapped ? 'rgba(248,113,113,0.6)' : 'rgba(245,243,238,0.22)'}`,
          boxShadow: swapped ? '0 0 60px rgba(220,38,38,0.4)' : '0 30px 80px rgba(0,0,0,0.5)',
          opacity: Math.min(1, pop * 1.4),
          transform: `translateY(${(1 - pop) * 60}px) translateX(${g ? (random(`hk${frame}`) - 0.5) * 50 * g : 0}px)`,
        }}
      >
        <div style={{ fontFamily: fonts.mono, fontSize: 26, letterSpacing: 4, color: colors.dim }}>{label}</div>
        <div style={{ marginTop: 16, fontFamily: fonts.sans, fontWeight: 600, fontSize: shown.title.length > 16 ? 84 : 110, letterSpacing: -4, lineHeight: 1.02, color: shown.color, textShadow: rgbSplit(g * 10) }}>{shown.title}</div>
        {shown.lines.map((l) => (
          <div key={l} style={{ marginTop: 14, fontFamily: fonts.sans, fontSize: 38, color: 'rgba(245,243,238,0.8)' }}>
            {l}
          </div>
        ))}
      </div>
      {stamp && frame >= stamp.at && !swapped ? (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 690, display: 'flex', justifyContent: 'flex-end', paddingRight: 80 }}>
          <div
            style={{
              padding: '12px 30px',
              borderRadius: 18,
              border: `5px solid ${stamp.color}`,
              color: stamp.color,
              fontFamily: fonts.mono,
              fontWeight: 700,
              fontSize: 44,
              letterSpacing: 4,
              backgroundColor: 'rgba(4,11,26,0.75)',
              transform: `rotate(-6deg) scale(${interpolate(st, [0, 1], [1.8, 1])})`,
              opacity: Math.min(1, st * 1.5),
            }}
          >
            {stamp.text}
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

// Reel length: the end card holds ~3.5 s, and at least 1.7 s past the last word.
export const reelDuration = (endAt: number, vo: Vo) => Math.round(Math.max(endAt + 105, vo.end + 50));

// A big stamp over the screen (e.g. "−$300", "$1,194 LEFT").
export const Stamp: React.FC<{ big: string; small: string[]; color: string; top: number; exitAt?: number }> = ({ big, small, color, top, exitAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 11, stiffness: 240 } });
  const out = exitAt != null ? interpolate(frame, [exitAt, exitAt + 6], [0, 1], clamp) : 0;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top, display: 'flex', justifyContent: 'center', opacity: Math.min(1, pop * 1.4) * (1 - out) }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 28,
          padding: '16px 40px 20px',
          borderRadius: 26,
          backgroundColor: color,
          color: '#fff',
          boxShadow: `0 30px 80px ${color}88, 0 0 0 6px rgba(255,255,255,0.9)`,
          transform: `rotate(-5deg) scale(${interpolate(pop, [0, 1], [1.8, 1])})`,
        }}
      >
        <span style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: big.length > 10 ? 80 : big.length > 7 ? 104 : 140, letterSpacing: -4, lineHeight: 1, whiteSpace: 'nowrap' }}>{big}</span>
        <span style={{ fontFamily: fonts.mono, fontWeight: 600, fontSize: 26, letterSpacing: 3, lineHeight: 1.35 }}>
          {small.map((s, i) => (
            <React.Fragment key={s}>
              {i ? <br /> : null}
              {s}
            </React.Fragment>
          ))}
        </span>
      </div>
    </div>
  );
};
