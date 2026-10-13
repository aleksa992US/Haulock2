import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion';
import { Music, Sfx, VoTrack } from '../components/audio';
import { Background } from '../components/Background';
import { Captions, type CaptionChunk } from '../components/Captions';
import { EndCard } from '../components/EndCard';
import { Flash, GlitchBars, HudFrame, Scanlines, shake } from '../components/fx';
import { ScannerHook } from '../components/hook';
import { PriceBoard } from '../components/PriceBoard';
import { makeVo } from '../vo';
import words from '../../public/voiceovers/broker-pricing.words.json';
import { colors, fonts } from '../theme';

// ~17.5 s reel for brokers comparing the published entry prices of carrier-vetting tools.
// Competitor prices: lowest published monthly price on each vendor's pricing page,
// checked 12 Oct 2026 (sources in REELS.md). Re-check before publishing.
export const PRICING_DURATION = 525;

// Shown on the Haulock row. lib/plans.ts: Carrier $49 (labelled for owner-ops),
// Team $99, Fleet $249 (labelled "growing carriers & brokerages").
const HAULOCK_PAID_FROM = '$49';

// Word indices: 0 Hey, 1 brokers. 2 What 3 are 4 you 5 paying 6 for 7 carrier 8 vetting?
// 9 Some 10 platforms 11 start 12 at 13 $515 14 a 15 month. 16 Others 17 charge 18 $340,
// 19 $149, 20 $99. 21 Haulock? 22 Start 23 free 24 with 25 14 26 data 27 sources 28 on
// 29 every 30 lookup. 31 haulock.com.
const VO = makeVo(
  'voiceovers/broker-pricing.mp3',
  words,
  [
    { speech: [0.0, 0.8], gap: 0.2 }, // Hey, brokers.
    { speech: [1.3, 3.0], gap: 0.3 }, // What are you paying for carrier vetting?
    { speech: [3.65, 6.5], gap: 0.35 }, // Some platforms start at $515 a month.
    { speech: [7.05, 8.3], gap: 0.3 }, // Others charge $340,
    { speech: [8.7, 9.45], gap: 0.2 }, // $149,
    { speech: [9.85, 10.35], gap: 0.2 }, // $99.
    { speech: [10.95, 11.35], gap: 0.4 }, // Haulock?
    { speech: [11.85, 15.1], gap: 0.3 }, // Start free with 14 data sources on every lookup.
    { speech: [15.65, 16.45], gap: 0.35 }, // haulock.com.
  ],
  16.72
);
const W = VO.at;

const ALERT = W(5); // "paying"
const BOARD = W(9) - 5;
const FREE = W(23);
const END = W(31) - 8;
const URL = W(31);

const CAPTIONS: CaptionChunk[] = [
  { layout: 'hero', until: W(2) - 3, lines: [[{ text: 'Hey,', at: 0 }, { text: 'brokers.', at: 1, accent: 'serif', color: colors.orange }]] },
  {
    layout: 'hero',
    until: W(6) - 3,
    glitchAt: ALERT,
    lines: [[{ text: 'What', at: 2 }, { text: 'are', at: 3 }, { text: 'you', at: 4 }], [{ text: 'paying', at: 5, accent: 'serif', color: colors.orange }]],
  },
  { layout: 'hero', until: BOARD, lines: [[{ text: 'for', at: 6 }, { text: 'carrier', at: 7 }], [{ text: 'vetting?', at: 8 }]] },
  {
    layout: 'top',
    until: W(16) - 3,
    lines: [[{ text: 'Some', at: 9 }, { text: 'platforms', at: 10 }, { text: 'start', at: 11 }, { text: 'at', at: 12 }], [{ text: '$515/mo', at: 13, accent: 'money', color: colors.redGlow }]],
  },
  {
    layout: 'top',
    until: W(21) - 3,
    lines: [
      [{ text: 'Others', at: 16 }, { text: 'charge', at: 17 }],
      [
        { text: '$340', at: 18, accent: 'serif', color: colors.redGlow, size: 120 },
        { text: '$149', at: 19, accent: 'serif', color: colors.redGlow, size: 120 },
        { text: '$99', at: 20, accent: 'serif', color: colors.redGlow, size: 120 },
      ],
    ],
  },
  {
    layout: 'top',
    until: W(24) - 3,
    lines: [[{ text: 'Haulock?', at: 21 }], [{ text: 'Start', at: 22, accent: 'serif', color: colors.cream }, { text: 'free.', at: 23, accent: 'serif', color: colors.orange }]],
  },
  {
    layout: 'top',
    until: W(28) - 3,
    lines: [[{ text: 'with', at: 24 }], [{ text: '14 data sources', at: 25, accent: 'serif', color: colors.orange, size: 140 }]],
  },
  {
    layout: 'top',
    until: END,
    lines: [[{ text: 'on', at: 28 }, { text: 'every', at: 29 }], [{ text: 'lookup.', at: 30, accent: 'serif', color: colors.cream }]],
  },
];

export const BrokerPricing: React.FC = () => {
  const frame = useCurrentFrame();
  const jolt = shake(frame, ALERT) + shake(frame, FREE, 10);
  return (
    <AbsoluteFill style={{ backgroundColor: colors.void, fontFamily: fonts.sans }}>
      <AbsoluteFill style={{ transform: `translate(${jolt}px, ${jolt * 0.6}px)` }}>
        <Background />
        <Sequence durationInFrames={BOARD + 6}>
          <ScannerHook clip="aerial-traffic" exitAt={BOARD} alertAt={ALERT} label="PRICE CHECK ▸ CARRIER VETTING" alertLabel="$ COMPARING 6 PLATFORMS" />
        </Sequence>
        <Sequence from={BOARD} durationInFrames={END - BOARD + 8}>
          <PriceBoard
            rows={[
              { name: 'MyCarrierPortal', by: 'Descartes', price: 515, at: W(13) - BOARD },
              { name: 'RMIS Lite', by: 'Truckstop', price: 340, at: W(18) - BOARD },
              { name: 'DAT CarrierWatch', by: 'DAT', price: 149, at: W(19) - BOARD },
              { name: 'Carrier Assure', by: 'Premium', price: 149, at: W(19) - BOARD + 4 },
              { name: 'Carrier Hub', by: 'Truckstop', price: 99, at: W(20) - BOARD },
              { name: 'Carrier411', by: '', price: 99, at: W(20) - BOARD + 4 },
            ]}
            haulockAt={W(21) - BOARD}
            freeAt={FREE - BOARD}
            sourcesAt={W(25) - BOARD}
            paidFrom={HAULOCK_PAID_FROM}
            disclaimer="Lowest published monthly price on each vendor’s website, checked Oct 2026. Plans, users and features differ. Haulock free plan: 3 lookups / month."
          />
        </Sequence>
        <Sequence durationInFrames={END}>
          <HudFrame topLeft="HAULOCK // PRICE CHECK" bottomLeft="FOR BROKERS" bottomRight="14 DATA SOURCES" />
        </Sequence>
        <Captions vo={VO} chunks={CAPTIONS} />
        <Scanlines opacity={0.9} />
      </AbsoluteFill>

      <Sequence from={END}>
        <EndCard
          vo={VO}
          from={END}
          urlAt={URL - END}
          chip="FREE PLAN · NO CREDIT CARD"
          headline={[[{ text: 'Vet', at: 31 }, { text: 'carriers', at: 31 }], [{ text: 'free.', at: 31, accent: true }]]}
          checks={['14 data sources', 'Official FMCSA data']}
          hud={{ topLeft: 'HAULOCK.COM', bottomLeft: 'FOR BROKERS', bottomRight: '14 DATA SOURCES' }}
        />
      </Sequence>

      <GlitchBars at={ALERT} dur={12} />
      <GlitchBars at={END - 2} dur={8} />
      <Flash at={ALERT} color={colors.orange} strength={0.22} />
      <Flash at={BOARD} strength={0.15} />
      <Flash at={FREE} color={colors.orange} strength={0.3} dur={10} />

      <VoTrack vo={VO} />
      <Music src="music/epical-drums-03.mp3" startAt={2.9} voEnd={VO.end} duration={PRICING_DURATION} />
      <Sfx src="sfx/riser.mp3" at={ALERT - 21} volume={0.45} />
      <Sfx src="sfx/glitch-b.mp3" at={ALERT - 1} volume={0.5} />
      <Sfx src="sfx/beep.mp3" at={W(13)} volume={0.25} />
      <Sfx src="sfx/beep.mp3" at={W(20)} volume={0.25} />
      <Sfx src="sfx/impact.mp3" at={FREE - 1} volume={0.2} />
      <Sfx src="sfx/glitch-b.mp3" at={END - 2} volume={0.32} />
      <Sfx src="sfx/impact.mp3" at={URL - 1} volume={0.18} />
    </AbsoluteFill>
  );
};
