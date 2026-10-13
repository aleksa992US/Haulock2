import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { clamp, colors, fonts } from '../theme';
import { Decode, usePop } from './fx';

// The 14 checks behind every lookup, as listed on the site's scan screen.
export const SOURCES = [
  'FMCSA SAFER',
  'Insurance & bond',
  'MC name lookup',
  'SMS · BASICs',
  'Google Places',
  'Safe Browsing',
  'WHOIS · DNS',
  'Social media',
  'Web presence',
  'Lookalike domains',
  'Cross-reference',
  'Fraud reputation',
  'Linked entities',
  '5-yr archive',
];

const CX = 540;
const CY = 1010;
const R = 250;
const LABEL_R = 292;

// Radar of the 14 sources. Nodes light up one by one between `start` and `end`
// (frames relative to the Sequence); `focus` lists source indices to pulse later.
export const SourcesRadar: React.FC<{ start: number; end: number; focus?: { index: number; at: number }[] }> = ({ start, end, focus = [] }) => {
  const frame = useCurrentFrame();
  const enter = usePop(0, { damping: 16, stiffness: 140 });
  const step = (end - start) / SOURCES.length;
  const done = SOURCES.filter((_, i) => frame >= start + i * step).length;
  const complete = done === SOURCES.length;
  const pulse = usePop(start + SOURCES.length * step, { damping: 9, stiffness: 200 });
  const sweep = (frame * 9) % 360;

  return (
    <div style={{ position: 'absolute', inset: 0, opacity: enter, transform: `scale(${0.85 + 0.15 * enter})`, transformOrigin: `${CX}px ${CY}px` }}>
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <radialGradient id="radarGlow">
            <stop offset="0%" stopColor="rgba(255,107,53,0.35)" />
            <stop offset="100%" stopColor="rgba(255,107,53,0)" />
          </radialGradient>
        </defs>
        <circle cx={CX} cy={CY} r={R + 40} fill="url(#radarGlow)" opacity={complete ? 0.9 : 0.5} />
        {[0.35, 0.68, 1].map((k) => (
          <circle key={k} cx={CX} cy={CY} r={R * k} fill="none" stroke={colors.line} strokeWidth={2} />
        ))}
        {/* Sweep wedge */}
        <path
          d={`M ${CX} ${CY} L ${CX + R * Math.cos(((sweep - 28) * Math.PI) / 180)} ${CY + R * Math.sin(((sweep - 28) * Math.PI) / 180)} A ${R} ${R} 0 0 1 ${CX + R * Math.cos((sweep * Math.PI) / 180)} ${CY + R * Math.sin((sweep * Math.PI) / 180)} Z`}
          fill="rgba(255,107,53,0.16)"
        />
        <line x1={CX} y1={CY} x2={CX + R * Math.cos((sweep * Math.PI) / 180)} y2={CY + R * Math.sin((sweep * Math.PI) / 180)} stroke={colors.orange} strokeWidth={3} />
        {SOURCES.map((_, i) => {
          const a = (i / SOURCES.length) * Math.PI * 2 - Math.PI / 2;
          const on = frame >= start + i * step;
          const f = focus.find((x) => x.index === i);
          const hot = f ? interpolate(frame - f.at, [0, 4, 14], [0, 1, 0.55], clamp) : 0;
          const x = CX + R * Math.cos(a);
          const y = CY + R * Math.sin(a);
          return (
            <g key={i}>
              <line x1={CX} y1={CY} x2={x} y2={y} stroke={on ? 'rgba(255,107,53,0.55)' : 'rgba(245,243,238,0.08)'} strokeWidth={on ? 2.5 : 1.5} />
              <circle cx={x} cy={y} r={on ? 17 + hot * 10 : 12} fill={on ? colors.orange : colors.void} stroke={on ? '#FFD2BF' : colors.line} strokeWidth={3} />
              {on ? <path d={`M ${x - 7} ${y} l 5 5 l 9 -10`} fill="none" stroke="#fff" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" /> : null}
              {hot > 0 ? <circle cx={x} cy={y} r={30 + hot * 18} fill="none" stroke={colors.orange} strokeWidth={3} opacity={1 - hot * 0.5} /> : null}
            </g>
          );
        })}
      </svg>

      {SOURCES.map((label, i) => {
        const a = (i / SOURCES.length) * Math.PI * 2 - Math.PI / 2;
        const on = frame >= start + i * step;
        const x = CX + LABEL_R * Math.cos(a);
        const y = CY + LABEL_R * Math.sin(a);
        const cos = Math.cos(a);
        const align = Math.abs(cos) < 0.2 ? 'center' : cos > 0 ? 'left' : 'right';
        return (
          <div
            key={label}
            style={{
              position: 'absolute',
              top: y - 16 + (Math.abs(cos) < 0.2 ? (Math.sin(a) > 0 ? 18 : -22) : 0),
              left: align === 'left' ? x + 6 : align === 'center' ? x - 150 : undefined,
              right: align === 'right' ? 1080 - x + 6 : undefined,
              width: align === 'center' ? 300 : 230,
              textAlign: align,
              fontFamily: fonts.sans,
              fontWeight: 500,
              fontSize: 26,
              lineHeight: 1.1,
              color: on ? colors.cream : 'rgba(245,243,238,0.28)',
            }}
          >
            {label}
          </div>
        );
      })}

      <div
        style={{
          position: 'absolute',
          left: CX - 200,
          width: 400,
          top: CY - 132,
          textAlign: 'center',
          transform: `scale(${1 + (complete ? Math.sin(Math.min(pulse, 1) * Math.PI) * 0.12 : 0)})`,
        }}
      >
        <div style={{ fontFamily: fonts.serif, fontStyle: 'italic', fontSize: 210, lineHeight: 1, color: complete ? colors.orange : colors.cream, textShadow: '0 0 40px rgba(255,107,53,0.5)' }}>
          {done}
        </div>
        <div style={{ marginTop: 6, fontFamily: fonts.mono, fontWeight: 600, fontSize: 26, letterSpacing: 4, color: colors.cream }}>
          <Decode text="DATA SOURCES" at={4} dur={14} />
        </div>
      </div>

      <div style={{ position: 'absolute', top: 1390, left: 0, right: 0, textAlign: 'center', fontFamily: fonts.mono, fontSize: 24, letterSpacing: 4, color: complete ? colors.greenGlow : colors.dim }}>
        {complete ? '✓ 14 / 14 CROSS-CHECKED' : `CROSS-CHECKING ${done} / 14…`}
      </div>
    </div>
  );
};
