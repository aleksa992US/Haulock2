import React from 'react';
import { Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { type PhoneCut, PhoneRecording } from '../components/AppScreen';
import { FeatureReel, HookCard, Stamp, phraseVo, reelDuration } from '../components/FeatureReel';
import type { CaptionChunk } from '../components/Captions';
import marks from '../../public/recordings/coi.marks.json';
import { clamp, colors, fonts } from '../theme';

// ~23 s reel: the COI check (scripts/record-reports.mjs, take "coi"). A certificate says
// $1M auto liability; FMCSA's insurance filings show the policy cancelling Oct 27, 2026.
// Example data (scripts/examples.mjs COI_MISMATCH).

// Take A (Desmond, eleven_v4), cut at its measured pauses; one entry per phrase.
const VO = phraseVo(
  'voiceovers/coi-check.mp3',
  [
    { text: 'The certificate says one MILLION in coverage…', speech: [0.07, 2.67], gap: 0.15 }, // 0
    { text: 'but is it still active?', speech: [3.12, 4.12], gap: 0.3 }, // 1
    { text: 'Upload the COI.', speech: [4.65, 5.72], gap: 0.4 }, // 2
    { text: 'Haulock reads it…', speech: [6.3, 7.0], gap: 0.3 }, // 3
    { text: "and checks it against the insurer's filings with FMCSA.", speech: [7.33, 10.5], gap: 0.12 }, // 4
    { text: 'Here —', speech: [11.03, 11.25], gap: 0.4 }, // 5
    { text: 'a cancellation pending in twelve days.', speech: [11.62, 13.68], gap: 0.15 }, // 6
    { text: 'Match…', speech: [14.03, 14.5], gap: 0.4 }, // 7
    { text: 'verify…', speech: [14.75, 15.47], gap: 0.15 }, // 8
    { text: 'or MISMATCH.', speech: [15.7, 16.88], gap: 0.15 }, // 9
    { text: 'Catch it before the load moves.', speech: [17.27, 18.88], gap: 0.35 }, // 10
    { text: 'COI checks on every paid plan…', speech: [19.25, 21.18], gap: 0.5 }, // 11
    { text: 'at haulock.com.', speech: [21.62, 22.65], gap: 0.2 }, // 12
  ],
  22.96
);
const W = VO.at;

const SCREEN_IN = W(2) - 10;
const END = W(11) - 8;
export const COI_CHECK_DURATION = reelDuration(END, VO);
const M = marks.marks;
const SCROLL = 0.7;
const S = (f: number) => f - SCREEN_IN;
const LIFT = 120; // the upload box and spinner sit low on the page
const SPIN = 60; // the spinner runs again from here, so the answer lands on "…with FMCSA"
const CUTS: PhoneCut[] = [
  { at: 0, from: M.upload.t - 0.8, y: LIFT }, // the drop zone → tap
  { at: SPIN, from: 1.2, y: LIFT }, // "Reading the certificate and checking FMCSA filings…" → the verdict
  { at: S(W(5)) - 2, from: M.verdict.t + SCROLL + 0.02, punch: true }, // DOESN'T MATCH · cancellation pending
  { at: S(W(10)) - 2, from: M.filings.t + SCROLL + 0.02, punch: true }, // filed with FMCSA: cancellation Oct 27
];
const ANSWER = SCREEN_IN + SPIN + Math.round((M.result.t - 1.2) * 30);

const CAPTIONS: CaptionChunk[] = [
  { layout: 'top', until: W(1) - 3, lines: [[{ text: 'The certificate says', at: 0 }], [{ text: '$1M coverage.', at: 0, accent: 'serif', color: colors.cream }]] },
  { layout: 'top', until: W(2) - 3, lines: [[{ text: 'But is it', at: 1 }], [{ text: 'still active?', at: 1, accent: 'serif', color: colors.orange }]] },
  { layout: 'top', until: W(3) - 2, lines: [[{ text: 'Upload', at: 2 }], [{ text: 'the COI.', at: 2, accent: 'serif', color: colors.orange }]] },
  { layout: 'top', until: W(5) - 2, lines: [[{ text: 'Haulock reads it', at: 3 }], [{ text: '& checks FMCSA.', at: 4, accent: 'serif', color: colors.orange, size: 112 }]] },
  { layout: 'top', until: W(7) - 2, lines: [[{ text: 'Here —', at: 5 }], [{ text: 'cancelling in 12 days.', at: 6, accent: 'serif', color: colors.redGlow, size: 100 }]] },
  { layout: 'top', until: W(10) - 2, lines: [[{ text: 'Match…', at: 7 }, { text: 'verify…', at: 8 }], [{ text: 'or mismatch.', at: 9, accent: 'serif', color: colors.redGlow }]] },
  { layout: 'top', until: END, lines: [[{ text: 'Catch it before', at: 10 }], [{ text: 'the load moves.', at: 10, accent: 'serif', color: colors.orange }]] },
];

// The check's three answers (lib/coi-check.ts CoiVerdict), one per word; MISMATCH stays lit.
const VerdictChips: React.FC<{ at: number[] }> = ({ at }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const chips = [
    { text: 'MATCH', color: colors.green },
    { text: 'VERIFY', color: colors.amber },
    { text: 'MISMATCH', color: colors.red },
  ];
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 1700, display: 'flex', justifyContent: 'center', gap: 22 }}>
      {chips.map((c, i) => {
        const pop = spring({ frame: frame - at[i], fps, config: { damping: 12, stiffness: 230 } });
        const last = i === chips.length - 1;
        const dim = !last ? interpolate(frame, [at[2], at[2] + 6], [1, 0.35], clamp) : 1;
        return (
          <div
            key={c.text}
            style={{
              padding: last ? '18px 34px' : '16px 28px',
              borderRadius: 20,
              backgroundColor: c.color,
              color: '#fff',
              fontFamily: fonts.mono,
              fontWeight: 700,
              fontSize: last ? 50 : 40,
              letterSpacing: 4,
              boxShadow: `0 20px 60px ${c.color}88, 0 0 0 5px rgba(255,255,255,0.9)`,
              opacity: Math.min(1, pop * 1.5) * dim,
              transform: `scale(${interpolate(pop, [0, 1], [1.7, 1])}) rotate(${last ? -4 : 0}deg)`,
            }}
          >
            {c.text}
          </div>
        );
      })}
    </div>
  );
};

export const CoiCheck: React.FC = () => (
  <FeatureReel
    vo={VO}
    duration={COI_CHECK_DURATION}
    captions={CAPTIONS}
    hudTop="HAULOCK // COI CHECK"
    hook={{
      until: SCREEN_IN,
      node: (
        <HookCard
          clip="aerial-traffic"
          exitAt={SCREEN_IN}
          label="CERTIFICATE OF INSURANCE · ACORD 25"
          title="$1,000,000"
          lines={['Auto liability · Kestrelon Freight Group', 'Policy GP-4471209 · to Mar 1, 2027']}
          stamp={{ text: 'STILL ACTIVE?', at: W(1) + 2, color: colors.amber }}
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
              src="recordings/coi.mp4"
              css={{ w: 430, h: 880 }}
              screenW={700}
              top={590}
              cuts={CUTS}
              until={END - SCREEN_IN}
              taps={[{ at: 24, x: 215, y: 760 - LIFT }]}
              boxes={[{ from: S(W(6)), until: S(W(7)) - 2, x: 44, y: 326, w: 342, h: 214, color: colors.red }]}
            />
            <Sequence from={S(W(6)) + 4} durationInFrames={W(7) - W(6) - 6}>
              <Stamp big="Oct 27" small={['CANCELLATION', 'PENDING']} color={colors.red} top={1690} />
            </Sequence>
            <Sequence from={S(W(7))} durationInFrames={W(10) - W(7) - 2}>
              <VerdictChips at={[0, W(8) - W(7), W(9) - W(7) + 4]} />
            </Sequence>
            <Sequence from={S(W(10)) + 6}>
              <Stamp big="Hold" small={['UNTIL THE', 'INSURER CONFIRMS']} color={colors.red} top={1690} />
            </Sequence>
          </>
        ),
      },
    ]}
    end={{
      at: END,
      urlAt: W(12),
      chip: 'COI CHECK · FMCSA INSURANCE FILINGS',
      headline: [
        [{ text: 'COI checks on', at: 11 }],
        [{ text: 'every paid', at: 11 }, { text: 'plan.', at: 11, accent: true }],
      ],
      checks: ['Reads the ACORD 25', 'Checked against FMCSA filings'],
      hud: { topLeft: 'HAULOCK.COM', bottomLeft: 'COI CHECK', bottomRight: 'PAID PLANS' },
    }}
    music={{ src: 'music/training.mp3', bed: [[0, 30], [0.13, 0.13]], swell: 0.35 }}
    sfx={[
      { src: 'sfx/impact.mp3', at: W(1) + 1, volume: 0.22 },
      { src: 'sfx/beep.mp3', at: SCREEN_IN, volume: 0.25 },
      { src: 'sfx/beep.mp3', at: SCREEN_IN + 24, volume: 0.22 },
      { src: 'sfx/scan.mp3', at: SCREEN_IN + 30, volume: 0.4 },
      { src: 'sfx/glitch-a.mp3', at: ANSWER, volume: 0.3 },
      { src: 'sfx/impact.mp3', at: W(6) + 3, volume: 0.24 },
      { src: 'sfx/beep.mp3', at: W(7), volume: 0.22 },
      { src: 'sfx/beep.mp3', at: W(8), volume: 0.22 },
      { src: 'sfx/impact.mp3', at: W(9) + 3, volume: 0.26 },
      { src: 'sfx/impact.mp3', at: W(10) + 5, volume: 0.2 },
    ]}
    hits={[
      { at: W(1) + 2, glitch: 10, flash: 0.2, color: colors.amber, shake: 10 },
      { at: SCREEN_IN, glitch: 6, flash: 0.14 },
      { at: ANSWER, glitch: 8, flash: 0.16, color: colors.red },
      { at: W(6) + 4, flash: 0.18, color: colors.red, shake: 8 },
      { at: W(9) + 4, glitch: 8, flash: 0.2, color: colors.red, shake: 10 },
    ]}
  />
);
