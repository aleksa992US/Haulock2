import React from 'react';
import { Sequence } from 'remotion';
import { type PhoneCut, PhoneRecording } from '../components/AppScreen';
import { FeatureReel, HookCard, Stamp, phraseVo, reelDuration } from '../components/FeatureReel';
import type { CaptionChunk } from '../components/Captions';
import marks from '../../public/recordings/company.marks.json';
import { colors } from '../theme';

// ~18 s reel: "Your company" (scripts/record-reports.mjs, take "company") — your own Haulock
// score, how often you're checked on Haulock (counts only, never who) and the daily FMCSA
// watch on your record. Example data (scripts/examples.mjs COMPANY, OWN_SCORE).

// Take A (Desmond, eleven_v4), cut at its measured pauses; one entry per phrase.
const VO = phraseVo(
  'voiceovers/whos-checking.mp3',
  [
    { text: 'Brokers are looking up your MC.', speech: [0.03, 2.0], gap: 0.15 }, // 0
    { text: 'How OFTEN?', speech: [2.48, 3.05], gap: 0.3 }, // 1
    { text: 'Claim your company on Haulock…', speech: [3.42, 4.75], gap: 0.4 }, // 2
    { text: 'and see it,', speech: [5.15, 5.62], gap: 0.3 }, // 3
    { text: 'week by week.', speech: [5.85, 6.53], gap: 0.12 }, // 4
    { text: 'Counts only —', speech: [7.05, 7.6], gap: 0.35 }, // 5
    { text: 'never who.', speech: [7.88, 8.5], gap: 0.15 }, // 6
    { text: 'Plus a daily watch on your own FMCSA record.', speech: [8.88, 11.82], gap: 0.35 }, // 7
    { text: 'Know what brokers see…', speech: [12.22, 13.43], gap: 0.35 }, // 8
    { text: 'before they call.', speech: [13.62, 14.45], gap: 0.12 }, // 9
    { text: 'Included on paid plans…', speech: [14.85, 15.93], gap: 0.5 }, // 10
    { text: 'at haulock.com.', speech: [16.35, 17.4], gap: 0.2 }, // 11
  ],
  17.68
);
const W = VO.at;

const SCREEN_IN = W(2) - 10;
const END = W(10) - 8;
export const WHOS_CHECKING_DURATION = reelDuration(END, VO);
const M = marks.marks;
const SCROLL = 0.7;
const S = (f: number) => f - SCREEN_IN;
const CUTS: PhoneCut[] = [
  { at: 0, from: M.tap.t - 0.7 }, // dashboard → "Score, monitoring & who's checking"
  { at: S(W(3)) - 2, from: M.checks.t + SCROLL + 0.02, punch: true }, // 23 checks, week by week · FMCSA monitoring
  { at: S(W(8)) - 2, from: M.open.t + 0.05, punch: true }, // your score, as brokers see it
];
const TAP = { at: 21, x: M.tap.rect!.x + M.tap.rect!.w / 2, y: M.tap.rect!.y + M.tap.rect!.h / 2 };

const CAPTIONS: CaptionChunk[] = [
  { layout: 'top', until: W(1) - 3, lines: [[{ text: 'Brokers are looking up', at: 0 }], [{ text: 'your MC.', at: 0, accent: 'serif', color: colors.orange }]] },
  { layout: 'top', until: W(2) - 3, lines: [[{ text: 'How', at: 1 }], [{ text: 'often?', at: 1, accent: 'serif', color: colors.orange }]] },
  { layout: 'top', until: W(3) - 2, lines: [[{ text: 'Claim your company', at: 2 }], [{ text: 'on Haulock.', at: 2, accent: 'serif', color: colors.orange }]] },
  { layout: 'top', until: W(5) - 2, lines: [[{ text: 'See it,', at: 3 }], [{ text: 'week by week.', at: 4, accent: 'serif', color: colors.orange }]] },
  { layout: 'top', until: W(7) - 2, lines: [[{ text: 'Counts only —', at: 5 }], [{ text: 'never who.', at: 6, accent: 'serif', color: colors.cream }]] },
  { layout: 'top', until: W(8) - 2, lines: [[{ text: 'Plus a daily watch on', at: 7 }], [{ text: 'your FMCSA record.', at: 7, accent: 'serif', color: colors.orange, size: 104 }]] },
  { layout: 'top', until: END, lines: [[{ text: 'Know what brokers see', at: 8 }], [{ text: 'before they call.', at: 9, accent: 'serif', color: colors.orange }]] },
];

export const WhosChecking: React.FC = () => (
  <FeatureReel
    vo={VO}
    duration={WHOS_CHECKING_DURATION}
    captions={CAPTIONS}
    hudTop="HAULOCK // YOUR COMPANY"
    hook={{
      until: SCREEN_IN,
      node: (
        <HookCard
          clip="trucker"
          exitAt={SCREEN_IN}
          label="YOUR COMPANY · KEYSTONE FREIGHT NETWORK"
          title="MC-847•••"
          lines={['Looked up by brokers', 'before they tender a load']}
          stamp={{ text: 'HOW OFTEN?', at: W(1) + 2, color: colors.orange }}
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
              src="recordings/company.mp4"
              css={{ w: 430, h: 880 }}
              screenW={700}
              top={590}
              cuts={CUTS}
              until={END - SCREEN_IN}
              taps={[TAP]}
              boxes={[
                { from: S(W(3)) + 2, until: S(W(5)) - 2, x: 36, y: 122, w: 358, h: 118 },
                { from: S(W(5)), until: S(W(7)) - 2, x: 36, y: 300, w: 358, h: 40, color: colors.cream },
                { from: S(W(7)), until: S(W(8)) - 2, x: 36, y: 356, w: 358, h: 200, color: colors.greenGlow },
              ]}
            />
            <Sequence from={S(W(4)) + 2} durationInFrames={W(5) - W(4) - 2}>
              <Stamp big="23" small={['CHECKS', 'LAST 30 DAYS']} color={colors.navy} top={1690} />
            </Sequence>
            <Sequence from={S(W(7)) + 8} durationInFrames={W(8) - W(7) - 10}>
              <Stamp big="Daily" small={['FMCSA', 'WATCH: ON']} color={colors.green} top={1690} />
            </Sequence>
            <Sequence from={S(W(9))}>
              <Stamp big="12/100" small={['YOUR SCORE', 'LOW RISK']} color={colors.green} top={1690} />
            </Sequence>
          </>
        ),
      },
    ]}
    end={{
      at: END,
      urlAt: W(11),
      chip: "YOUR COMPANY · WHO'S CHECKING · MONITORING",
      headline: [
        [{ text: 'Included on', at: 10 }],
        [{ text: 'paid', at: 10 }, { text: 'plans.', at: 10, accent: true }],
      ],
      checks: ['Counts only, never who', 'Daily FMCSA monitoring'],
      hud: { topLeft: 'HAULOCK.COM', bottomLeft: 'YOUR COMPANY', bottomRight: 'PAID PLANS' },
    }}
    music={{ src: 'music/games-music.mp3', bed: [[0, 30], [0.11, 0.11]], swell: 0.3 }}
    sfx={[
      { src: 'sfx/impact.mp3', at: W(1) + 1, volume: 0.22 },
      { src: 'sfx/beep.mp3', at: SCREEN_IN, volume: 0.25 },
      { src: 'sfx/beep.mp3', at: SCREEN_IN + TAP.at, volume: 0.22 },
      { src: 'sfx/scan.mp3', at: W(3) - 4, volume: 0.35 },
      { src: 'sfx/impact.mp3', at: W(4) + 3, volume: 0.2 },
      { src: 'sfx/beep.mp3', at: W(6), volume: 0.22 },
      { src: 'sfx/beep.mp3', at: W(7) + 8, volume: 0.22 },
      { src: 'sfx/impact.mp3', at: W(9) + 1, volume: 0.22 },
    ]}
    hits={[
      { at: W(1) + 2, glitch: 10, flash: 0.2, color: colors.orange, shake: 10 },
      { at: SCREEN_IN, glitch: 6, flash: 0.14 },
      { at: W(3) - 2, glitch: 6 },
      { at: W(4) + 4, flash: 0.14, shake: 6 },
      { at: W(9) + 2, flash: 0.16, color: colors.green, shake: 6 },
    ]}
  />
);
