import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { glitchAt, usePop } from './fx';
import { Icon } from './VerifyCard';
import { clamp, colors, fonts } from '../theme';

const ROWS = [
  { mc: 'MC-612•••', dot: 'DOT-3271•••' },
  { mc: 'MC-905•••', dot: 'DOT-2048•••' },
  { mc: 'MC-337•••', dot: 'DOT-1569•••' },
];
const CHANGED = 1;

// Watchlist beat: saved brokers get re-checked on a 24-hour loop; one of them changes and
// an alert email drops in. Frames are relative to the Sequence.
export const WatchlistPanel: React.FC<{ sweepAt: number; alertAt: number }> = ({ sweepAt, alertAt }) => {
  const frame = useCurrentFrame();
  const enter = usePop(0, { damping: 16, stiffness: 150 });
  const alert = frame >= alertAt;
  const flip = usePop(alertAt, { damping: 12, stiffness: 220 });
  const toast = usePop(alertAt + 6, { damping: 14, stiffness: 170 });
  const g = glitchAt(frame, alertAt, 10);
  // The re-check sweep runs down the rows once, landing on the changed row as the alert fires.
  const sweep = interpolate(frame, [sweepAt, alertAt], [0, CHANGED + 0.5], clamp);
  const spin = frame * 9;

  return (
    <div style={{ position: 'absolute', left: 70, right: 70, top: 590, opacity: Math.min(1, enter * 1.4), transform: `translateY(${(1 - enter) * 300}px) translateX(${g * 14 * (frame % 2 ? 1 : -1)}px)` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, fontFamily: fonts.mono, fontSize: 24, letterSpacing: 4 }}>
        <span style={{ padding: '6px 14px', borderRadius: 8, backgroundColor: colors.orange, color: '#fff', fontWeight: 700 }}>24H</span>
        <span style={{ color: colors.cream }}>WATCHLIST · AUTO RE-CHECK</span>
      </div>

      {/* Alert email sliding in over the card. */}
      {alert ? (
        <div
          style={{
            position: 'absolute',
            left: 30,
            right: 30,
            top: 70,
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            padding: '22px 26px',
            borderRadius: 24,
            backgroundColor: colors.ink,
            border: '2px solid rgba(255,107,53,0.6)',
            boxShadow: '0 30px 80px rgba(0,0,0,0.55), 0 0 60px rgba(255,107,53,0.35)',
            opacity: Math.min(1, toast * 1.5),
            transform: `translateY(${(1 - toast) * -120}px)`,
          }}
        >
          <div style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: colors.orange, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <rect x={3} y={5} width={18} height={14} rx={2} />
              <path d="M3 7l9 6 9-6" />
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: fonts.mono, fontSize: 20, letterSpacing: 3, color: colors.orange }}>HAULOCK ALERT · JUST NOW</div>
            <div style={{ marginTop: 6, fontFamily: fonts.sans, fontSize: 32, fontWeight: 600, color: colors.cream }}>{ROWS[CHANGED].mc} changed</div>
            <div style={{ marginTop: 2, fontFamily: fonts.sans, fontSize: 26, color: 'rgba(245,243,238,0.7)' }}>Surety bond cancelled. Check before you haul.</div>
          </div>
        </div>
      ) : null}

      <div style={{ borderRadius: 34, backgroundColor: '#fff', padding: '28px 40px 30px', boxShadow: '0 40px 100px rgba(0,0,0,0.5)', color: colors.ink, fontFamily: fonts.sans }}>
        <div style={{ display: 'flex', alignItems: 'center', paddingBottom: 20, borderBottom: '2px solid rgba(11,30,63,0.08)' }}>
          {['#FF6B35', '#F59E0B', '#16A34A'].map((c) => (
            <span key={c} style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: c, marginRight: 12 }} />
          ))}
          <span style={{ flex: 1, textAlign: 'center', marginRight: 90, fontFamily: fonts.mono, fontSize: 24, color: 'rgba(11,30,63,0.5)' }}>haulock.com/watchlist</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 }}>
          <span style={{ fontSize: 40, fontWeight: 600 }}>Your brokers</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: fonts.mono, fontSize: 22, color: 'rgba(11,30,63,0.55)' }}>
            <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke={colors.orange} strokeWidth={2.4} strokeLinecap="round" style={{ transform: `rotate(${spin}deg)` }}>
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <path d="M21 4v5h-5" />
            </svg>
            RE-CHECKING
          </span>
        </div>

        <div style={{ marginTop: 18 }}>
          {ROWS.map((r, i) => {
            const changed = alert && i === CHANGED;
            const checked = sweep > i + 0.5 || (alert && i < CHANGED);
            const scanning = !alert && sweep > i && sweep <= i + 0.5;
            return (
              <div
                key={r.mc}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 20,
                  padding: '20px 22px',
                  marginTop: i ? 12 : 0,
                  borderRadius: 18,
                  backgroundColor: changed ? 'rgba(220,38,38,0.07)' : 'rgba(11,30,63,0.035)',
                  border: `2px solid ${changed ? 'rgba(220,38,38,0.4)' : scanning ? 'rgba(255,107,53,0.5)' : 'transparent'}`,
                  transform: changed ? `scale(${0.97 + 0.03 * flip})` : undefined,
                }}
              >
                <Icon kind={changed ? 'warn' : 'check'} color={changed ? colors.red : colors.green} size={34} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: fonts.mono, fontSize: 30, fontWeight: 600 }}>{r.mc}</div>
                  <div style={{ marginTop: 4, fontSize: 24, color: changed ? colors.red : 'rgba(11,30,63,0.5)' }}>
                    {changed ? 'Surety bond cancelled' : `${r.dot} · checked ${checked ? 'just now' : '23h ago'}`}
                  </div>
                </div>
                <span
                  style={{
                    padding: '8px 16px',
                    borderRadius: 999,
                    fontFamily: fonts.mono,
                    fontSize: 20,
                    letterSpacing: 2,
                    color: '#fff',
                    background: changed ? 'linear-gradient(90deg, #DC2626, #C2410C)' : scanning ? colors.orange : colors.green,
                  }}
                >
                  {changed ? 'CHANGED' : scanning ? 'SCANNING' : 'CLEAN'}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 22, paddingTop: 18, borderTop: '2px solid rgba(11,30,63,0.08)', fontFamily: fonts.mono, fontSize: 22, color: 'rgba(11,30,63,0.45)' }}>
          Re-checked every 24 hours · email alert on any change
        </div>
      </div>
    </div>
  );
};
