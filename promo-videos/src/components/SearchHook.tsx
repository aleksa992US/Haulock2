import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { FootageLayer } from './FootageLayer';
import { usePop } from './fx';
import type { FootageName } from '../footage';
import { clamp, colors, fonts } from '../theme';

// Step 01 as a reel opening: footage behind the site's search box, the MC typed in on cue,
// then Verify pressed. Frames are relative to the Sequence.
export const SearchHook: React.FC<{ clip: FootageName; exitAt: number; typeAt: number; submitAt: number; query: string }> = ({
  clip,
  exitAt,
  typeAt,
  submitAt,
  query,
}) => {
  const frame = useCurrentFrame();
  const exit = interpolate(frame, [exitAt, exitAt + 6], [1, 0], clamp);
  const enter = usePop(4, { damping: 16, stiffness: 150 });
  const typed = query.slice(0, Math.max(0, Math.floor((frame - typeAt) / 1.6)));
  const pressed = frame >= submitAt && frame < submitAt + 6;
  const scanning = frame >= submitAt;
  const progress = interpolate(frame, [submitAt, exitAt], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <FootageLayer segments={[{ from: 0, to: exitAt + 6, clip, dim: 0.55 }]} />
      <div
        style={{
          position: 'absolute',
          left: 70,
          right: 70,
          top: 1120,
          opacity: enter,
          transform: `translateY(${(1 - enter) * 80}px)`,
        }}
      >
        <StepTag n="01" label="ENTER MC, DOT OR COMPANY NAME" />
        <div
          style={{
            marginTop: 18,
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            padding: '14px 14px 14px 30px',
            borderRadius: 999,
            backgroundColor: '#fff',
            boxShadow: '0 30px 80px rgba(0,0,0,0.55), 0 0 0 4px rgba(255,107,53,0.35)',
          }}
        >
          <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="rgba(11,30,63,0.5)" strokeWidth={2.4} strokeLinecap="round">
            <circle cx={11} cy={11} r={7} />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <div style={{ flex: 1, fontFamily: fonts.mono, fontSize: 40, color: typed ? colors.ink : 'rgba(11,30,63,0.35)' }}>
            {typed || 'MC, DOT or company name'}
            {typed && !scanning && Math.floor(frame / 8) % 2 === 0 ? <span style={{ color: colors.orange }}>|</span> : null}
          </div>
          <div
            style={{
              padding: '22px 34px',
              borderRadius: 999,
              backgroundColor: colors.navy,
              color: '#fff',
              fontFamily: fonts.sans,
              fontWeight: 500,
              fontSize: 34,
              transform: `scale(${pressed ? 0.92 : 1})`,
            }}
          >
            Verify →
          </div>
        </div>
        {scanning ? (
          <div style={{ marginTop: 22, height: 8, borderRadius: 4, backgroundColor: 'rgba(245,243,238,0.18)' }}>
            <div style={{ width: `${progress * 100}%`, height: '100%', borderRadius: 4, backgroundColor: colors.orange, boxShadow: `0 0 18px ${colors.orange}` }} />
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

// "STEP 01 · …" label in the site's mono style.
export const StepTag: React.FC<{ n: string; label: string; tone?: 'dark' | 'light' }> = ({ n, label, tone = 'dark' }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontFamily: fonts.mono, fontSize: 24, letterSpacing: 4 }}>
    <span style={{ padding: '6px 14px', borderRadius: 8, backgroundColor: colors.orange, color: '#fff', fontWeight: 700 }}>STEP {n}</span>
    <span style={{ color: tone === 'dark' ? colors.cream : colors.ink }}>{label}</span>
  </div>
);
