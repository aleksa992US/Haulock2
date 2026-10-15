import React from 'react';
import { AbsoluteFill, Html5Audio, Sequence, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { AlertPhone } from '../components/AlertPhone';
import { type PhoneCut, PhoneRecording } from '../components/AppScreen';
import { Sfx, VoTrack } from '../components/audio';
import { Background } from '../components/Background';
import { Captions, type CaptionChunk } from '../components/Captions';
import { EndCard } from '../components/EndCard';
import { FootageLayer } from '../components/FootageLayer';
import { Flash, GlitchBars, HudFrame, Scanlines, glitchAt, rgbSplit, shake } from '../components/fx';
import { makeVo } from '../vo';
import words from '../../public/voiceovers/inspections.words.json';
import recMarks from '../../public/recordings/inspections.marks.json';
import { clamp, colors, fonts } from '../theme';

// ~26.5 s reel: every roadside inspection and crash in a carrier report, and an email the
// moment FMCSA posts one on your own DOT. Screen recording of the homepage's example panel
// (scripts/record-inspections.mjs) and the app's real alert email; all example data.
export const INSPECTIONS_DURATION = 795;

// Take B of the ElevenLabs read (Desmond – Trailer & Ad Voice, eleven_v4), phrases measured
// from the take. Word indices: 0 Totals 1 only 2 tell 3 you 4 so 5 much. 6 Haulock 7 shows
// 8 EVERY 9 roadside 10 inspection… 11 and 12 every 13 crash, 14 from 15 the 16 last
// 17 twenty-four 18 months. 19 When, 20 where, 21 and 22 what 23 the 24 officer 25 found.
// 26 And 27 for 28 your 29 own 30 company 31 know 32 as 33 soon 34 as 35 FMCSA 36 posts 37 a
// 38 new 39 inspection 40 or 41 crash 42 on 43 your 44 DOT. 45 Fix 46 it… 47 or 48 challenge
// 49 it… 50 before 51 it 52 hits 53 your 54 safety 55 scores. 56 Check 57 any 58 carrier
// 59 free… 60 at 61 haulock.com.
const VO = makeVo(
  'voiceovers/inspections.mp3',
  words,
  [
    { speech: [0.03, 1.95], gap: 0.15 }, // Totals only tell you so much.
    { speech: [2.35, 3.3], gap: 0.25 }, // Haulock shows
    { speech: [3.45, 4.75], gap: 0.12 }, // EVERY roadside inspection…
    { speech: [4.95, 6.3], gap: 0.15 }, // and every crash,
    { speech: [6.47, 7.95], gap: 0.15 }, // from the last twenty-four months.
    { speech: [8.33, 10.8], gap: 0.3 }, // When, where, and what the officer found.
    { speech: [11.15, 12.15], gap: 0.5 }, // And for your own company —
    { speech: [12.43, 16.6], gap: 0.15 }, // know as soon as FMCSA posts a new inspection or crash on your DOT.
    { speech: [18.1, 18.45], gap: 0.9 }, // Fix it… (the notification sinks in)
    { speech: [18.75, 19.45], gap: 0.2 }, // or challenge it…
    { speech: [19.73, 21.3], gap: 0.2 }, // before it hits your safety scores.
    { speech: [21.65, 22.9], gap: 0.6 }, // Check any carrier free…
    { speech: [23.12, 24.25], gap: 0.15 }, // at haulock.com.
  ],
  24.48
);
const W = VO.at;

const MUCH = W(5);
const SCREEN_IN = W(6) - 6; // "Haulock shows…"
const ALERT = W(26) - 6; // "And for your own company"
const END = W(56) - 8; // "Check any carrier free…"
const URL = W(61);

// ---------- the recording, on a phone ----------
// A full phone screen (430×880 pt) recorded at 3×, shown on a phone mockup.
const REC = { src: 'recordings/inspections.mp4', css: { w: 430, h: 880 } };
const M = recMarks.marks;
const SCROLL = 0.7; // seconds each recorded scroll takes
const S = (frame: number) => frame - SCREEN_IN;
const LATEST_AT = S(W(19)) - 4;
const CUTS: PhoneCut[] = [
  { at: 0, from: M.panel.t + SCROLL }, // totals: 90 inspections · 63% clean · 8 OOS · 3 crashes
  { at: S(W(13)) - 6, from: M.crashes.t + SCROLL, punch: true }, // the crash
  { at: S(W(14)) - 2, from: M.chart.t + SCROLL, punch: true }, // month by month, 24 months
  { at: LATEST_AT, from: M.latest.t + SCROLL, punch: true }, // latest inspections → tap → violations
];
const TAP = (() => {
  const r = M.tap.rect!;
  return { at: LATEST_AT + Math.round((M.tap.t - (M.latest.t + SCROLL)) * 30), x: r.x + r.w * 0.55, y: r.y + r.h / 2 };
})();

const CAPTIONS: CaptionChunk[] = [
  { layout: 'top', until: W(6) - 3, glitchAt: MUCH, lines: [[{ text: 'Totals', at: 0 }, { text: 'only', at: 1 }], [{ text: 'tell you so much.', at: 2, accent: 'serif', color: colors.cream, size: 116 }]] },
  { layout: 'top', until: W(11) - 2, lines: [[{ text: 'Haulock', at: 6 }, { text: 'shows', at: 7 }], [{ text: 'every inspection', at: 8, accent: 'serif', color: colors.orange, size: 124 }]] },
  { layout: 'top', until: W(14) - 2, lines: [[{ text: 'and', at: 11 }, { text: 'every', at: 12 }], [{ text: 'crash.', at: 13, accent: 'serif', color: colors.redGlow }]] },
  { layout: 'top', until: W(19) - 3, lines: [[{ text: 'from', at: 14 }, { text: 'the', at: 15 }, { text: 'last', at: 16 }], [{ text: '24 months.', at: 17, accent: 'serif', color: colors.orange }]] },
  {
    layout: 'top',
    until: W(26) - 3,
    lines: [[{ text: 'When ·', at: 19 }, { text: 'where ·', at: 20 }], [{ text: 'what the officer found.', at: 22, accent: 'serif', color: colors.orange, size: 100 }]],
  },
  { layout: 'top', until: W(31) - 2, lines: [[{ text: 'And', at: 26 }, { text: 'for', at: 27 }], [{ text: 'your own company…', at: 28, accent: 'serif', color: colors.orange, size: 124 }]] },
  { layout: 'top', until: W(45) - 2, lines: [[{ text: 'Know', at: 31 }, { text: 'as', at: 32 }, { text: 'soon', at: 33 }, { text: 'as', at: 34 }], [{ text: 'FMCSA posts it.', at: 35, accent: 'serif', color: colors.orange, size: 128 }]] },
  { layout: 'top', until: W(50) - 2, lines: [[{ text: 'Fix', at: 45 }, { text: 'it…', at: 46 }], [{ text: 'or challenge it.', at: 47, accent: 'serif', color: colors.orange, size: 128 }]] },
  { layout: 'top', until: END, glitchAt: W(52), lines: [[{ text: 'before', at: 50 }, { text: 'it', at: 51 }, { text: 'hits', at: 52 }], [{ text: 'your safety scores.', at: 53, accent: 'serif', color: colors.redGlow, size: 110 }]] },
];

export const Inspections: React.FC = () => {
  const frame = useCurrentFrame();
  const jolt = shake(frame, MUCH, 12) + shake(frame, W(13), 8) + shake(frame, W(52), 8);
  return (
    <AbsoluteFill style={{ backgroundColor: colors.void, fontFamily: fonts.sans }}>
      <AbsoluteFill style={{ transform: `translate(${jolt}px, ${jolt * 0.6}px)` }}>
        <Background />
        <Scanlines opacity={0.7} />
        <Sequence durationInFrames={END}>
          <HudFrame topLeft="HAULOCK // EXAMPLE DATA" bottomLeft="" bottomRight="" />
        </Sequence>
        <Sequence durationInFrames={SCREEN_IN + 8}>
          <TotalsHook crackAt={MUCH} exitAt={SCREEN_IN} />
        </Sequence>
        <Sequence from={SCREEN_IN} durationInFrames={ALERT - SCREEN_IN + 12}>
          <ScreenOut at={ALERT - SCREEN_IN}>
            <PhoneRecording src={REC.src} css={REC.css} screenW={700} top={590} cuts={CUTS} until={ALERT - SCREEN_IN + 12} taps={[TAP]} />
          </ScreenOut>
        </Sequence>
        <Sequence from={ALERT} durationInFrames={END - ALERT + 12}>
          <AlertPhone t={{ notifyAt: W(31) - 2 - ALERT, openAt: W(45) - 6 - ALERT, scroll: [W(48) - ALERT, W(53) - ALERT] }} />
        </Sequence>
        <Captions vo={VO} chunks={CAPTIONS} />
      </AbsoluteFill>

      <Sequence from={END}>
        <EndCard
          vo={VO}
          from={END}
          urlAt={URL - END}
          chip="INSPECTIONS · CRASHES · ALERTS"
          headline={[
            [{ text: 'Check', at: 56 }, { text: 'any', at: 57 }],
            [{ text: 'carrier', at: 58 }, { text: 'free.', at: 59, accent: true }],
          ]}
          checks={['Free plan: 3 lookups a month', 'Alerts on paid plans']}
          hud={{ topLeft: 'HAULOCK.COM', bottomLeft: 'INSPECTIONS & CRASHES', bottomRight: 'LAST 24 MONTHS' }}
        />
      </Sequence>

      <GlitchBars at={MUCH} dur={12} />
      <GlitchBars at={SCREEN_IN} dur={6} />
      <GlitchBars at={ALERT} dur={8} />
      <GlitchBars at={W(52)} dur={8} />
      <GlitchBars at={END - 2} dur={8} />
      <Flash at={MUCH} color={colors.red} strength={0.25} />
      <Flash at={SCREEN_IN} strength={0.14} />
      <Flash at={W(13)} color={colors.red} strength={0.16} />
      <Flash at={W(31) - 2} color={colors.orange} strength={0.18} />
      <Flash at={W(52)} color={colors.red} strength={0.18} />

      <Audio />
    </AbsoluteFill>
  );
};

// The recording window drops back as the phone takes its place.
const ScreenOut: React.FC<{ at: number; children: React.ReactNode }> = ({ at, children }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + 10], [0, 1], { ...clamp, easing: (v) => v * v });
  return <AbsoluteFill style={{ opacity: 1 - p, transform: `scale(${1 - 0.12 * p})`, filter: `blur(${p * 8}px)` }}>{children}</AbsoluteFill>;
};

// ---------- hook: the totals, over the road, then they crack ----------
const TOTALS = [
  { n: '90', label: 'INSPECTIONS', color: colors.cream },
  { n: '8', label: 'OUT OF SERVICE', color: colors.redGlow },
  { n: '3', label: 'CRASHES', color: colors.cream },
];

const TotalsHook: React.FC<{ crackAt: number; exitAt: number }> = ({ crackAt, exitAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const g = glitchAt(frame, crackAt, 14);
  const collapse = interpolate(frame, [crackAt + 4, exitAt], [0, 1], { ...clamp, easing: (v) => v * v });
  const exit = interpolate(frame, [exitAt - 4, exitAt + 6], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <FootageLayer segments={[{ from: 0, to: exitAt + 8, clip: 'truck-fog', dim: 0.55 }]} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 690, textAlign: 'center', fontFamily: fonts.mono, fontSize: 24, letterSpacing: 4, color: colors.dim }}>DOT-3271••• · LAST 24 MONTHS</div>
      {TOTALS.map((x, i) => {
        const pop = spring({ frame: frame - (6 + i * 7), fps, config: { damping: 14, stiffness: 190 } });
        const dx = g ? (random(`tx${frame}-${i}`) - 0.5) * 60 * g : 0;
        return (
          <div
            key={x.label}
            style={{
              position: 'absolute',
              left: 150,
              right: 150,
              top: 760 + i * 200,
              height: 170,
              display: 'flex',
              alignItems: 'center',
              gap: 34,
              padding: '0 44px',
              borderRadius: 28,
              backgroundColor: 'rgba(6,16,38,0.72)',
              border: `2px solid ${i === 1 ? 'rgba(248,113,113,0.6)' : 'rgba(245,243,238,0.22)'}`,
              boxShadow: i === 1 ? '0 0 50px rgba(220,38,38,0.35)' : '0 20px 60px rgba(0,0,0,0.45)',
              opacity: Math.min(1, pop * 1.4) * (1 - collapse),
              transform: `translateX(${dx}px) scale(${0.85 + 0.15 * pop}) scaleY(${1 - collapse * 0.9})`,
            }}
          >
            <span style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 116, letterSpacing: -4, color: x.color, minWidth: 150, textShadow: rgbSplit(g * 10) }}>{x.n}</span>
            <span style={{ fontFamily: fonts.mono, fontWeight: 600, fontSize: 32, letterSpacing: 4, color: colors.cream }}>{x.label}</span>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const Audio: React.FC = () => {
  const tap = TAP.at + SCREEN_IN;
  return (
    <>
      <VoTrack vo={VO} />
      {/* "Epic Games" (Ahjay Stelino, Mixkit): a quiet open that builds ~7 dB by 16 s, so the
          bed comes down as it builds to keep the voice ~9 dB on top, then swells after the voice. */}
      <Html5Audio
        src={staticFile('music/epic-games.mp3')}
        volume={(f) =>
          interpolate(f, [0, 4], [0, 1], clamp) *
          interpolate(f, [0, 240, 300, 480, 540, VO.end, VO.end + 12], [0.45, 0.45, 0.35, 0.35, 0.24, 0.24, 0.7], clamp) *
          interpolate(f, [INSPECTIONS_DURATION - 24, INSPECTIONS_DURATION - 1], [1, 0], clamp)
        }
      />
      <Sfx src="sfx/riser.mp3" at={MUCH - 21} volume={0.4} />
      <Sfx src="sfx/glitch-b.mp3" at={MUCH - 1} volume={0.5} />
      <Sfx src="sfx/beep.mp3" at={SCREEN_IN} volume={0.25} />
      <Sfx src="sfx/glitch-a.mp3" at={W(13) - 7} volume={0.3} />
      <Sfx src="sfx/beep.mp3" at={W(14) - 2} volume={0.22} />
      <Sfx src="sfx/beep.mp3" at={W(19) - 4} volume={0.22} />
      <Sfx src="sfx/beep.mp3" at={tap} volume={0.3} />
      <Sfx src="sfx/glitch-a.mp3" at={ALERT - 1} volume={0.3} />
      <Sfx src="sfx/beep.mp3" at={W(31) - 2} volume={0.35} />
      <Sfx src="sfx/beep.mp3" at={W(31) + 4} volume={0.3} />
      <Sfx src="sfx/impact.mp3" at={W(45) - 7} volume={0.2} />
      <Sfx src="sfx/glitch-b.mp3" at={W(52) - 1} volume={0.4} />
      <Sfx src="sfx/glitch-b.mp3" at={END - 2} volume={0.32} />
      <Sfx src="sfx/impact.mp3" at={URL - 1} volume={0.18} />
    </>
  );
};
