import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { StepTag } from './SearchHook';
import { glitchAt, rgbSplit, usePop } from './fx';
import { Icon } from './VerifyCard';
import { clamp, colors, fonts } from '../theme';

type Outcome = { title: string; detail: string };

// Step 03: one score, one plain-English verdict. Shows the clean outcome first ("book it"),
// then flips to the risky one ("walk away"). Frames are relative to the Sequence.
export const VerdictCard: React.FC<{
  scoreAt: number;
  bookAt: number;
  walkAt: number;
  lookup?: string;
  good?: Outcome;
  bad?: Outcome;
  share?: string;
}> = ({
  scoreAt,
  bookAt,
  walkAt,
  lookup = 'CARRIER LOOKUP · MC-441••• · DOT-1226•••',
  good = { title: 'BOOK THIS LOAD', detail: 'Clean across all 14 sources · 12-year authority' },
  bad = { title: 'WALK AWAY', detail: 'Lookalike email · phone shared with 3 revoked MCs' },
  share = 'Share with ops team ↗',
}) => {
  const frame = useCurrentFrame();
  const enter = usePop(0, { damping: 16, stiffness: 150 });
  const walk = frame >= walkAt;
  const g = glitchAt(frame, walkAt, 10);
  const target = walk ? 88 : 12;
  const from = walk ? 12 : 0;
  const start = walk ? walkAt : scoreAt;
  const p = interpolate(frame, [start, start + 14], [from, target], { ...clamp, easing: (v) => 1 - Math.pow(1 - v, 3) }) / 100;
  const color = walk ? colors.red : colors.green;
  const showVerdict = frame >= bookAt;
  const panel = usePop(walk ? walkAt : bookAt, { damping: 12, stiffness: 220 });

  const R = 170;
  const C = { x: 220, y: 210 };
  const arc = (q: number) => {
    const a = Math.PI * (1 - q);
    return `M ${C.x - R} ${C.y} A ${R} ${R} 0 0 1 ${C.x + R * Math.cos(a)} ${C.y - R * Math.sin(a)}`;
  };
  const n = Math.PI * (1 - p);

  return (
    <div style={{ position: 'absolute', left: 70, right: 70, top: 590, opacity: Math.min(1, enter * 1.4), transform: `translateY(${(1 - enter) * 300}px) translateX(${g * 16 * (frame % 2 ? 1 : -1)}px)` }}>
      <div style={{ marginBottom: 20 }}>
        <StepTag n="03" label="ONE SCORE · ONE VERDICT" />
      </div>
      {walk ? (
        <div
          style={{
            position: 'absolute',
            right: -6,
            top: 40,
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 24px',
            borderRadius: 999,
            background: 'linear-gradient(90deg, #DC2626, #C2410C)',
            color: '#fff',
            fontFamily: fonts.mono,
            fontSize: 24,
            letterSpacing: 3,
            transform: `scale(${interpolate(panel, [0, 1], [1.5, 1])})`,
          }}
        >
          <Icon kind="warn" color="#fff" size={26} /> HIGH RISK · JUST NOW
        </div>
      ) : null}
      <div
        style={{
          borderRadius: 34,
          backgroundColor: '#fff',
          padding: '28px 40px 30px',
          boxShadow: walk ? '0 0 0 3px rgba(220,38,38,0.5), 0 40px 120px rgba(220,38,38,0.35)' : showVerdict ? '0 0 0 3px rgba(22,163,74,0.45), 0 40px 120px rgba(22,163,74,0.25)' : '0 40px 100px rgba(0,0,0,0.5)',
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
        <div style={{ marginTop: 22, fontFamily: fonts.mono, fontSize: 22, letterSpacing: 3, color: 'rgba(11,30,63,0.5)' }}>{lookup}</div>

        <div style={{ position: 'relative', width: 440, height: 240, margin: '18px auto 0' }}>
          <svg width={440} height={240} viewBox="0 0 440 240">
            <path d={arc(1)} fill="none" stroke="rgba(11,30,63,0.1)" strokeWidth={26} strokeLinecap="round" />
            {p > 0.005 ? <path d={arc(p)} fill="none" stroke={color} strokeWidth={26} strokeLinecap="round" /> : null}
            <line x1={C.x} y1={C.y} x2={C.x + (R - 30) * Math.cos(n)} y2={C.y - (R - 30) * Math.sin(n)} stroke={colors.ink} strokeWidth={6} strokeLinecap="round" />
            <circle cx={C.x} cy={C.y} r={11} fill={colors.ink} />
          </svg>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 70, textAlign: 'center', fontFamily: fonts.serif, fontStyle: 'italic', fontSize: 120, lineHeight: 1, color, textShadow: rgbSplit(g * 8) }}>
            {frame >= scoreAt ? Math.round(p * 100) : ''}
          </div>
        </div>
        <div style={{ textAlign: 'center', fontFamily: fonts.mono, fontSize: 22, letterSpacing: 4, color: 'rgba(11,30,63,0.45)' }}>RISK SCORE · 14 DATA SOURCES</div>

        <div style={{ height: 150, marginTop: 22 }}>
          {showVerdict ? (
            <div
              style={{
                padding: '22px 26px',
                borderRadius: 20,
                backgroundColor: walk ? 'rgba(220,38,38,0.07)' : 'rgba(22,163,74,0.08)',
                border: `2px solid ${walk ? 'rgba(220,38,38,0.35)' : 'rgba(22,163,74,0.35)'}`,
                opacity: Math.min(1, panel * 1.4),
                transform: `scale(${0.94 + 0.06 * panel})`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: fonts.mono, fontWeight: 600, fontSize: 34, letterSpacing: 3, color: walk ? colors.red : colors.green }}>
                <Icon kind={walk ? 'warn' : 'check'} color={walk ? colors.red : colors.green} size={36} />
                {walk ? bad.title : good.title}
              </div>
              <div style={{ marginTop: 10, fontSize: 30, color: colors.ink }}>
                {walk ? bad.detail : good.detail}
              </div>
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, paddingTop: 18, borderTop: '2px solid rgba(11,30,63,0.08)' }}>
          <span style={{ fontFamily: fonts.mono, fontSize: 22, color: 'rgba(11,30,63,0.45)' }}>Plain English. No jargon.</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 22px', borderRadius: 999, border: '2px solid rgba(11,30,63,0.15)', fontSize: 26 }}>
            {share}
          </span>
        </div>
      </div>
    </div>
  );
};
