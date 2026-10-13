import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { clamp, colors, fonts } from '../theme';
import { Decode, usePop } from './fx';

// Lowest published monthly price on each vendor's own pricing page, checked 12 Oct 2026
// (see REELS.md for URLs). Re-check before publishing — vendors change these pages.
export type Competitor = { name: string; by: string; price: number; at: number };

const MAX = 515;
const BAR_LEFT = 360;
const BAR_W = 390;

export const PriceBoard: React.FC<{
  rows: Competitor[];
  haulockAt: number;
  freeAt: number;
  sourcesAt: number;
  paidFrom: string;
  disclaimer: string;
}> = ({ rows, haulockAt, freeAt, sourcesAt, paidFrom, disclaimer }) => {
  const frame = useCurrentFrame();
  const enter = usePop(0, { damping: 16, stiffness: 150 });
  const dim = interpolate(frame, [haulockAt, haulockAt + 8], [1, 0.45], clamp);
  return (
    <div
      style={{
        position: 'absolute',
        left: 60,
        right: 60,
        top: 600,
        padding: '28px 34px 24px',
        borderRadius: 30,
        background: 'rgba(4,11,26,0.82)',
        border: `2px solid ${colors.line}`,
        boxShadow: '0 40px 100px rgba(0,0,0,0.5)',
        opacity: enter,
        transform: `translateY(${(1 - enter) * 120}px)`,
        fontFamily: fonts.mono,
        color: colors.cream,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 22, letterSpacing: 3, color: colors.dim, marginBottom: 14 }}>
        <Decode text="▸ CARRIER VETTING" at={2} dur={12} style={{ color: colors.orange }} />
        <span>STARTING / MONTH</span>
      </div>
      <div style={{ opacity: dim }}>
        {rows.map((r) => (
          <PriceRow key={r.name} row={r} />
        ))}
      </div>
      <HaulockRow at={haulockAt} freeAt={freeAt} sourcesAt={sourcesAt} paidFrom={paidFrom} />
      <div style={{ marginTop: 18, fontSize: 18, lineHeight: 1.4, color: 'rgba(245,243,238,0.45)' }}>{disclaimer}</div>
    </div>
  );
};

const PriceRow: React.FC<{ row: Competitor }> = ({ row }) => {
  const frame = useCurrentFrame();
  const show = interpolate(frame, [row.at - 2, row.at + 6], [0, 1], { ...clamp, easing: (v) => 1 - Math.pow(1 - v, 3) });
  const grow = interpolate(frame, [row.at, row.at + 14], [0, 1], { ...clamp, easing: (v) => 1 - Math.pow(1 - v, 3) });
  const value = Math.round(row.price * grow);
  const heat = row.price / MAX;
  return (
    <div style={{ position: 'relative', height: 86, display: 'flex', alignItems: 'center', opacity: show, borderTop: `1px solid ${colors.line}` }}>
      <div style={{ width: BAR_LEFT - 20 }}>
        <div style={{ fontFamily: fonts.sans, fontWeight: 500, fontSize: 32, color: colors.cream }}>{row.name}</div>
        {row.by ? <div style={{ fontSize: 18, letterSpacing: 2, color: colors.dim, marginTop: 2 }}>{row.by.toUpperCase()}</div> : null}
      </div>
      <div style={{ position: 'relative', width: BAR_W, height: 26, borderRadius: 13, backgroundColor: 'rgba(245,243,238,0.06)' }}>
        <div
          style={{
            width: `${(row.price / MAX) * 100 * grow}%`,
            height: '100%',
            borderRadius: 13,
            background: `linear-gradient(90deg, rgba(220,38,38,${0.35 + heat * 0.4}), rgba(248,113,113,${0.5 + heat * 0.5}))`,
            boxShadow: `0 0 ${10 + heat * 20}px rgba(220,38,38,0.4)`,
          }}
        />
      </div>
      <div style={{ position: 'absolute', right: 0, fontWeight: 700, fontSize: 38, color: colors.redGlow }}>${value}</div>
    </div>
  );
};

const HaulockRow: React.FC<{ at: number; freeAt: number; sourcesAt: number; paidFrom: string }> = ({ at, freeAt, sourcesAt, paidFrom }) => {
  const frame = useCurrentFrame();
  const enter = usePop(at, { damping: 13, stiffness: 200 });
  const free = usePop(freeAt, { damping: 9, stiffness: 260 });
  const chip = usePop(sourcesAt, { damping: 12, stiffness: 220 });
  if (frame < at - 2) return null;
  return (
    <div
      style={{
        position: 'relative',
        marginTop: 10,
        padding: '18px 22px',
        borderRadius: 20,
        background: 'linear-gradient(90deg, rgba(255,107,53,0.22), rgba(255,107,53,0.08))',
        border: `2px solid ${colors.orange}`,
        boxShadow: `0 0 ${40 * Math.min(1, free)}px rgba(255,107,53,0.55)`,
        display: 'flex',
        alignItems: 'center',
        opacity: Math.min(1, enter * 1.4),
        transform: `scale(${0.92 + 0.08 * enter})`,
      }}
    >
      <div style={{ width: BAR_LEFT - 42 }}>
        <div style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 36, color: '#fff' }}>Haulock</div>
        <div style={{ fontSize: 18, letterSpacing: 2, color: '#FFD2BF', marginTop: 2 }}>PAID PLANS FROM {paidFrom}/MO</div>
      </div>
      {frame >= sourcesAt ? (
        <div
          style={{
            padding: '8px 16px',
            borderRadius: 999,
            backgroundColor: 'rgba(74,222,128,0.15)',
            border: '2px solid rgba(74,222,128,0.7)',
            color: '#BBF7D0',
            fontSize: 20,
            letterSpacing: 2,
            transform: `scale(${chip})`,
          }}
        >
          ✓ 14 DATA SOURCES
        </div>
      ) : null}
      {frame >= freeAt ? (
        <div
          style={{
            position: 'absolute',
            right: 22,
            fontFamily: fonts.serif,
            fontStyle: 'italic',
            fontSize: 84,
            lineHeight: 1,
            color: colors.orange,
            textShadow: '0 0 30px rgba(255,107,53,0.6)',
            transform: `scale(${interpolate(free, [0, 1], [1.8, 1])}) rotate(${(1 - Math.min(free, 1)) * -10}deg)`,
          }}
        >
          Free
        </div>
      ) : null}
    </div>
  );
};
