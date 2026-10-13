import React from 'react';
import { Html5Audio, Sequence, interpolate, staticFile } from 'remotion';
import { FPS, clamp } from '../theme';
import type { Vo } from '../vo';

// The voice, placed phrase by phrase (see vo.ts).
export const VoTrack: React.FC<{ vo: Vo }> = ({ vo }) => (
  <>
    {vo.segments.map((s, i) => (
      <Sequence key={i} from={Math.round((s.srcFrom + s.offset) * FPS)}>
        <Html5Audio src={staticFile(vo.src)} trimBefore={Math.round(s.srcFrom * FPS)} trimAfter={Math.round(s.srcTo * FPS)} />
      </Sequence>
    ))}
  </>
);

// Music bed: under the voice at `bed`, up to `swell` once the voice is done, faded at the end.
// Levels assume a track around -16 dB RMS (the Mixkit "Epical Drums" set).
export const Music: React.FC<{ src: string; startAt: number; voEnd: number; duration: number; bed?: number; swell?: number }> = ({
  src,
  startAt,
  voEnd,
  duration,
  bed = 0.3,
  swell = 0.62,
}) => (
  <Html5Audio
    src={staticFile(src)}
    trimBefore={Math.round(startAt * FPS)}
    volume={(f) =>
      interpolate(f, [0, 4], [0, 1], clamp) *
      interpolate(f, [voEnd, voEnd + 12], [bed, swell], clamp) *
      interpolate(f, [duration - 24, duration - 1], [1, 0], clamp)
    }
  />
);

// ElevenLabs sound effects in public/sfx, levelled from full-band measurements:
// riser -13.5, glitch -15, scan -22, beep -14, impact -5.4 dB RMS.
export const Sfx: React.FC<{ src: string; at: number; volume: number }> = ({ src, at, volume }) => (
  <Sequence from={at}>
    <Html5Audio src={staticFile(src)} volume={volume} />
  </Sequence>
);
