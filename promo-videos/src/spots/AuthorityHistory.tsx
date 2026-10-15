import React from 'react';
import { Sequence } from 'remotion';
import { type PhoneCut, PhoneRecording } from '../components/AppScreen';
import { FeatureReel, HookCard, Stamp, phraseVo, reelDuration } from '../components/FeatureReel';
import type { CaptionChunk } from '../components/Captions';
import marks from '../../public/recordings/report-authority.marks.json';
import { colors } from '../theme';

// ~21 s reel: authority history — a 12-year-old MC that sat dead for 2y 3m and was
// reactivated in April, flagged +30 (scripts/record-reports.mjs, take "report-authority").
// Example carrier: scripts/examples.mjs IRONVALE.

// Take A (Desmond, eleven_v4), cut at its measured pauses; one entry per phrase.
const VO = phraseVo(
  'voiceovers/authority-history.mp3',
  [
    { text: 'This MC looks clean.', speech: [0.03, 1.73], gap: 0.15 }, // 0
    { text: 'Twelve years old.', speech: [2.23, 3.05], gap: 0.3 }, // 1
    { text: 'But it sat DEAD for over two years…', speech: [3.62, 5.83], gap: 0.4 }, // 2
    { text: 'and came back to life six months ago.', speech: [6.17, 8.07], gap: 0.15 }, // 3
    { text: 'Haulock reads the full authority history —', speech: [8.62, 10.45], gap: 0.4 }, // 4
    { text: 'and flags authority reactivated after a long gap.', speech: [10.82, 13.5], gap: 0.2 }, // 5
    { text: 'A common fraud pattern.', speech: [14.03, 15.05], gap: 0.35 }, // 6
    { text: 'See the history… before you book.', speech: [15.55, 17.25], gap: 0.35 }, // 7
    { text: 'Check any carrier free…', speech: [17.75, 18.93], gap: 0.5 }, // 8
    { text: 'at haulock.com.', speech: [19.2, 20.23], gap: 0.2 }, // 9
  ],
  20.48
);
const W = VO.at;

const SCREEN_IN = W(4) - 10;
const END = W(8) - 8;
export const AUTHORITY_HISTORY_DURATION = reelDuration(END, VO);
const M = marks.marks;
const SCROLL = 0.7;
const S = (f: number) => f - SCREEN_IN;
const FLAG = S(W(6)) - 2;
const CUTS: PhoneCut[] = [
  { at: 0, from: M.top.t - 0.6 }, // the report: CAUTION 35
  { at: 34, from: M.age.t + SCROLL + 0.02, punch: true }, // Authority age: 12y 4m · reactivated 6 months ago
  { at: S(W(5)) - 2, from: M.verdict.t + SCROLL + 0.02, punch: true }, // How we got 35/100: +30 authority recently reactivated
  { at: FLAG, from: M.flagTap.t - 0.75, punch: true }, // the red flag → tap → first granted / reactivated / inactive 2y 3m
];
const TAP = { at: FLAG + 22, x: M.flagTap.rect!.x + M.flagTap.rect!.w / 2, y: M.flagTap.rect!.y + M.flagTap.rect!.h / 2 };
const OPEN = FLAG + Math.round((M.flagOpen.t + 0.6 - (M.flagTap.t - 0.75)) * 30); // the open flag, scrolled into view

const CAPTIONS: CaptionChunk[] = [
  { layout: 'top', until: W(1) - 3, lines: [[{ text: 'This MC', at: 0 }], [{ text: 'looks clean.', at: 0, accent: 'serif', color: colors.greenGlow }]] },
  { layout: 'top', until: W(2) - 3, lines: [[{ text: 'Twelve', at: 1 }], [{ text: 'years old.', at: 1, accent: 'serif', color: colors.cream }]] },
  { layout: 'top', until: W(3) - 2, lines: [[{ text: 'But it sat dead', at: 2 }], [{ text: 'for 2+ years…', at: 2, accent: 'serif', color: colors.redGlow }]], glitchAt: W(2) + 8 },
  { layout: 'top', until: W(4) - 2, lines: [[{ text: 'and came back', at: 3 }], [{ text: '6 months ago.', at: 3, accent: 'serif', color: colors.orange }]] },
  { layout: 'top', until: W(5) - 2, lines: [[{ text: 'Haulock reads the full', at: 4 }], [{ text: 'authority history.', at: 4, accent: 'serif', color: colors.orange, size: 108 }]] },
  { layout: 'top', until: W(6) - 2, lines: [[{ text: 'And flags it:', at: 5 }], [{ text: 'reactivated.', at: 5, accent: 'serif', color: colors.redGlow }]] },
  { layout: 'top', until: W(7) - 2, lines: [[{ text: 'A common', at: 6 }], [{ text: 'fraud pattern.', at: 6, accent: 'serif', color: colors.redGlow }]] },
  { layout: 'top', until: END, lines: [[{ text: 'See the history', at: 7 }], [{ text: 'before you book.', at: 7, accent: 'serif', color: colors.orange }]] },
];

export const AuthorityHistory: React.FC = () => (
  <FeatureReel
    vo={VO}
    duration={AUTHORITY_HISTORY_DURATION}
    captions={CAPTIONS}
    hudTop="HAULOCK // AUTHORITY HISTORY"
    hook={{
      until: SCREEN_IN,
      node: (
        <HookCard
          clip="truck-fog"
          exitAt={SCREEN_IN}
          label="CARRIER · MC-118••• · IRONVALE FREIGHT LINES"
          title="12 years old"
          lines={['Authority: Active', 'Insurance: $1M on file']}
          stamp={{ text: 'LOOKS CLEAN', at: 34, color: colors.greenGlow }}
          swap={{ at: W(2) + 8, title: 'Dormant 2y 3m', lines: ['No active authority for 2y 3m', 'Reactivated Apr 2, 2026'], color: colors.redGlow }}
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
              src="recordings/report-authority.mp4"
              css={{ w: 430, h: 880 }}
              screenW={700}
              top={590}
              cuts={CUTS}
              until={END - SCREEN_IN}
              taps={[TAP]}
              boxes={[
                { from: 40, until: S(W(5)) - 4, x: 40, y: 312, w: 350, h: 50, color: colors.red },
                { from: S(W(5)) + 4, until: FLAG - 2, x: 48, y: 506, w: 340, h: 32, color: colors.red },
                { from: OPEN + 2, until: END - SCREEN_IN, x: 66, y: 302, w: 300, h: 158, color: colors.red },
              ]}
            />
            <Sequence from={S(W(5)) + 20} durationInFrames={FLAG - S(W(5)) - 22}>
              <Stamp big="+30" small={['RED', 'FLAG']} color={colors.red} top={1690} />
            </Sequence>
            <Sequence from={S(W(7)) + 4}>
              <Stamp big="2y 3m" small={['NO ACTIVE', 'AUTHORITY']} color={colors.red} top={1690} />
            </Sequence>
          </>
        ),
      },
    ]}
    end={{
      at: END,
      urlAt: W(9),
      chip: 'AUTHORITY HISTORY · REACTIVATION FLAG',
      headline: [
        [{ text: 'Check any', at: 8 }],
        [{ text: 'carrier', at: 8 }, { text: 'free.', at: 8, accent: true }],
      ],
      checks: ['Free plan included', 'No credit card'],
      hud: { topLeft: 'HAULOCK.COM', bottomLeft: 'AUTHORITY HISTORY', bottomRight: '3 FREE LOOKUPS / MO' },
    }}
    music={{ src: 'music/epical-drums-04.mp3', bed: [[0, 30], [0.24, 0.24]], swell: 0.5 }}
    sfx={[
      { src: 'sfx/beep.mp3', at: 33, volume: 0.22 },
      { src: 'sfx/glitch-b.mp3', at: W(2) + 7, volume: 0.32 },
      { src: 'sfx/impact.mp3', at: W(2) + 8, volume: 0.24 },
      { src: 'sfx/beep.mp3', at: SCREEN_IN, volume: 0.25 },
      { src: 'sfx/scan.mp3', at: SCREEN_IN + 32, volume: 0.35 },
      { src: 'sfx/impact.mp3', at: W(5) + 19, volume: 0.24 },
      { src: 'sfx/beep.mp3', at: SCREEN_IN + TAP.at, volume: 0.22 },
      { src: 'sfx/impact.mp3', at: W(7) + 3, volume: 0.22 },
    ]}
    hits={[
      { at: 34, flash: 0.14, color: colors.green },
      { at: W(2) + 8, glitch: 12, flash: 0.22, color: colors.red, shake: 12 },
      { at: SCREEN_IN, glitch: 6, flash: 0.14 },
      { at: W(5) + 20, flash: 0.18, color: colors.red, shake: 8 },
      { at: W(7) + 4, flash: 0.14, color: colors.red, shake: 6 },
    ]}
  />
);
