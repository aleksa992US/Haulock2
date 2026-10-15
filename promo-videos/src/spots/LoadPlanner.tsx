import React from 'react';
import { Sequence } from 'remotion';
import { type PhoneCut, PhoneRecording } from '../components/AppScreen';
import { FeatureReel, HookCard, Stamp, phraseVo } from '../components/FeatureReel';
import type { CaptionChunk } from '../components/Captions';
import marks from '../../public/recordings/load-planner.marks.json';
import { colors } from '../theme';

// ~19 s reel: the real load planner (scripts/record-planner.mjs) — Gary, IN → Joliet, IL →
// Dallas, TX at $2,400, driver $0.65/mile, diesel typed in at $3.85.
export const LOAD_PLANNER_DURATION = 570;

// Take A (Desmond, eleven_v4), cut at its measured pauses; one entry per phrase.
const VO = phraseVo(
  'voiceovers/load-planner.mp3',
  [
    { text: 'Is this load actually worth it?', speech: [0.03, 1.8], gap: 0.15 }, // 0
    { text: 'Type in the pickup and delivery…', speech: [2.33, 3.58], gap: 0.3 }, // 1
    { text: 'Haulock plans the truck route.', speech: [4.08, 5.42], gap: 0.75 }, // 2 (typing finishes)
    { text: 'Empty miles.', speech: [5.88, 6.4], gap: 0.2 }, // 3
    { text: 'Loaded miles.', speech: [6.92, 7.42], gap: 0.15 }, // 4
    { text: 'Drive time —', speech: [8.0, 8.45], gap: 0.25 }, // 5
    { text: 'with your ten-hour breaks.', speech: [8.78, 10.03], gap: 0.1 }, // 6
    { text: 'Add the rate,', speech: [10.4, 10.95], gap: 0.35 }, // 7
    { text: "your driver's pay and fuel…", speech: [11.2, 12.57], gap: 0.12 }, // 8
    { text: "and see what's really left —", speech: [12.82, 13.97], gap: 0.3 }, // 9
    { text: 'and your break-even rate per mile.', speech: [14.43, 15.93], gap: 0.15 }, // 10
    { text: 'Plan ten loads a month free…', speech: [16.4, 17.82], gap: 0.6 }, // 11
    { text: 'at haulock.com.', speech: [18.15, 19.23], gap: 0.15 }, // 12
  ],
  19.44
);
const W = VO.at;

const SCREEN_IN = W(1) - 12;
const END = W(11) - 8;
const M = marks.marks;
const SCROLL = 0.7;
const S = (f: number) => f - SCREEN_IN;
const REC = { src: 'recordings/load-planner.mp4', css: { w: 430, h: 880 } };
const CUTS: PhoneCut[] = [
  { at: 0, from: M.pickup.t - 0.1 }, // typing "Joliet" → suggestions
  { at: 39, from: M.delivery.t }, // typing "Dallas" → suggestions
  { at: S(W(2)) - 2, from: M.map.t + SCROLL, punch: true }, // the truck route: 44 mi empty · 927 mi loaded · 15h 10m
  { at: S(W(5)) - 2, from: M.map.t + SCROLL }, // (the map again: its chips show the drive time)
  { at: S(W(7)) - 2, from: M.profit.t + SCROLL, punch: true }, // what's left after costs
  { at: S(W(9)) - 2, from: M.profit.t + SCROLL }, // (same card, held longer than one take of it)
];

const CAPTIONS: CaptionChunk[] = [
  { layout: 'top', until: W(1) - 3, lines: [[{ text: 'Is this load', at: 0 }], [{ text: 'worth it?', at: 0, accent: 'serif', color: colors.orange }]] },
  { layout: 'top', until: W(2) - 3, lines: [[{ text: 'Type in the', at: 1 }], [{ text: 'pickup & delivery.', at: 1, accent: 'serif', color: colors.orange, size: 108 }]] },
  { layout: 'top', until: W(3) - 2, lines: [[{ text: 'Haulock plans', at: 2 }], [{ text: 'the truck route.', at: 2, accent: 'serif', color: colors.orange, size: 120 }]] },
  { layout: 'top', until: W(5) - 2, lines: [[{ text: 'Empty miles.', at: 3 }], [{ text: 'Loaded miles.', at: 4, accent: 'serif', color: colors.cream, size: 130 }]] },
  { layout: 'top', until: W(7) - 2, lines: [[{ text: 'Drive time', at: 5 }], [{ text: 'with 10-hr breaks.', at: 6, accent: 'serif', color: colors.orange, size: 112 }]] },
  { layout: 'top', until: W(9) - 2, lines: [[{ text: 'Add the rate,', at: 7 }], [{ text: 'driver pay & fuel…', at: 8, accent: 'serif', color: colors.orange, size: 112 }]] },
  { layout: 'top', until: W(10) - 2, lines: [[{ text: "See what's", at: 9 }], [{ text: 'really left.', at: 9, accent: 'serif', color: colors.greenGlow }]] },
  { layout: 'top', until: END, lines: [[{ text: 'and your', at: 10 }], [{ text: 'break-even.', at: 10, accent: 'serif', color: colors.orange }]] },
];

export const LoadPlanner: React.FC = () => (
  <FeatureReel
    vo={VO}
    duration={LOAD_PLANNER_DURATION}
    captions={CAPTIONS}
    hudTop="HAULOCK // LOAD PLANNER"
    hook={{
      until: SCREEN_IN,
      node: (
        <HookCard
          clip="sunset-drive"
          exitAt={SCREEN_IN}
          label="LOAD OFFER · 53' DRY VAN"
          title="$2,400"
          lines={['Joliet, IL → Dallas, TX', 'Truck sitting in Gary, IN']}
          stamp={{ text: 'WORTH IT?', at: 34, color: colors.orange }}
        />
      ),
    }}
    scenes={[
      {
        from: SCREEN_IN,
        until: END,
        node: (
          <>
            <PhoneRecording src={REC.src} css={REC.css} screenW={700} top={590} cuts={CUTS} until={END - SCREEN_IN} taps={[]} />
            <Sequence from={S(W(3)) + 2} durationInFrames={W(4) - W(3)}>
              <Stamp big="44 mi" small={['EMPTY', 'TO PICKUP']} color={colors.navy} top={1380} />
            </Sequence>
            <Sequence from={S(W(4)) + 2} durationInFrames={W(5) - W(4)}>
              <Stamp big="927 mi" small={['LOADED']} color={colors.orange} top={1380} />
            </Sequence>
            <Sequence from={S(W(6)) + 2} durationInFrames={W(7) - W(6) - 2}>
              <Stamp big="15h 10m" small={['DRIVING +', '10-HR BREAK']} color={colors.navy} top={1380} />
            </Sequence>
            <Sequence from={S(W(9)) + 6} durationInFrames={W(10) - W(9)}>
              <Stamp big="$1,194" small={['LEFT AFTER', 'COSTS']} color={colors.green} top={1380} />
            </Sequence>
            <Sequence from={S(W(10)) + 4}>
              <Stamp big="$1.24/mi" small={['BREAK-', 'EVEN']} color={colors.navy} top={1380} />
            </Sequence>
          </>
        ),
      },
    ]}
    end={{
      at: END,
      urlAt: W(12),
      chip: 'LOAD PLANNER · TRUCK ROUTES · PROFIT',
      headline: [
        [{ text: 'Plan 10 loads', at: 11 }],
        [{ text: 'a month', at: 11 }, { text: 'free.', at: 11, accent: true }],
      ],
      checks: ['Free plan included', 'No credit card'],
      hud: { topLeft: 'HAULOCK.COM', bottomLeft: 'LOAD PLANNER', bottomRight: '10 FREE PLANS / MO' },
    }}
    music={{ src: 'music/driving-ambition.mp3', bed: [[0, 30], [0.19, 0.19]], swell: 0.45 }}
    sfx={[
      { src: 'sfx/impact.mp3', at: 33, volume: 0.22 },
      { src: 'sfx/beep.mp3', at: SCREEN_IN, volume: 0.25 },
      { src: 'sfx/scan.mp3', at: W(2) - 4, volume: 0.4 },
      { src: 'sfx/beep.mp3', at: W(3) + 2, volume: 0.22 },
      { src: 'sfx/beep.mp3', at: W(4) + 2, volume: 0.22 },
      { src: 'sfx/beep.mp3', at: W(6) + 2, volume: 0.22 },
      { src: 'sfx/beep.mp3', at: W(7) - 2, volume: 0.22 },
      { src: 'sfx/impact.mp3', at: W(9) + 5, volume: 0.24 },
      { src: 'sfx/impact.mp3', at: W(10) + 3, volume: 0.2 },
    ]}
    hits={[
      { at: 34, glitch: 10, flash: 0.2, color: colors.orange, shake: 10 },
      { at: SCREEN_IN, glitch: 6, flash: 0.14 },
      { at: W(2) - 2, glitch: 6 },
      { at: W(9) + 6, flash: 0.18, color: colors.green, shake: 8 },
    ]}
  />
);
