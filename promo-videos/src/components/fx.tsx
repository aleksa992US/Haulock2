import React from 'react';
import { AbsoluteFill, interpolate, random, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp, colors, fonts } from '../theme';

export const usePop = (at: number, config = { damping: 14, stiffness: 180 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - at, fps, config });
};

// 0–1 strength of a glitch burst starting at `at`: flickers and dies out over `dur` frames.
export const glitchAt = (frame: number, at: number, dur = 10) => {
  const t = frame - at;
  if (t < 0 || t >= dur) return 0;
  return (1 - t / dur) * (random(`g${at}-${t}`) > 0.35 ? 1 : 0.35);
};

// Chromatic-aberration text shadow for glitch moments.
export const rgbSplit = (px: number) =>
  px <= 0.2 ? undefined : `${-px}px 0 rgba(255,40,90,0.85), ${px}px 0 rgba(0,210,255,0.7)`;

// Jitter for a shake, decaying over 10 frames.
export const shake = (frame: number, at: number, amount = 14) => {
  const t = frame - at;
  if (t < 0 || t > 10) return 0;
  return Math.sin(t * 2.9) * amount * (1 - t / 10);
};

export const Scanlines: React.FC<{ opacity?: number }> = ({ opacity = 1 }) => {
  const frame = useCurrentFrame();
  const band = ((frame * 14) % 2400) - 300;
  return (
    <AbsoluteFill style={{ opacity, pointerEvents: 'none' }}>
      <AbsoluteFill style={{ backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.045) 0px, rgba(255,255,255,0.045) 1px, transparent 1px, transparent 4px)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: band, height: 220, background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.04) 50%, rgba(255,255,255,0) 100%)' }} />
      <AbsoluteFill style={{ background: 'radial-gradient(85% 60% at 50% 50%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.6) 100%)' }} />
    </AbsoluteFill>
  );
};

// Receding perspective grid along the bottom of the frame.
export const GridFloor: React.FC<{ color?: string; opacity?: number }> = ({ color = 'rgba(255,107,53,0.55)', opacity = 1 }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 900, overflow: 'hidden', opacity, perspective: 700 }}>
      <div
        style={{
          position: 'absolute',
          left: -800,
          right: -800,
          bottom: -100,
          height: 1600,
          transformOrigin: '50% 100%',
          transform: 'rotateX(74deg)',
          backgroundImage: `linear-gradient(${color} 2px, transparent 2px), linear-gradient(90deg, ${color} 2px, transparent 2px)`,
          backgroundSize: '96px 96px',
          backgroundPosition: `0px ${frame * 5}px`,
          WebkitMaskImage: 'linear-gradient(to top, black 0%, black 25%, transparent 85%)',
          maskImage: 'linear-gradient(to top, black 0%, black 25%, transparent 85%)',
        }}
      />
    </div>
  );
};

// Drifting nodes joined by faint lines: a slow "neural network" field.
const NODES = Array.from({ length: 42 }, (_, i) => ({
  x: random(`px${i}`) * 1080,
  y: random(`py${i}`) * 1700 + 110,
  r: 1.6 + random(`pr${i}`) * 2.6,
  speed: 0.4 + random(`ps${i}`) * 0.8,
  phase: random(`pp${i}`) * Math.PI * 2,
}));

export const Particles: React.FC<{ opacity?: number; color?: string }> = ({ opacity = 1, color = '255,107,53' }) => {
  const frame = useCurrentFrame();
  const pts = NODES.map((n) => ({
    x: n.x + Math.sin(frame / 50 * n.speed + n.phase) * 46,
    y: n.y + Math.cos(frame / 60 * n.speed + n.phase) * 36,
    r: n.r,
  }));
  const lines: React.ReactNode[] = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d < 200) {
        lines.push(
          <line key={`${i}-${j}`} x1={pts[i].x} y1={pts[i].y} x2={pts[j].x} y2={pts[j].y} stroke={`rgba(${color},${(1 - d / 200) * 0.35})`} strokeWidth={1.5} />
        );
      }
    }
  }
  return (
    <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0, opacity }}>
      {lines}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.r} fill={`rgba(${color},0.85)`} />
      ))}
    </svg>
  );
};

// Corner brackets and mono readouts framing the dark scenes.
export const HudFrame: React.FC<{ topLeft: string; bottomLeft: string; bottomRight: string; tone?: 'dark' | 'light'; offset?: number }> = ({
  topLeft,
  bottomLeft,
  bottomRight,
  tone = 'dark',
  offset = 0,
}) => {
  const local = useCurrentFrame();
  const frame = local + offset;
  const draw = interpolate(local, [0, 12], [0, 1], clamp);
  const stroke = tone === 'dark' ? 'rgba(245,243,238,0.5)' : 'rgba(11,30,63,0.35)';
  const text = tone === 'dark' ? colors.dim : 'rgba(11,30,63,0.55)';
  const L = 64 * draw;
  const corner = (x: number, y: number, dx: number, dy: number) => (
    <path d={`M${x + dx * L} ${y} L${x} ${y} L${x} ${y + dy * L}`} fill="none" stroke={stroke} strokeWidth={3} />
  );
  const secs = frame / 30;
  const tc = `00:00:${String(Math.floor(secs)).padStart(2, '0')}:${String(frame % 30).padStart(2, '0')}`;
  const label: React.CSSProperties = { position: 'absolute', fontFamily: fonts.mono, fontWeight: 500, fontSize: 22, letterSpacing: 3, color: text, opacity: draw };
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
        {corner(44, 206, 1, 1)}
        {corner(1036, 206, -1, 1)}
        {corner(44, 1626, 1, -1)}
        {corner(1036, 1626, -1, -1)}
      </svg>
      <div style={{ ...label, left: 74, top: 222 }}>{topLeft}</div>
      <div style={{ ...label, right: 74, top: 222, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colors.orange, opacity: Math.floor(frame / 12) % 2 ? 0.3 : 1 }} />
        {tc}
      </div>
      <div style={{ ...label, left: 74, top: 1588 }}>{bottomLeft}</div>
      <div style={{ ...label, right: 74, top: 1588 }}>{bottomRight}</div>
    </AbsoluteFill>
  );
};

// Horizontal tear bars that flash over the frame during a glitch.
export const GlitchBars: React.FC<{ at: number; dur?: number }> = ({ at, dur = 9 }) => {
  const frame = useCurrentFrame();
  const g = glitchAt(frame, at, dur);
  if (g === 0) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'screen' }}>
      {Array.from({ length: 7 }, (_, i) => {
        const r = (k: string) => random(`bar${at}-${frame}-${i}-${k}`);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: (r('x') - 0.3) * 600,
              top: r('y') * 1920,
              width: 300 + r('w') * 900,
              height: 6 + r('h') * 46,
              backgroundColor: ['rgba(255,107,53,0.55)', 'rgba(0,210,255,0.45)', 'rgba(255,40,90,0.5)', 'rgba(245,243,238,0.35)'][i % 4],
              opacity: g,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const GLYPHS = '█▓▒░<>/\\|#%&*01X$';

// Text that resolves out of random glyphs, left to right, from `at` over `dur` frames.
export const Decode: React.FC<{ text: string; at: number; dur?: number; style?: React.CSSProperties }> = ({ text, at, dur = 14, style }) => {
  const frame = useCurrentFrame();
  if (frame < at) return null;
  const done = interpolate(frame, [at, at + dur], [0, text.length], clamp);
  const out = text
    .split('')
    .map((ch, i) => (i < done || ch === ' ' ? ch : GLYPHS[Math.floor(random(`d${at}-${i}-${Math.floor(frame / 2)}`) * GLYPHS.length)]))
    .join('');
  return <span style={style}>{out}</span>;
};

export const Flash: React.FC<{ at: number; color?: string; strength?: number; dur?: number }> = ({ at, color = '#fff', strength = 0.5, dur = 8 }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [at, at + 1, at + dur], [0, strength, 0], clamp);
  if (opacity === 0) return null;
  return <AbsoluteFill style={{ backgroundColor: color, opacity, pointerEvents: 'none' }} />;
};
