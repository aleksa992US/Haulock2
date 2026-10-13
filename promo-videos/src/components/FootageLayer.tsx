import React from 'react';
import { AbsoluteFill, Loop, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { FOOTAGE, type FootageName } from '../footage';

export type FootageSegment = { from: number; to: number; clip: FootageName; dim: number };

// Full-bleed footage segments with a navy grade; each fades in over `fade` frames.
export const FootageLayer: React.FC<{ segments: FootageSegment[]; fade?: number }> = ({ segments, fade = 6 }) => (
  <>
    {segments.map((s, i) => (
      <Sequence key={i} from={s.from} durationInFrames={s.to - s.from}>
        <FootageClip clip={s.clip} dim={s.dim} fade={fade} />
      </Sequence>
    ))}
  </>
);

const FootageClip: React.FC<{ clip: FootageName; dim: number; fade: number }> = ({ clip, dim, fade }) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, fade], [0, 1], { extrapolateRight: 'clamp' });
  const zoom = 1.04 + frame * 0.0006;
  const { src, frames } = FOOTAGE[clip];
  return (
    <AbsoluteFill style={{ opacity: fadeIn }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
        <Loop durationInFrames={frames}>
          <OffthreadVideo src={staticFile(src)} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </Loop>
      </AbsoluteFill>
      {/* Navy grade, darker at the top for the kicker and at the bottom for the platform UI. */}
      <AbsoluteFill style={{ backgroundColor: `rgba(6,18,42,${dim})` }} />
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(6,18,42,0.9) 0%, rgba(6,18,42,0.45) 26%, rgba(6,18,42,0) 46%, rgba(6,18,42,0) 70%, rgba(6,18,42,0.85) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};
