import React from 'react';
import { Sequence } from 'remotion';
import { type PhoneCut, PhoneRecording } from '../components/AppScreen';
import { FeatureReel, HookCard, Stamp, phraseVo, reelDuration } from '../components/FeatureReel';
import type { CaptionChunk } from '../components/Captions';
import marks from '../../public/recordings/report-officers.marks.json';
import { colors } from '../theme';

// ~20 s reel: officer names, phone and email from the company's FMCSA filing, and the
// verdict's "call this number, ask for them by name" (scripts/record-reports.mjs, take
// "report-officers"). Example broker: scripts/examples.mjs QUILLMONT.

// Take A (Desmond, eleven_v4), cut at its measured pauses; one entry per phrase.
const VO = phraseVo(
  'voiceovers/officers.mp3',
  [
    { text: 'A broker calls with a perfect load.', speech: [0.12, 2.0], gap: 0.15 }, // 0
    { text: 'But is it REALLY them?', speech: [2.55, 3.65], gap: 0.3 }, // 1
    { text: "Haulock shows the officers on the company's FMCSA filing…", speech: [4.2, 7.53], gap: 0.4 }, // 2
    { text: 'and the phone and email on record.', speech: [8.1, 9.78], gap: 0.25 }, // 3
    { text: 'Hang up.', speech: [10.47, 10.75], gap: 0.4 }, // 4
    { text: 'Call the number FMCSA has…', speech: [11.35, 13.35], gap: 0.35 }, // 5
    { text: 'and ask for the owner by name.', speech: [13.65, 15.12], gap: 0.15 }, // 6
    { text: "That's how you stop a double-broker.", speech: [15.72, 17.43], gap: 0.35 }, // 7
    { text: 'Check any company free…', speech: [17.93, 19.15], gap: 0.5 }, // 8
    { text: 'at haulock.com.', speech: [19.45, 20.48], gap: 0.2 }, // 9
  ],
  20.8
);
const W = VO.at;

const SCREEN_IN = W(2) - 10;
const END = W(8) - 8;
export const OFFICERS_DURATION = reelDuration(END, VO);
const M = marks.marks;
const SCROLL = 0.7;
const S = (f: number) => f - SCREEN_IN;
const VERDICT = M.verdict.t + SCROLL + 0.05;
const CUTS: PhoneCut[] = [
  { at: 0, from: M.searchShown.t - 0.6 }, // the search lands on the report
  { at: 42, from: M.identity.t + SCROLL + 0.05, punch: true }, // Identity: officers, phone, email on the FMCSA filing
  { at: S(W(5)) - 2, from: VERDICT, punch: true }, // "call (555) 019-7744 … ask for Laura Bennett or Victor Hale"
  { at: S(W(6)) - 2, from: VERDICT + 0.3 }, // (same card, held past the take's scroll)
  { at: S(W(7)) - 2, from: VERDICT + 0.3 },
];

const CAPTIONS: CaptionChunk[] = [
  { layout: 'top', until: W(1) - 3, lines: [[{ text: 'A broker calls with', at: 0 }], [{ text: 'a perfect load.', at: 0, accent: 'serif', color: colors.orange }]] },
  { layout: 'top', until: W(2) - 3, lines: [[{ text: 'But is it', at: 1 }], [{ text: 'really them?', at: 1, accent: 'serif', color: colors.orange }]] },
  { layout: 'top', until: W(3) - 2, lines: [[{ text: 'The officers on', at: 2 }], [{ text: 'the FMCSA filing.', at: 2, accent: 'serif', color: colors.orange, size: 108 }]] },
  { layout: 'top', until: W(4) - 2, lines: [[{ text: 'Plus the phone & email', at: 3 }], [{ text: 'on record.', at: 3, accent: 'serif', color: colors.orange }]] },
  { layout: 'top', until: W(5) - 2, lines: [[{ text: 'Hang', at: 4 }], [{ text: 'up.', at: 4, accent: 'serif', color: colors.redGlow }]], glitchAt: W(4) },
  { layout: 'top', until: W(6) - 2, lines: [[{ text: 'Call the number', at: 5 }], [{ text: 'FMCSA has…', at: 5, accent: 'serif', color: colors.orange }]] },
  { layout: 'top', until: W(7) - 2, lines: [[{ text: 'and ask for the owner', at: 6 }], [{ text: 'by name.', at: 6, accent: 'serif', color: colors.orange }]] },
  { layout: 'top', until: END, lines: [[{ text: "That's how you stop", at: 7 }], [{ text: 'a double-broker.', at: 7, accent: 'serif', color: colors.redGlow }]] },
];

export const Officers: React.FC = () => (
  <FeatureReel
    vo={VO}
    duration={OFFICERS_DURATION}
    captions={CAPTIONS}
    hudTop="HAULOCK // WHO'S ON THE PHONE"
    hook={{
      until: SCREEN_IN,
      node: (
        <HookCard
          clip="highway-pov"
          exitAt={SCREEN_IN}
          label="INCOMING CALL · BROKER"
          title="Quillmont Freight"
          lines={['(555) 016-3390', 'Hot load · Columbus, OH → Atlanta, GA']}
          stamp={{ text: 'REALLY THEM?', at: W(1) + 2, color: colors.orange }}
        />
      ),
    }}
    scenes={[
      {
        from: SCREEN_IN,
        until: END,
        node: (
          <>
            <PhoneRecording
              src="recordings/report-officers.mp4"
              css={{ w: 430, h: 880 }}
              screenW={700}
              top={590}
              cuts={CUTS}
              until={END - SCREEN_IN}
              taps={[]}
              boxes={[
                { from: 50, until: S(W(3)) - 2, x: 40, y: 424, w: 350, h: 52 },
                { from: S(W(3)), until: S(W(4)) - 4, x: 40, y: 360, w: 350, h: 50 },
                { from: S(W(3)) + 10, until: S(W(4)) - 4, x: 40, y: 492, w: 350, h: 50 },
                { from: S(W(5)), until: S(W(7)) - 2, x: 50, y: 262, w: 334, h: 128, color: colors.greenGlow },
              ]}
            />
            <Sequence from={S(W(5)) + 6} durationInFrames={W(6) - W(5) - 8}>
              <Stamp big="(555) 019-7744" small={['ON FMCSA', 'RECORD']} color={colors.navy} top={1690} />
            </Sequence>
            <Sequence from={S(W(6)) + 4} durationInFrames={W(7) - W(6) - 6}>
              <Stamp big="Laura Bennett" small={['ASK FOR', 'BY NAME']} color={colors.green} top={1690} />
            </Sequence>
            <Sequence from={S(W(7)) + 14}>
              <Stamp big="Stopped." small={['DOUBLE-', 'BROKER']} color={colors.red} top={1690} />
            </Sequence>
          </>
        ),
      },
    ]}
    end={{
      at: END,
      urlAt: W(9),
      chip: 'OFFICERS · PHONE · EMAIL ON FMCSA FILE',
      headline: [
        [{ text: 'Check any', at: 8 }],
        [{ text: 'company', at: 8 }, { text: 'free.', at: 8, accent: true }],
      ],
      checks: ['Free plan included', 'No credit card'],
      hud: { topLeft: 'HAULOCK.COM', bottomLeft: 'OFFICERS ON RECORD', bottomRight: '3 FREE LOOKUPS / MO' },
    }}
    music={{ src: 'music/shark-thank.mp3', bed: [[0, 30], [0.35, 0.35]], swell: 0.7 }}
    sfx={[
      { src: 'sfx/impact.mp3', at: W(1) + 1, volume: 0.22 },
      { src: 'sfx/beep.mp3', at: SCREEN_IN, volume: 0.25 },
      { src: 'sfx/scan.mp3', at: SCREEN_IN + 40, volume: 0.35 },
      { src: 'sfx/beep.mp3', at: W(3), volume: 0.22 },
      { src: 'sfx/glitch-b.mp3', at: W(4), volume: 0.3 },
      { src: 'sfx/beep.mp3', at: W(5) + 6, volume: 0.22 },
      { src: 'sfx/beep.mp3', at: W(6) + 4, volume: 0.22 },
      { src: 'sfx/impact.mp3', at: W(7) + 13, volume: 0.26 },
    ]}
    hits={[
      { at: W(1) + 2, glitch: 10, flash: 0.2, color: colors.orange, shake: 10 },
      { at: SCREEN_IN, glitch: 6, flash: 0.14 },
      { at: W(4), glitch: 8, flash: 0.16, color: colors.red, shake: 8 },
      { at: W(7) + 14, flash: 0.2, color: colors.red, shake: 10 },
    ]}
  />
);
