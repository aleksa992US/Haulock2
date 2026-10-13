import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { FootageLayer } from './FootageLayer';
import { glitchAt } from './fx';
import type { FootageName } from '../footage';
import { clamp, colors, fonts } from '../theme';

// Opening shot shared by the reels: real footage seen through a scanner reticle, with a
// status line that flips to an alert on the key word.
export const ScannerHook: React.FC<{
  clip: FootageName;
  exitAt: number;
  alertAt: number;
  label: string;
  alertLabel: string;
}> = ({ clip, exitAt, alertAt, label, alertLabel }) => {
  const frame = useCurrentFrame();
  const exit = interpolate(frame, [exitAt, exitAt + 6], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <FootageLayer segments={[{ from: 0, to: exitAt + 6, clip, dim: 0.5 }]} />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(4,11,26,0.2), rgba(255,107,53,0.08))', mixBlendMode: 'screen' }} />
      <Reticle danger={frame >= alertAt} jitter={glitchAt(frame, alertAt, 12)} />
      <ScanStatus alertAt={alertAt} label={label} alertLabel={alertLabel} />
    </AbsoluteFill>
  );
};

const Reticle: React.FC<{ danger: boolean; jitter: number }> = ({ danger, jitter }) => {
  const frame = useCurrentFrame();
  const c = danger ? colors.red : colors.orange;
  const grow = interpolate(frame, [0, 14], [1.4, 1], { ...clamp, easing: (v) => 1 - Math.pow(1 - v, 3) });
  return (
    <svg
      width={1080}
      height={1920}
      style={{ position: 'absolute', inset: 0, opacity: 0.55, transform: `scale(${grow}) translateX(${jitter * 20}px)`, transformOrigin: '540px 830px' }}
    >
      <g transform={`rotate(${frame * 0.8} 540 830)`}>
        <circle cx={540} cy={830} r={430} fill="none" stroke={c} strokeWidth={2} strokeDasharray="4 18" />
      </g>
      <g transform={`rotate(${-frame * 0.5} 540 830)`}>
        <circle cx={540} cy={830} r={470} fill="none" stroke={c} strokeWidth={3} strokeDasharray="120 60 20 60" />
      </g>
      {[0, 90, 180, 270].map((a) => (
        <line
          key={a}
          x1={540 + Math.cos((a * Math.PI) / 180) * 490}
          y1={830 + Math.sin((a * Math.PI) / 180) * 490}
          x2={540 + Math.cos((a * Math.PI) / 180) * 530}
          y2={830 + Math.sin((a * Math.PI) / 180) * 530}
          stroke={c}
          strokeWidth={4}
        />
      ))}
    </svg>
  );
};

// Bottom status line with a progress bar that stalls and turns red on the alert.
const ScanStatus: React.FC<{ alertAt: number; label: string; alertLabel: string }> = ({ alertAt, label, alertLabel }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [4, alertAt], [0, 0.82], clamp);
  const alert = frame >= alertAt;
  return (
    <div style={{ position: 'absolute', left: 100, right: 100, top: 1430, fontFamily: fonts.mono, color: colors.cream }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 26, letterSpacing: 3 }}>
        <span>{alert ? alertLabel : label}</span>
        <span style={{ color: alert ? colors.redGlow : colors.orange }}>{Math.round(p * 100)}%</span>
      </div>
      <div style={{ marginTop: 14, height: 8, borderRadius: 4, backgroundColor: 'rgba(245,243,238,0.18)' }}>
        <div style={{ width: `${p * 100}%`, height: '100%', borderRadius: 4, backgroundColor: alert ? colors.red : colors.orange, boxShadow: `0 0 18px ${alert ? colors.red : colors.orange}` }} />
      </div>
    </div>
  );
};
