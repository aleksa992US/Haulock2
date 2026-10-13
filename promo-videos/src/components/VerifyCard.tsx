import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { clamp, colors, fonts } from '../theme';
import { usePop } from './fx';

export type CardRow = { at: number; tone: 'red' | 'amber' | 'green'; icon: 'flag' | 'warn' | 'phone' | 'check' | 'globe' | 'clock' | 'file'; text: string };

const TONE = {
  red: { fg: colors.red, bg: 'rgba(220,38,38,0.07)', border: 'rgba(220,38,38,0.25)' },
  amber: { fg: '#D97706', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.3)' },
  green: { fg: colors.green, bg: 'rgba(22,163,74,0.07)', border: 'rgba(22,163,74,0.25)' },
};

// The verify card from the haulock.com hero, scaled for a 1080-wide reel. Frames are
// relative to the Sequence. Company names are redacted on purpose.
export const VerifyCard: React.FC<{
  kind: string;
  chip: string;
  idLine: string;
  rows: CardRow[];
  verdictAt: number;
  score: number;
  verdictLine: string;
  top?: number;
}> = ({ kind, chip, idLine, rows, verdictAt, score, verdictLine, top = 590 }) => {
  const frame = useCurrentFrame();
  const enter = usePop(0, { damping: 16, stiffness: 150 });
  const verdict = usePop(verdictAt, { damping: 12, stiffness: 220 });
  const caught = frame >= verdictAt;
  return (
    <div
      style={{
        position: 'absolute',
        left: 70,
        right: 70,
        top,
        transform: `translateY(${(1 - enter) * 500}px) perspective(2000px) rotateX(${(1 - enter) * 20}deg)`,
        opacity: Math.min(1, enter * 1.4),
      }}
    >
      {caught ? (
        <div
          style={{
            position: 'absolute',
            right: -6,
            top: -34,
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 24px',
            borderRadius: 999,
            backgroundColor: '#C2410C',
            background: 'linear-gradient(90deg, #DC2626, #C2410C)',
            color: '#fff',
            fontFamily: fonts.mono,
            fontSize: 24,
            letterSpacing: 3,
            boxShadow: '0 16px 40px rgba(220,38,38,0.45)',
            transform: `scale(${interpolate(verdict, [0, 1], [1.5, 1])})`,
            opacity: Math.min(1, verdict * 1.5),
          }}
        >
          <Icon kind="warn" color="#fff" size={26} /> HIGH RISK · JUST NOW
        </div>
      ) : null}
      <div
        style={{
          borderRadius: 34,
          backgroundColor: '#fff',
          padding: '28px 40px 26px',
          boxShadow: caught ? '0 0 0 3px rgba(220,38,38,0.5), 0 40px 120px rgba(220,38,38,0.35)' : '0 40px 100px rgba(0,0,0,0.5)',
          color: colors.ink,
          fontFamily: fonts.sans,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', paddingBottom: 20, borderBottom: '2px solid rgba(11,30,63,0.08)' }}>
          {['#FF6B35', '#F59E0B', '#16A34A'].map((c) => (
            <span key={c} style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: c, marginRight: 12 }} />
          ))}
          <span style={{ flex: 1, textAlign: 'center', marginRight: 90, fontFamily: fonts.mono, fontSize: 24, color: 'rgba(11,30,63,0.5)' }}>haulock.com/verify</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 }}>
          <div>
            <div style={{ fontFamily: fonts.mono, fontSize: 22, letterSpacing: 3, color: 'rgba(11,30,63,0.5)' }}>{kind}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12 }}>
              <div style={{ width: 300, height: 40, borderRadius: 8, backgroundColor: colors.navy }} />
              <span style={{ padding: '8px 14px', borderRadius: 8, backgroundColor: 'rgba(11,30,63,0.06)', fontFamily: fonts.mono, fontSize: 20, letterSpacing: 2, color: 'rgba(11,30,63,0.55)' }}>{chip}</span>
            </div>
            <div style={{ marginTop: 12, fontFamily: fonts.mono, fontSize: 22, color: 'rgba(11,30,63,0.45)' }}>{idLine}</div>
          </div>
          <Gauge score={score} at={verdictAt} />
        </div>

        <div style={{ height: caught ? 118 : 0, overflow: 'hidden', marginTop: caught ? 22 : 0 }}>
          <div
            style={{
              padding: '18px 24px',
              borderRadius: 18,
              backgroundColor: 'rgba(220,38,38,0.07)',
              border: '2px solid rgba(220,38,38,0.3)',
              opacity: verdict,
              transform: `translateY(${(1 - verdict) * -20}px)`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: fonts.mono, fontSize: 24, letterSpacing: 3, color: colors.red }}>
              <Icon kind="warn" color={colors.red} size={24} /> DO NOT BOOK
            </div>
            <div style={{ marginTop: 6, fontSize: 30, color: colors.ink }}>{verdictLine}</div>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          {rows.map((r, i) => (
            <Row key={i} row={r} />
          ))}
        </div>

        <div style={{ marginTop: 14, paddingTop: 16, borderTop: '2px solid rgba(11,30,63,0.08)', textAlign: 'right', fontFamily: fonts.mono, fontSize: 22, color: 'rgba(11,30,63,0.45)' }}>
          14 data sources
        </div>
      </div>
    </div>
  );
};

const Row: React.FC<{ row: CardRow }> = ({ row }) => {
  const frame = useCurrentFrame();
  const p = usePop(row.at, { damping: 15, stiffness: 200 });
  if (frame < row.at) return null;
  const t = TONE[row.tone];
  const flash = interpolate(frame - row.at, [0, 3, 14], [0, 1, 0], clamp);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '18px 22px',
        marginTop: 10,
        borderRadius: 16,
        backgroundColor: t.bg,
        border: `2px solid ${t.border}`,
        boxShadow: flash ? `0 0 ${30 * flash}px ${t.fg}` : undefined,
        opacity: Math.min(1, p * 1.4),
        transform: `translateX(${(1 - p) * 120}px)`,
      }}
    >
      <Icon kind={row.icon} color={t.fg} size={30} />
      <span style={{ flex: 1, fontSize: 31, color: colors.ink }}>{row.text}</span>
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="rgba(11,30,63,0.3)" strokeWidth={2.5} strokeLinecap="round">
        <path d="m9 18 6-6-6-6" />
      </svg>
    </div>
  );
};

// Semicircle gauge with needle and serif score, as on the site.
const Gauge: React.FC<{ score: number; at: number }> = ({ score, at }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at - 18, at], [0.15, score / 100], { ...clamp, easing: (v) => 1 - Math.pow(1 - v, 3) });
  const value = frame < at - 18 ? null : Math.round(p * 100);
  const color = p > 0.66 ? colors.red : p > 0.4 ? colors.amber : colors.green;
  const R = 92;
  const C = { x: 110, y: 110 };
  const arc = (q: number) => {
    const a = Math.PI * (1 - q);
    return `M ${C.x - R} ${C.y} A ${R} ${R} 0 0 1 ${C.x + R * Math.cos(a)} ${C.y - R * Math.sin(a)}`;
  };
  const n = Math.PI * (1 - p);
  return (
    <div style={{ position: 'relative', width: 220, height: 130 }}>
      <svg width={220} height={130} viewBox="0 0 220 130">
        <path d={arc(1)} fill="none" stroke="rgba(11,30,63,0.1)" strokeWidth={16} strokeLinecap="round" />
        <path d={arc(p)} fill="none" stroke={color} strokeWidth={16} strokeLinecap="round" />
        <line x1={C.x} y1={C.y} x2={C.x + (R - 14) * Math.cos(n)} y2={C.y - (R - 14) * Math.sin(n)} stroke={colors.ink} strokeWidth={4} strokeLinecap="round" />
        <circle cx={C.x} cy={C.y} r={7} fill={colors.ink} />
      </svg>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 46, textAlign: 'center', fontFamily: fonts.serif, fontStyle: 'italic', fontSize: 64, color }}>
        {value ?? ''}
      </div>
    </div>
  );
};

export const Icon: React.FC<{ kind: CardRow['icon']; color: string; size: number }> = ({ kind, color, size }) => {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'flag':
      return (
        <svg {...common}>
          <path d="M4 22V4a1 1 0 0 1 1-1h12l-2 4 2 4H5" />
        </svg>
      );
    case 'phone':
      return (
        <svg {...common}>
          <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <circle cx={12} cy={12} r={10} />
          <path d="m8 12 3 3 5-6" />
        </svg>
      );
    case 'globe':
      return (
        <svg {...common}>
          <circle cx={12} cy={12} r={10} />
          <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...common}>
          <circle cx={12} cy={12} r={10} />
          <path d="M12 6v6l4 2" />
        </svg>
      );
    case 'file':
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
          <path d="M14 2v6h6M8 13h8M8 17h5" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      );
  }
};
