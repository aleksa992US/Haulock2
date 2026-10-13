import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion';
import { Music, Sfx, VoTrack } from '../components/audio';
import { Background } from '../components/Background';
import { Captions, type CaptionChunk } from '../components/Captions';
import { EndCard } from '../components/EndCard';
import { Flash, GlitchBars, HudFrame, Scanlines, shake } from '../components/fx';
import { SearchHook, StepTag } from '../components/SearchHook';
import { SourcesRadar } from '../components/SourcesRadar';
import { VerdictCard } from '../components/VerdictCard';
import { makeVo } from '../vo';
import words from '../../public/voiceovers/for-brokers.words.json';
import { colors, fonts } from '../theme';

// ~19.8 s reel for brokers, following the site's three steps: enter the MC → 14 data
// sources → one score and a plain verdict ("Book this load" / "Walk away").
export const BROKERS_DURATION = 593;

// Word indices: 0 Hey 1 brokers, 2 before 3 you 4 tender, 5 type 6 in 7 the 8 MC. 9 Haulock
// 10 cross-checks 11 14 12 data 13 sources: 14 authority, 15 insurance, 16 safety 17 and
// 18 BASIC 19 scores, 20 inspections, 21 lookalike 22 emails, 23 chameleon 24 networks.
// 25 One 26 score, 27 one 28 verdict. 29 Book 30 it 31 or 32 walk 33 away. 34 Verify
// 35 carriers 36 free 37 at 38 haulock.com.
const VO = makeVo(
  'voiceovers/for-brokers.mp3',
  words,
  [
    { speech: [0.0, 0.75], gap: 0.2 }, // Hey brokers,
    { speech: [1.2, 2.2], gap: 0.2 }, // before you tender,
    { speech: [2.7, 3.7], gap: 0.15 }, // type in the MC.
    { speech: [4.3, 6.6], gap: 0.25 }, // Haulock cross-checks 14 data sources:
    { speech: [7.15, 8.35], gap: 0.2 }, // authority, insurance,
    { speech: [8.7, 9.85], gap: 0.15 }, // safety and BASIC scores,
    { speech: [10.1, 10.8], gap: 0.18 }, // inspections,
    { speech: [11.05, 12.95], gap: 0.18 }, // lookalike emails, chameleon networks.
    { speech: [13.55, 14.25], gap: 0.25 }, // One score,
    { speech: [14.5, 14.95], gap: 0.2 }, // one verdict.
    { speech: [15.5, 15.9], gap: 0.2 }, // Book it
    { speech: [16.2, 16.95], gap: 0.2 }, // or walk away.
    { speech: [17.5, 18.7], gap: 1.0 }, // Verify carriers free (pause: WALK AWAY holds)
    { speech: [18.95, 20.0], gap: 0.2 }, // at haulock.com.
  ],
  20.32
);
const W = VO.at;

const RADAR = W(9) - 5; // "Haulock cross-checks 14 data sources"
const SCORE = W(25) - 5; // "One score, one verdict."
const WALK = W(32);
const END = W(34) - 8; // "Verify carriers free"
const URL = W(38);

const CAPTIONS: CaptionChunk[] = [
  { layout: 'hero', until: W(2) - 3, lines: [[{ text: 'Hey,', at: 0 }, { text: 'brokers.', at: 1, accent: 'serif', color: colors.orange }]] },
  { layout: 'hero', until: W(5) - 3, lines: [[{ text: 'Before', at: 2 }, { text: 'you', at: 3 }], [{ text: 'tender,', at: 4, accent: 'serif', color: colors.orange }]] },
  { layout: 'hero', until: RADAR, lines: [[{ text: 'type', at: 5 }, { text: 'in', at: 6 }], [{ text: 'the', at: 7 }, { text: 'MC.', at: 8 }]] },
  {
    layout: 'top',
    until: W(14) - 3,
    lines: [[{ text: 'Haulock', at: 9 }, { text: 'cross-checks', at: 10 }], [{ text: '14 data sources', at: 11, accent: 'serif', color: colors.orange, size: 140 }]],
  },
  {
    layout: 'top',
    until: W(20) - 3,
    lines: [[{ text: 'authority,', at: 14 }, { text: 'insurance,', at: 15 }], [{ text: 'safety & BASIC scores', at: 16, accent: 'serif', color: colors.cream, size: 110 }]],
  },
  {
    layout: 'top',
    until: W(23) - 3,
    lines: [[{ text: 'inspections,', at: 20 }], [{ text: 'lookalike emails', at: 21, accent: 'serif', color: colors.redGlow, size: 124 }]],
  },
  {
    layout: 'top',
    until: SCORE,
    lines: [[{ text: 'chameleon', at: 23 }], [{ text: 'networks.', at: 24, accent: 'serif', color: colors.redGlow }]],
  },
  {
    layout: 'top',
    until: W(29) - 3,
    lines: [[{ text: 'One', at: 25 }, { text: 'score,', at: 26 }], [{ text: 'one verdict.', at: 27, accent: 'serif', color: colors.orange }]],
  },
  {
    layout: 'top',
    until: END,
    glitchAt: WALK,
    lines: [[{ text: 'Book it', at: 29, accent: 'serif', color: colors.greenGlow, size: 120 }], [{ text: 'or', at: 31 }, { text: 'walk away.', at: 32, accent: 'serif', color: colors.redGlow, size: 120 }]],
  },
];

export const ForBrokers: React.FC = () => {
  const frame = useCurrentFrame();
  const jolt = shake(frame, WALK, 16);
  return (
    <AbsoluteFill style={{ backgroundColor: colors.void, fontFamily: fonts.sans }}>
      <AbsoluteFill style={{ transform: `translate(${jolt}px, ${jolt * 0.6}px)` }}>
        <Background />
        <Sequence durationInFrames={RADAR + 6}>
          <SearchHook clip="trucker" exitAt={RADAR} typeAt={W(5)} submitAt={W(8) + 6} query="MC-441•••" />
        </Sequence>
        <Sequence from={RADAR} durationInFrames={SCORE - RADAR + 6}>
          <SourcesRadar
            start={W(10) - RADAR}
            end={W(13) + 6 - RADAR}
            focus={[
              { index: 0, at: W(14) - RADAR },
              { index: 1, at: W(15) - RADAR },
              { index: 3, at: W(16) - RADAR },
              { index: 3, at: W(20) - RADAR },
              { index: 9, at: W(21) - RADAR },
              { index: 10, at: W(23) - RADAR },
            ]}
          />
          <div style={{ position: 'absolute', left: 0, right: 0, top: 1478, display: 'flex', justifyContent: 'center' }}>
            <StepTag n="02" label="14 DATA SOURCES IN PARALLEL" />
          </div>
        </Sequence>
        <Sequence from={SCORE} durationInFrames={END - SCORE + 8}>
          <VerdictCard scoreAt={W(26) - SCORE} bookAt={W(29) - SCORE} walkAt={WALK - SCORE} />
        </Sequence>
        <Sequence durationInFrames={END}>
          <HudFrame topLeft="HAULOCK // CARRIER VETTING" bottomLeft="FOR BROKERS" bottomRight="14 DATA SOURCES" />
        </Sequence>
        <Captions vo={VO} chunks={CAPTIONS} />
        <Scanlines opacity={0.9} />
      </AbsoluteFill>

      <Sequence from={END}>
        <EndCard
          vo={VO}
          from={END}
          urlAt={URL - END}
          chip="14 DATA SOURCES · ONE VERDICT"
          headline={[[{ text: 'Try', at: 34 }, { text: 'for', at: 35 }], [{ text: 'free!', at: 36, accent: true }]]}
          checks={['Official FMCSA data', 'No credit card']}
          hud={{ topLeft: 'HAULOCK.COM', bottomLeft: 'FOR BROKERS', bottomRight: '14 DATA SOURCES' }}
        />
      </Sequence>

      <GlitchBars at={W(21)} dur={8} />
      <GlitchBars at={WALK} dur={12} />
      <GlitchBars at={END - 2} dur={8} />
      <Flash at={RADAR} strength={0.15} />
      <Flash at={W(29)} color={colors.green} strength={0.18} />
      <Flash at={WALK} color={colors.red} strength={0.35} dur={10} />

      <VoTrack vo={VO} />
      <Music src="music/epical-drums-05.mp3" startAt={1.0} voEnd={VO.end} duration={BROKERS_DURATION} bed={0.44} swell={0.9} />
      <Sfx src="sfx/riser.mp3" at={W(8) + 6 - 21} volume={0.4} />
      <Sfx src="sfx/beep.mp3" at={W(8) + 6} volume={0.3} />
      <Sfx src="sfx/scan.mp3" at={RADAR + 2} volume={0.5} />
      <Sfx src="sfx/beep.mp3" at={W(13) + 6} volume={0.3} />
      <Sfx src="sfx/glitch-a.mp3" at={W(21) - 1} volume={0.3} />
      <Sfx src="sfx/beep.mp3" at={W(29)} volume={0.25} />
      <Sfx src="sfx/glitch-b.mp3" at={WALK - 1} volume={0.45} />
      <Sfx src="sfx/impact.mp3" at={WALK - 1} volume={0.22} />
      <Sfx src="sfx/glitch-b.mp3" at={END - 2} volume={0.32} />
      <Sfx src="sfx/impact.mp3" at={URL - 1} volume={0.18} />
    </AbsoluteFill>
  );
};
