import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion';
import { Music, Sfx, VoTrack } from '../components/audio';
import { Background } from '../components/Background';
import { Captions, type CaptionChunk } from '../components/Captions';
import { EndCard } from '../components/EndCard';
import { Flash, GlitchBars, HudFrame, Scanlines, shake } from '../components/fx';
import { HoloScene } from '../components/Hologram';
import { ScannerHook } from '../components/hook';
import { makeVo } from '../vo';
import words from '../../public/voiceovers/rate-con-edited.words.json';
import { colors, fonts } from '../theme';

// 15 s reel for drivers: "Driver… has your rate con been EDITED?"
// Male trailer voice (ElevenLabs), dark "Epical Drums 03" bed (Mixkit), ElevenLabs SFX.
// Every cut and effect is anchored to a spoken word (indices in vo.ts).
export const SPOT_DURATION = 450;

// Word indices: 0 Driver… 1 has 2 your 3 rate 4 con 5 been 6 EDITED? 7 The 8 broker 9 paid
// 10 fourteen 11 hundred. 12 You 13 got 14 eleven 15 hundred. 16 Haulock 17 reads 18 the
// 19 hidden 20 data 21 inside 22 the 23 PDF 24 and 25 catches 26 the 27 edit. 28 Check
// 29 yours 30 free… 31 at 32 haulock.com.
const VO = makeVo(
  'voiceovers/rate-con-edited.mp3',
  words,
  [
    { speech: [0.05, 0.7], gap: 0.2 }, // Driver…
    { speech: [1.2, 2.95], gap: 0.35 }, // has your rate con been EDITED?
    { speech: [3.65, 5.1], gap: 0.4 }, // The broker paid fourteen hundred.
    { speech: [5.65, 6.85], gap: 0.25 }, // You got eleven hundred.
    { speech: [7.65, 10.0], gap: 0.4 }, // Haulock reads the hidden data inside the PDF —
    { speech: [10.4, 11.3], gap: 0.22 }, // and catches the edit.
    { speech: [11.85, 12.65], gap: 0.35 }, // Check yours free…
    { speech: [12.95, 14.0], gap: 0.18 }, // at haulock.com.
  ],
  14.32
);
const W = VO.at;

const EDITED = W(6);
const DIFF = W(7) - 5; // "The broker paid…"
const EDIT = W(14); // "eleven hundred"
const SCAN = W(16) - 4; // "Haulock reads…"
const SPLIT = W(21); // "inside the PDF"
const VERDICT = W(25); // "catches"
const END = W(28) - 8; // "Check yours free…"
const URL = W(32); // "haulock.com"

const CAPTIONS: CaptionChunk[] = [
  { layout: 'hero', until: W(1) - 3, lines: [[{ text: 'Driver…', at: 0 }]] },
  {
    layout: 'hero',
    until: DIFF,
    glitchAt: EDITED,
    lines: [
      [{ text: 'Has', at: 1 }, { text: 'your', at: 2 }, { text: 'rate', at: 3 }, { text: 'con', at: 4 }],
      [{ text: 'been', at: 5 }, { text: 'edited?', at: 6, accent: 'serif', color: colors.orange }],
    ],
  },
  {
    layout: 'top',
    until: W(12) - 3,
    lines: [[{ text: 'The', at: 7 }, { text: 'broker', at: 8 }, { text: 'paid', at: 9 }], [{ text: '$1,400', at: 10, accent: 'money', color: colors.greenGlow }]],
  },
  {
    layout: 'top',
    until: SCAN,
    glitchAt: EDIT,
    lines: [[{ text: 'You', at: 12 }, { text: 'got', at: 13 }], [{ text: '$1,100', at: 14, accent: 'money', color: colors.redGlow }]],
  },
  {
    layout: 'top',
    until: W(21) - 3,
    lines: [[{ text: 'Haulock', at: 16 }, { text: 'reads', at: 17 }, { text: 'the', at: 18 }], [{ text: 'hidden data', at: 19, accent: 'serif', color: colors.orange }]],
  },
  {
    layout: 'top',
    until: W(24) - 3,
    lines: [[{ text: 'inside', at: 21 }, { text: 'the', at: 22 }], [{ text: 'PDF', at: 23, accent: 'serif', color: colors.cream }]],
  },
  {
    layout: 'top',
    until: END,
    glitchAt: VERDICT,
    lines: [[{ text: 'and', at: 24 }, { text: 'catches', at: 25 }], [{ text: 'the edit.', at: 26, accent: 'serif', color: colors.redGlow }]],
  },
];

export const RateConEdited: React.FC = () => {
  const frame = useCurrentFrame();
  const jolt = shake(frame, EDITED) + shake(frame, EDIT, 8) + shake(frame, VERDICT, 18);
  return (
    <AbsoluteFill style={{ backgroundColor: colors.void, fontFamily: fonts.sans }}>
      <AbsoluteFill style={{ transform: `translate(${jolt}px, ${jolt * 0.6}px)` }}>
        <Background />
        <Sequence durationInFrames={DIFF + 6}>
          <ScannerHook clip="highway-pov" exitAt={DIFF} alertAt={EDITED} label="SCANNING ▸ rate-con-4821.pdf" alertLabel="⚠ ANOMALY DETECTED" />
        </Sequence>
        <Sequence from={DIFF} durationInFrames={END - DIFF + 10}>
          <HoloScene
            t={{ payAt: W(10) - DIFF, editAt: EDIT - DIFF, scanAt: SCAN - DIFF + 4, splitAt: SPLIT - DIFF, verdictAt: VERDICT - DIFF }}
          />
        </Sequence>
        <Sequence durationInFrames={END}>
          <HudFrame topLeft="HAULOCK // PDF FORENSICS" bottomLeft="LOAD #4821" bottomRight="RATE-CON-4821.PDF" />
        </Sequence>
        <Captions vo={VO} chunks={CAPTIONS} />
        <Scanlines opacity={0.9} />
      </AbsoluteFill>

      <Sequence from={END}>
        <EndCard
          vo={VO}
          from={END}
          urlAt={URL - END}
          chip="CATCHES EDITED RATE CONS"
          headline={[
            [{ text: 'Check', at: 28 }, { text: 'your', at: 28 }],
            [{ text: 'rate', at: 29 }, { text: 'con', at: 29 }, { text: 'free.', at: 30, accent: true }],
          ]}
          checks={['3 free PDF scans a month', 'No credit card']}
          hud={{ topLeft: 'HAULOCK.COM', bottomLeft: 'RATE CON FORENSICS', bottomRight: '3 FREE SCANS / MO' }}
        />
      </Sequence>

      <GlitchBars at={EDITED} dur={12} />
      <GlitchBars at={EDIT} />
      <GlitchBars at={VERDICT} dur={10} />
      <GlitchBars at={END - 2} dur={8} />
      <Flash at={EDITED} color={colors.orange} strength={0.25} />
      <Flash at={VERDICT} color={colors.red} strength={0.4} dur={10} />
      <Flash at={DIFF} strength={0.18} />

      <Audio />
    </AbsoluteFill>
  );
};

const Audio: React.FC = () => (
  <>
    <VoTrack vo={VO} />
    {/* "Epical Drums 03" from where the drums kick in. */}
    <Music src="music/epical-drums-03.mp3" startAt={2.9} voEnd={VO.end} duration={SPOT_DURATION} />
    <Sfx src="sfx/riser.mp3" at={EDITED - 21} volume={0.45} />
    <Sfx src="sfx/glitch-b.mp3" at={EDITED - 1} volume={0.5} />
    <Sfx src="sfx/glitch-a.mp3" at={EDIT - 1} volume={0.45} />
    <Sfx src="sfx/scan.mp3" at={SCAN + 2} volume={0.55} />
    <Sfx src="sfx/beep.mp3" at={SPLIT} volume={0.3} />
    <Sfx src="sfx/impact.mp3" at={VERDICT - 1} volume={0.22} />
    <Sfx src="sfx/glitch-b.mp3" at={END - 2} volume={0.32} />
    <Sfx src="sfx/impact.mp3" at={URL - 1} volume={0.18} />
  </>
);
