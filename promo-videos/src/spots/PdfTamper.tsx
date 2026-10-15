import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { AppScreen, SCREEN, type Recording, type ScreenCut, fit, toWindow } from '../components/AppScreen';
import { Music, Sfx, VoTrack } from '../components/audio';
import { Background } from '../components/Background';
import { Captions, type CaptionChunk } from '../components/Captions';
import { ChangesCard } from '../components/ChangesCard';
import { EndCard } from '../components/EndCard';
import { Decode, Flash, GlitchBars, HudFrame, Scanlines, glitchAt, shake, usePop } from '../components/fx';
import { makeVo } from '../vo';
import words from '../../public/voiceovers/pdf-tamper.words.json';
import phoneMarks from '../../public/recordings/pdf-tamper.marks.json';
import { clamp, colors, fonts } from '../theme';

// 20 s reel: not just "your rate con was edited" but by how much, and what else changed.
// Shown in a screen recording of the real app (scripts/record-screens.mjs) on a sample
// rate con that was signed and then edited four times (scripts/make-tampered-pdf.mjs).
export const PDF_TAMPER_DURATION = 600;

// Take C of the ElevenLabs read (Desmond – Trailer & Ad Voice, eleven_v4), phrases
// measured from the take. Word indices: 0 Your 1 rate 2 con 3 was 4 edited… 5 now 6 see
// 7 by 8 HOW 9 MUCH. 10 Fourteen 11 hundred… 12 cut 13 to 14 ELEVEN 15 hundred.
// 16 Detention 17 gone. 18 Lumper 19 hidden. 20 Page 21 two 22 deleted. 23 Haulock
// 24 shows 25 you 26 exactly 27 what 28 changed. 29 Check 30 yours 31 free… 32 at
// 33 haulock.com.
const VO = makeVo(
  'voiceovers/pdf-tamper.mp3',
  words,
  [
    { speech: [0.04, 1.62], gap: 0.15 }, // Your rate con was edited…
    { speech: [1.88, 3.42], gap: 0.2 }, // now see by HOW MUCH.
    { speech: [3.76, 4.56], gap: 0.75 }, // Fourteen hundred… (the verdict holds)
    { speech: [4.86, 6.38], gap: 0.15 }, // cut to ELEVEN hundred.
    { speech: [6.76, 8.02], gap: 0.8 }, // Detention — gone. (the −$300 holds)
    { speech: [8.33, 9.42], gap: 0.3 }, // Lumper — hidden.
    { speech: [9.72, 11.1], gap: 0.3 }, // Page two — deleted.
    { speech: [11.56, 13.62], gap: 0.45 }, // Haulock shows you exactly what changed.
    { speech: [13.97, 14.76], gap: 1.4 }, // Check yours free… (time to read the recap)
    { speech: [14.96, 16.12], gap: 0.15 }, // at haulock.com.
  ],
  16.24
);
const W = VO.at;

const EDITED = W(4);
const SCREEN_IN = W(5) - 8; // "now see by HOW MUCH."
const VERDICT = W(9) + 2;
const STAMP = W(15) + 6; // "…ELEVEN hundred."
const RECAP = W(23) - 4; // "Haulock shows you exactly what changed."
const END = W(29) - 8; // "Check yours free…"
const URL = W(33);

// ---------- the recording ----------
const PHONE: Recording = { src: 'recordings/pdf-tamper.mp4', css: 430, scale: 3 };
const M = phoneMarks.marks;
const SCROLL = 0.6; // seconds each recorded scroll takes (the verdict's: 0.65)
const cam = () => fit(PHONE);

// Frames relative to SCREEN_IN. Each finding is a hard cut to its settled card, on its word.
const S = (frame: number) => frame - SCREEN_IN;
const CUTS: ScreenCut[] = [
  { at: 0, rec: PHONE, from: 0.3, camera: cam }, // tap "Choose PDF" → "Taking the PDF apart…"
  { at: S(VERDICT), rec: PHONE, from: M.verdict.t + 0.65, camera: cam, punch: true }, // Likely tampered · 100
  { at: S(W(10)) - 2, rec: PHONE, from: M.v3.t + SCROLL, camera: cam, punch: true }, // Line haul $1,400.00 → $1,100.00
  { at: S(W(16)) - 2, rec: PHONE, from: M.v4.t + SCROLL, camera: cam, punch: true }, // Detention → "Not paid"
  { at: S(W(18)) - 2, rec: PHONE, from: M.v5.t + SCROLL, camera: cam, punch: true }, // Lumper made invisible
  { at: S(W(20)) - 2, rec: PHONE, from: M.v6.t + SCROLL, camera: cam, punch: true }, // page 2 removed
];
const TAP = (() => {
  const r = M.tap.rect!;
  return { at: Math.round((M.tap.t - 0.3) * 30), ...toWindow(cam(), r.x + r.w / 2, r.y + r.h / 2) };
})();

const CAPTIONS: CaptionChunk[] = [
  {
    layout: 'top',
    until: W(5) - 3,
    glitchAt: EDITED,
    lines: [[{ text: 'Your', at: 0 }, { text: 'rate', at: 1 }, { text: 'con', at: 2 }], [{ text: 'was', at: 3 }, { text: 'edited.', at: 4, accent: 'serif', color: colors.orange }]],
  },
  { layout: 'top', until: W(10) - 3, lines: [[{ text: 'Now', at: 5 }, { text: 'see', at: 6 }], [{ text: 'by how much.', at: 7, accent: 'serif', color: colors.orange, size: 140 }]] },
  { layout: 'top', until: W(12) - 2, lines: [[{ text: 'Line haul', at: 10 }], [{ text: '$1,400', at: 10, accent: 'money', color: colors.greenGlow }]] },
  { layout: 'top', until: W(16) - 3, glitchAt: W(14), lines: [[{ text: 'cut', at: 12 }, { text: 'to', at: 13 }], [{ text: '$1,100', at: 14, accent: 'money', color: colors.redGlow }]] },
  { layout: 'top', until: W(18) - 2, lines: [[{ text: 'Detention', at: 16 }], [{ text: 'gone.', at: 17, accent: 'serif', color: colors.redGlow }]] },
  { layout: 'top', until: W(20) - 2, lines: [[{ text: 'Lumper', at: 18 }], [{ text: 'hidden.', at: 19, accent: 'serif', color: colors.redGlow }]] },
  { layout: 'top', until: W(23) - 3, lines: [[{ text: 'Page', at: 20 }, { text: '2', at: 21 }], [{ text: 'deleted.', at: 22, accent: 'serif', color: colors.redGlow }]] },
  {
    layout: 'top',
    until: END,
    lines: [[{ text: 'Haulock', at: 23 }, { text: 'shows', at: 24 }, { text: 'you', at: 25 }], [{ text: 'exactly what changed.', at: 26, accent: 'serif', color: colors.orange, size: 100 }]],
  },
];

export const PdfTamper: React.FC = () => {
  const frame = useCurrentFrame();
  const jolt = shake(frame, EDITED) + shake(frame, W(14), 10) + shake(frame, STAMP, 8);
  return (
    <AbsoluteFill style={{ backgroundColor: colors.void, fontFamily: fonts.sans }}>
      <AbsoluteFill style={{ transform: `translate(${jolt}px, ${jolt * 0.6}px)` }}>
        <Background />
        <Scanlines opacity={0.7} />
        <Sequence durationInFrames={SCREEN_IN + 10}>
          <DocHook editAt={EDITED} exitAt={SCREEN_IN} />
        </Sequence>
        <Sequence from={SCREEN_IN} durationInFrames={RECAP - SCREEN_IN + 12}>
          <ScreenOut at={RECAP - SCREEN_IN}>
            <AppScreen cuts={CUTS} until={RECAP - SCREEN_IN + 12} url="haulock.com/verify" taps={[TAP]} />
          </ScreenOut>
        </Sequence>
        <Sequence from={STAMP} durationInFrames={W(16) - 2 - STAMP}>
          <MoneyStamp exitAt={W(16) - 8 - STAMP} />
        </Sequence>
        <Sequence from={RECAP} durationInFrames={END - RECAP + 12}>
          <Recap rowsAt={[6, 12, 18, 24]} />
        </Sequence>
        <Sequence durationInFrames={END}>
          <HudFrame topLeft="HAULOCK // PDF TAMPER CHECK" bottomLeft="RATE-CON-4821.PDF" bottomRight="4 CHANGES FOUND" />
        </Sequence>
        <Captions vo={VO} chunks={CAPTIONS} />
      </AbsoluteFill>

      <Sequence from={END}>
        <EndCard
          vo={VO}
          from={END}
          urlAt={URL - END}
          chip="SEE WHAT CHANGED ON YOUR RATE CON"
          headline={[
            [{ text: 'Check', at: 29 }, { text: 'yours', at: 30 }],
            [{ text: 'free.', at: 31, accent: true }],
          ]}
          checks={['3 free PDF scans a month', 'No credit card']}
          hud={{ topLeft: 'HAULOCK.COM', bottomLeft: 'PDF TAMPER CHECK', bottomRight: '3 FREE SCANS / MO' }}
        />
      </Sequence>

      <GlitchBars at={EDITED} dur={12} />
      <GlitchBars at={SCREEN_IN} dur={6} />
      <GlitchBars at={W(14)} dur={10} />
      <GlitchBars at={RECAP} dur={6} />
      <GlitchBars at={END - 2} dur={8} />
      <Flash at={EDITED} color={colors.orange} strength={0.25} />
      <Flash at={SCREEN_IN} strength={0.14} />
      <Flash at={VERDICT} color={colors.red} strength={0.16} />
      <Flash at={W(14)} color={colors.red} strength={0.22} />
      <Flash at={RECAP} strength={0.12} />

      <Audio />
    </AbsoluteFill>
  );
};

// The phone window drops back as the recap takes its place.
const ScreenOut: React.FC<{ at: number; children: React.ReactNode }> = ({ at, children }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + 10], [0, 1], { ...clamp, easing: (v) => v * v });
  return <AbsoluteFill style={{ opacity: 1 - p, transform: `scale(${1 - 0.12 * p})`, filter: `blur(${p * 8}px)` }}>{children}</AbsoluteFill>;
};

// "−$300": stamped over the screen as "eleven hundred" lands.
const MoneyStamp: React.FC<{ exitAt: number }> = ({ exitAt }) => {
  const frame = useCurrentFrame();
  const pop = usePop(0, { damping: 11, stiffness: 240 });
  const out = interpolate(frame, [exitAt, exitAt + 6], [0, 1], clamp);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: SCREEN.top + 780, display: 'flex', justifyContent: 'center', opacity: Math.min(1, pop * 1.4) * (1 - out) }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 30,
          padding: '18px 44px 22px',
          borderRadius: 26,
          backgroundColor: colors.red,
          color: '#fff',
          boxShadow: '0 30px 80px rgba(220,38,38,0.55), 0 0 0 6px rgba(255,255,255,0.9)',
          transform: `rotate(-5deg) scale(${interpolate(pop, [0, 1], [1.8, 1])})`,
        }}
      >
        <span style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 150, letterSpacing: -6, lineHeight: 1 }}>−$300</span>
        <span style={{ fontFamily: fonts.mono, fontWeight: 600, fontSize: 26, letterSpacing: 3, lineHeight: 1.35 }}>
          LINE HAUL
          <br />
          CUT
        </span>
      </div>
    </div>
  );
};

// Everything the check found, in one list (the sample's real changes).
const Recap: React.FC<{ rowsAt: number[] }> = ({ rowsAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16, stiffness: 150 } });
  const reveal = (at: number) => interpolate(frame, [at, at + 7], [0, 1], { ...clamp, easing: (v) => 1 - Math.pow(1 - v, 3) });
  return (
    <ChangesCard
      lang="en"
      shown={rowsAt.map(reveal)}
      footer={interpolate(frame, [rowsAt[3] + 6, rowsAt[3] + 14], [0, 1], clamp)}
      style={{
        left: SCREEN.left,
        top: SCREEN.top,
        width: SCREEN.size,
        height: SCREEN.size + SCREEN.bar,
        opacity: Math.min(1, enter * 1.6),
        transform: `translateY(${(1 - enter) * 90}px) scale(${0.9 + 0.1 * enter})`,
        boxShadow: '0 40px 120px rgba(0,0,0,0.65), 0 0 0 3px rgba(220,38,38,0.55), 0 0 90px rgba(220,38,38,0.3)',
      }}
    />
  );
};

// ---------- hook: the rate con as signed, then as received ----------
// Page renders at 3 px/pt (scripts/render-pdf-pages.mjs); the camera is in PDF points.
const CARD = { left: 70, top: 668, w: 940, h: 760 };
const PAGE_PT = { w: 612, h: 792 };

const DocHook: React.FC<{ editAt: number; exitAt: number }> = ({ editAt, exitAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const build = interpolate(frame, [0, 12], [0, 1], { ...clamp, easing: (v) => 1 - Math.pow(1 - v, 3) });
  const exit = spring({ frame: frame - exitAt, fps, config: { damping: 18, stiffness: 160 } });
  // Whole rate con, then in on the rate & accessorials as the edit lands.
  const push = interpolate(frame, [4, editAt + 2], [0, 1], { ...clamp, easing: (v) => 1 - Math.pow(1 - v, 2.4) });
  const z = 1.77 + (2.3 - 1.77) * push; // px per pt
  const fx = 306 + (262 - 306) * push; // keeps the row labels (x 62) and values (to x 466) in view
  const fy = 560 + (468 - 560) * push;
  const g = glitchAt(frame, editAt, 12);
  const received = frame >= editAt;
  const beam = interpolate(frame, [2, editAt], [-0.1, 1.1], clamp);

  const page = (src: string, style?: React.CSSProperties) => (
    <Img
      src={staticFile(src)}
      style={{ position: 'absolute', width: PAGE_PT.w * z, height: PAGE_PT.h * z, left: CARD.w / 2 - fx * z, top: CARD.h / 2 - (PAGE_PT.h - fy) * z, maxWidth: 'none', ...style }}
    />
  );

  return (
    <div
      style={{
        position: 'absolute',
        left: CARD.left,
        top: CARD.top,
        width: CARD.w,
        height: CARD.h,
        opacity: 1 - exit,
        transform: `translateY(${-exit * 120}px) scale(${1 - exit * 0.18}) perspective(1600px) rotateX(${(1 - build) * 14}deg)`,
      }}
    >
      <div style={{ position: 'absolute', left: 0, right: 0, top: -58, display: 'flex', justifyContent: 'space-between', fontFamily: fonts.mono, fontSize: 24, letterSpacing: 3, color: received ? colors.redGlow : colors.dim }}>
        <span>RATE-CON-4821.PDF</span>
        <span>{received ? <Decode text="AS RECEIVED" at={editAt} dur={10} /> : 'AS SIGNED · 10/14 09:15'}</span>
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 26,
          overflow: 'hidden',
          backgroundColor: '#fff',
          clipPath: `inset(0 0 ${(1 - build) * 100}% 0 round 26px)`,
          boxShadow: `0 40px 120px rgba(0,0,0,0.6), 0 0 0 3px ${received ? 'rgba(220,38,38,0.7)' : 'rgba(255,107,53,0.55)'}, 0 0 80px ${received ? 'rgba(220,38,38,0.35)' : 'rgba(255,107,53,0.25)'}`,
        }}
      >
        {page(received ? 'recordings/rate-con-received.png' : 'recordings/rate-con-signed.png')}
        {/* Glitch: slices of the other version, shifted sideways. */}
        {g > 0
          ? Array.from({ length: 6 }, (_, i) => {
              const r = (k: string) => random(`slice-${frame}-${i}-${k}`);
              const top = r('y') * 100;
              const h = 3 + r('h') * 12;
              return (
                <div key={i} style={{ position: 'absolute', inset: 0, clipPath: `inset(${top}% 0 ${Math.max(0, 100 - top - h)}% 0)`, transform: `translateX(${(r('x') - 0.5) * 80 * g}px)` }}>
                  {page(i % 2 ? 'recordings/rate-con-signed.png' : 'recordings/rate-con-received.png', { filter: `hue-rotate(${r('c') * 90}deg)` })}
                </div>
              );
            })
          : null}
        {/* Scan beam while the camera pushes in. */}
        {beam > -0.05 && beam < 1.05 ? (
          <div style={{ position: 'absolute', left: 0, right: 0, top: `${beam * 100}%`, height: 4, backgroundColor: colors.orange, boxShadow: '0 0 30px 10px rgba(255,107,53,0.45)', opacity: 0.8 }} />
        ) : null}
      </div>
    </div>
  );
};

const Audio: React.FC = () => {
  const tap = TAP.at + SCREEN_IN;
  return (
    <>
      <VoTrack vo={VO} />
      {/* "Epical Drums 03" from where the drums kick in (as in rate-con-edited). */}
      <Music src="music/epical-drums-03.mp3" startAt={2.9} voEnd={VO.end} duration={PDF_TAMPER_DURATION} />
      <Sfx src="sfx/riser.mp3" at={EDITED - 21} volume={0.4} />
      <Sfx src="sfx/glitch-b.mp3" at={EDITED - 1} volume={0.5} />
      <Sfx src="sfx/glitch-a.mp3" at={SCREEN_IN - 1} volume={0.3} />
      <Sfx src="sfx/beep.mp3" at={tap} volume={0.3} />
      <Sfx src="sfx/scan.mp3" at={tap + 4} volume={0.45} />
      <Sfx src="sfx/impact.mp3" at={VERDICT - 1} volume={0.2} />
      <Sfx src="sfx/beep.mp3" at={W(10) - 2} volume={0.25} />
      <Sfx src="sfx/glitch-b.mp3" at={W(14) - 1} volume={0.45} />
      <Sfx src="sfx/impact.mp3" at={STAMP - 1} volume={0.24} />
      <Sfx src="sfx/beep.mp3" at={W(16) - 2} volume={0.22} />
      <Sfx src="sfx/beep.mp3" at={W(18) - 2} volume={0.22} />
      <Sfx src="sfx/beep.mp3" at={W(20) - 2} volume={0.22} />
      <Sfx src="sfx/scan.mp3" at={RECAP} volume={0.35} />
      <Sfx src="sfx/glitch-b.mp3" at={END - 2} volume={0.32} />
      <Sfx src="sfx/impact.mp3" at={URL - 1} volume={0.18} />
    </>
  );
};
