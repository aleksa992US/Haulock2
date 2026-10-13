import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { colors } from '../theme';
import { GridFloor, Particles } from './fx';

// The "inside the machine" space: near-black navy, slow orange/red glows, a
// receding grid floor and a drifting node network.
export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / 30;
  return (
    <AbsoluteFill style={{ backgroundColor: colors.void, overflow: 'hidden' }}>
      <AbsoluteFill style={{ background: `radial-gradient(110% 60% at 50% 30%, ${colors.navy} 0%, rgba(4,11,26,0) 70%)` }} />
      <Glow color="rgba(255,107,53,0.22)" size={1000} x={300 + Math.sin(t * 0.6) * 160} y={200 + Math.cos(t * 0.5) * 120} />
      <Glow color="rgba(220,38,38,0.18)" size={1100} x={-380 + Math.cos(t * 0.4) * 140} y={1000 + Math.sin(t * 0.45) * 160} />
      <GridFloor opacity={0.55} />
      <Particles opacity={0.75} />
    </AbsoluteFill>
  );
};

const Glow: React.FC<{ color: string; size: number; x: number; y: number }> = ({ color, size, x, y }) => (
  <div
    style={{
      position: 'absolute',
      left: x,
      top: y,
      width: size,
      height: size,
      borderRadius: '50%',
      background: `radial-gradient(circle, ${color} 0%, rgba(0,0,0,0) 70%)`,
    }}
  />
);
