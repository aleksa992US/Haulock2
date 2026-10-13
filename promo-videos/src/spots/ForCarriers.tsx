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
import { WatchlistPanel } from '../components/WatchlistPanel';
import { makeVo } from '../vo';
import words from '../../public/voiceovers/for-carriers.words.json';
import { colors, fonts } from '../theme';

// ~19.5 s reel for carriers checking a broker before taking the load: enter the broker's MC →
// 14 data sources → take the load / walk away → watchlist re-checks daily.
export const CARRIERS_DURATION = 585;

// for-carriers.wav = the take up to "daily." plus a separate "Try for free… at haulock.com."
// take from 16.4 s (level-matched). Word indices: 0 Hey 1 carriers. 2 Before 3 you 4 hook
// 5 that 6 trailer, 7 check 8 the 9 broker. 10 Type 11 in 12 the 13 MC. 14 Haulock
// 15 cross-checks 16 14 17 data 18 sources: 19 authority, 20 surety 21 bond, 22 address,
// 23 website. 24 Take 25 the 26 load 27 or 28 walk 29 away. 30 Watchlist 31 re-checks
// 32 them 33 daily. 34 Try 35 for 36 free 37 at 38 haulock.com.
const VO = makeVo(
  'voiceovers/for-carriers.wav',
  words,
  [
    { speech: [0.1, 0.96], gap: 0.15 }, // Hey carriers.
    { speech: [1.28, 2.72], gap: 0.22 }, // Before you hook that trailer,
    { speech: [3.28, 4.08], gap: 0.25 }, // check the broker.
    { speech: [4.52, 5.64], gap: 0.22 }, // Type in the MC.
    { speech: [6.05, 8.5], gap: 0.25 }, // Haulock cross-checks 14 data sources:
    { speech: [8.84, 11.72], gap: 0.18 }, // authority, surety bond, address, website.
    { speech: [12.12, 12.76], gap: 0.25 }, // Take the load
    { speech: [13.08, 13.92], gap: 0.3 }, // or walk away.
    { speech: [14.4, 16.0], gap: 0.8 }, // Watchlist re-checks them daily. (WALK AWAY holds)
    { speech: [16.43, 17.17], gap: 0.9 }, // Try for free (alert email holds)
    { speech: [17.48, 18.72], gap: 0.2 }, // at haulock.com.
  ],
  19.12
);
const W = VO.at;

const RADAR = W(14) - 5; // "Haulock cross-checks 14 data sources"
const SCORE = W(24) - 8; // "Take the load"
const WALK = W(28);
const WATCH = W(30) - 6; // "Watchlist re-checks them daily."
const ALERT = W(32);
const END = W(34) - 8; // "Try for free"
const URL = W(38);

const CAPTIONS: CaptionChunk[] = [
  { layout: 'hero', until: W(2) - 3, lines: [[{ text: 'Hey,', at: 0 }, { text: 'carriers.', at: 1, accent: 'serif', color: colors.orange }]] },
  {
    layout: 'hero',
    until: W(7) - 3,
    lines: [
      [{ text: 'Before', at: 2 }, { text: 'you', at: 3 }, { text: 'hook', at: 4 }],
      [{ text: 'that', at: 5 }, { text: 'trailer,', at: 6 }],
    ],
  },
  { layout: 'hero', until: W(10) - 3, lines: [[{ text: 'check', at: 7 }], [{ text: 'the', at: 8 }, { text: 'broker.', at: 9, accent: 'serif', color: colors.orange }]] },
  { layout: 'hero', until: RADAR, lines: [[{ text: 'type', at: 10 }, { text: 'in', at: 11 }], [{ text: 'the', at: 12 }, { text: 'MC.', at: 13 }]] },
  {
    layout: 'top',
    until: W(19) - 3,
    lines: [[{ text: 'Haulock', at: 14 }, { text: 'cross-checks', at: 15 }], [{ text: '14 data sources', at: 16, accent: 'serif', color: colors.orange, size: 140 }]],
  },
  {
    layout: 'top',
    until: W(22) - 3,
    lines: [[{ text: 'authority,', at: 19 }], [{ text: 'surety bond,', at: 20, accent: 'serif', color: colors.cream, size: 124 }]],
  },
  {
    layout: 'top',
    until: SCORE,
    lines: [[{ text: 'address,', at: 22 }], [{ text: 'website.', at: 23, accent: 'serif', color: colors.cream }]],
  },
  {
    layout: 'top',
    until: WATCH,
    glitchAt: WALK,
    lines: [[{ text: 'Take the load', at: 24, accent: 'serif', color: colors.greenGlow, size: 120 }], [{ text: 'or', at: 27 }, { text: 'walk away.', at: 28, accent: 'serif', color: colors.redGlow, size: 120 }]],
  },
  {
    layout: 'top',
    until: END,
    lines: [[{ text: 'Watchlist', at: 30 }, { text: 're-checks', at: 31 }], [{ text: 'them', at: 32 }, { text: 'daily.', at: 33, accent: 'serif', color: colors.orange }]],
  },
];

export const ForCarriers: React.FC = () => {
  const frame = useCurrentFrame();
  const jolt = shake(frame, WALK, 16) + shake(frame, ALERT, 9);
  return (
    <AbsoluteFill style={{ backgroundColor: colors.void, fontFamily: fonts.sans }}>
      <AbsoluteFill style={{ transform: `translate(${jolt}px, ${jolt * 0.6}px)` }}>
        <Background />
        <Sequence durationInFrames={RADAR + 6}>
          <SearchHook clip="highway-pov" exitAt={RADAR} typeAt={W(10)} submitAt={W(13) + 6} query="MC-612•••" />
        </Sequence>
        <Sequence from={RADAR} durationInFrames={SCORE - RADAR + 6}>
          <SourcesRadar
            start={W(15) - RADAR}
            end={W(18) + 6 - RADAR}
            focus={[
              { index: 0, at: W(19) - RADAR },
              { index: 2, at: W(19) - RADAR },
              { index: 1, at: W(20) - RADAR },
              { index: 4, at: W(22) - RADAR },
              { index: 8, at: W(23) - RADAR },
              { index: 6, at: W(23) - RADAR },
            ]}
          />
          <div style={{ position: 'absolute', left: 0, right: 0, top: 1478, display: 'flex', justifyContent: 'center' }}>
            <StepTag n="02" label="14 DATA SOURCES IN PARALLEL" />
          </div>
        </Sequence>
        <Sequence from={SCORE} durationInFrames={WATCH - SCORE + 6}>
          <VerdictCard
            scoreAt={6}
            bookAt={W(24) - SCORE}
            walkAt={WALK - SCORE}
            lookup="BROKER LOOKUP · MC-612••• · DOT-3271•••"
            good={{ title: 'TAKE THIS LOAD', detail: 'Clean across all 14 sources · bond on file' }}
            bad={{ title: 'WALK AWAY', detail: 'Lookalike email · authority only 3 weeks old' }}
            share="Share with dispatch ↗"
          />
        </Sequence>
        <Sequence from={WATCH} durationInFrames={END - WATCH + 8}>
          <WatchlistPanel sweepAt={W(31) - WATCH} alertAt={ALERT - WATCH} />
        </Sequence>
        <Sequence durationInFrames={END}>
          <HudFrame topLeft="HAULOCK // BROKER VETTING" bottomLeft="FOR CARRIERS" bottomRight="14 DATA SOURCES" />
        </Sequence>
        <Captions vo={VO} chunks={CAPTIONS} />
        <Scanlines opacity={0.9} />
      </AbsoluteFill>

      <Sequence from={END}>
        <EndCard
          vo={VO}
          from={END}
          urlAt={URL - END}
          chip="VERIFY BROKERS · 14 DATA SOURCES"
          headline={[[{ text: 'Try', at: 34 }, { text: 'for', at: 35 }], [{ text: 'free!', at: 36, accent: true }]]}
          checks={['3 free lookups a month', 'No credit card']}
          hud={{ topLeft: 'HAULOCK.COM', bottomLeft: 'FOR CARRIERS', bottomRight: '14 DATA SOURCES' }}
        />
      </Sequence>

      <GlitchBars at={WALK} dur={12} />
      <GlitchBars at={WATCH} dur={6} />
      <GlitchBars at={ALERT} dur={8} />
      <GlitchBars at={END - 2} dur={8} />
      <Flash at={RADAR} strength={0.15} />
      <Flash at={W(24)} color={colors.green} strength={0.18} />
      <Flash at={WALK} color={colors.red} strength={0.35} dur={10} />
      <Flash at={ALERT} color={colors.orange} strength={0.2} />

      <VoTrack vo={VO} />
      <Music src="music/epical-drums-06.mp3" startAt={1.0} voEnd={VO.end} duration={CARRIERS_DURATION} bed={0.31} swell={0.65} />
      <Sfx src="sfx/riser.mp3" at={W(13) + 6 - 21} volume={0.4} />
      <Sfx src="sfx/beep.mp3" at={W(13) + 6} volume={0.3} />
      <Sfx src="sfx/scan.mp3" at={RADAR + 2} volume={0.5} />
      <Sfx src="sfx/beep.mp3" at={W(18) + 6} volume={0.3} />
      <Sfx src="sfx/beep.mp3" at={W(24)} volume={0.25} />
      <Sfx src="sfx/glitch-b.mp3" at={WALK - 1} volume={0.45} />
      <Sfx src="sfx/impact.mp3" at={WALK - 1} volume={0.22} />
      <Sfx src="sfx/glitch-a.mp3" at={ALERT - 1} volume={0.3} />
      <Sfx src="sfx/beep.mp3" at={ALERT + 6} volume={0.28} />
      <Sfx src="sfx/glitch-b.mp3" at={END - 2} volume={0.32} />
      <Sfx src="sfx/impact.mp3" at={URL - 1} volume={0.18} />
    </AbsoluteFill>
  );
};
