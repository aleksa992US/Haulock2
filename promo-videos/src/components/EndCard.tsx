import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import type { Vo } from '../vo';
import { clamp, colors, fonts } from '../theme';
import { Decode, HudFrame, usePop } from './fx';

// The haulock.com hero, brought to the reel: cream page, faint grid, light navy headline
// with a serif italic accent, navy pill CTA and the HIGH RISK / CAUTION ticker.
// `from` is the frame this Sequence starts at, so VO anchors can be made relative.
export type HeadlineWord = { text: string; at: number; accent?: boolean };
export type EndCardProps = {
  vo: Vo;
  from: number;
  urlAt: number;
  chip: string;
  headline: HeadlineWord[][];
  checks: string[];
  hud: { topLeft: string; bottomLeft: string; bottomRight: string };
};

export const EndCard: React.FC<EndCardProps> = ({ vo, from, urlAt, chip, headline, checks, hud }) => {
  const frame = useCurrentFrame();
  const at = (i: number) => vo.at(i) - from;
  const wipe = interpolate(frame, [0, 10], [0, 1], { ...clamp, easing: (v) => 1 - Math.pow(1 - v, 3) });
  const logo = usePop(4, { damping: 14, stiffness: 160 });
  const url = usePop(urlAt, { damping: 11, stiffness: 220 });
  const sweep = interpolate(frame, [urlAt + 4, urlAt + 22], [-200, 900], clamp);

  return (
    <AbsoluteFill style={{ clipPath: `inset(${(1 - wipe) * 100}% 0 0 0)` }}>
      <AbsoluteFill style={{ backgroundColor: colors.cream }} />
      <AbsoluteFill
        style={{
          backgroundImage: 'linear-gradient(rgba(11,30,63,0.045) 2px, transparent 2px), linear-gradient(90deg, rgba(11,30,63,0.045) 2px, transparent 2px)',
          backgroundSize: '72px 72px',
        }}
      />
      <AbsoluteFill style={{ background: 'radial-gradient(60% 30% at 50% 22%, rgba(255,107,53,0.16) 0%, rgba(245,243,238,0) 100%)' }} />
      {wipe < 1 ? (
        <div style={{ position: 'absolute', left: 0, right: 0, top: `${(1 - wipe) * 100}%`, height: 6, backgroundColor: colors.orange, boxShadow: '0 0 40px 14px rgba(255,107,53,0.6)' }} />
      ) : null}
      <HudFrame tone="light" offset={from} {...hud} />

      <div style={{ position: 'absolute', top: 330, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
        <Img
          src={staticFile('brand/logo.png')}
          style={{ width: 760, opacity: logo, transform: `translateY(${(1 - logo) * -40}px) scale(${0.85 + 0.15 * logo})` }}
        />
      </div>

      <div style={{ position: 'absolute', top: 572, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: logo }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '12px 26px',
            borderRadius: 999,
            backgroundColor: '#fff',
            border: '2px solid rgba(11,30,63,0.1)',
            fontFamily: fonts.mono,
            fontSize: 26,
            letterSpacing: 3,
            color: colors.ink,
          }}
        >
          <span style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: colors.orange, boxShadow: '0 0 0 6px rgba(255,107,53,0.2)' }} />
          <Decode text={chip} at={8} dur={16} />
        </div>
      </div>

      <div style={{ position: 'absolute', top: 680, left: 50, right: 50, textAlign: 'center', color: colors.ink, lineHeight: 1.02 }}>
        {headline.map((line, li) => (
          <div key={li} style={{ fontFamily: fonts.sans, fontWeight: 400, fontSize: 132, letterSpacing: -5 }}>
            {line.map((w, wi) => (
              <Reveal key={wi} at={at(w.at)}>
                {w.accent ? (
                  <span style={{ fontFamily: fonts.serif, fontStyle: 'italic', fontSize: 150, letterSpacing: -2, color: colors.orange }}>{w.text}</span>
                ) : (
                  w.text + (wi < line.length - 1 ? ' ' : '')
                )}
              </Reveal>
            ))}
          </div>
        ))}
      </div>

      {frame >= urlAt ? (
        <div style={{ position: 'absolute', top: 1010, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
          <div
            style={{
              position: 'relative',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              gap: 26,
              padding: '26px 58px 30px',
              borderRadius: 999,
              backgroundColor: colors.navy,
              color: '#fff',
              fontFamily: fonts.sans,
              fontWeight: 500,
              fontSize: 76,
              letterSpacing: -2,
              boxShadow: '0 30px 60px rgba(11,30,63,0.35)',
              transform: `scale(${interpolate(url, [0, 1], [1.35, 1])})`,
              opacity: Math.min(1, url * 1.5),
            }}
          >
            haulock.com
            <svg width={60} height={60} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
            <div
              style={{
                position: 'absolute',
                top: -60,
                bottom: -60,
                left: sweep,
                width: 110,
                transform: 'rotate(20deg)',
                background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.35), rgba(255,255,255,0))',
              }}
            />
          </div>
        </div>
      ) : null}

      <div style={{ position: 'absolute', top: 1180, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 44, opacity: interpolate(frame, [urlAt + 6, urlAt + 14], [0, 1], clamp) }}>
        {checks.map((c) => (
          <Check key={c}>{c}</Check>
        ))}
      </div>

      <Ticker />
    </AbsoluteFill>
  );
};

const Reveal: React.FC<{ at: number; children: React.ReactNode }> = ({ at, children }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at - 2, at + 6], [0, 1], { ...clamp, easing: (v) => 1 - Math.pow(1 - v, 3) });
  return (
    <span style={{ display: 'inline-block', opacity: p, transform: `translateY(${(1 - p) * 36}px)`, filter: `blur(${(1 - p) * 10}px)`, whiteSpace: 'pre' }}>
      {children}
    </span>
  );
};

const Check: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: fonts.sans, fontSize: 34, color: 'rgba(11,30,63,0.7)' }}>
    <svg width={34} height={34} viewBox="0 0 24 24" fill="none" stroke={colors.green} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx={12} cy={12} r={10} />
      <path d="m8 12 3 3 5-6" />
    </svg>
    {children}
  </div>
);

// The landing page's risk ticker.
const TICKER = [
  { id: 'MC-612•••', kind: 'BROKER', verdict: 'HIGH RISK', color: colors.red },
  { id: 'DOT-1547•••', kind: 'CARRIER', verdict: 'CAUTION', color: colors.amber },
  { id: 'MC-921•••', kind: 'BROKER', verdict: 'HIGH RISK', color: colors.red },
  { id: 'DOT-3271•••', kind: 'CARRIER', verdict: 'CAUTION', color: colors.amber },
];

const Ticker: React.FC = () => {
  const frame = useCurrentFrame();
  const items = [...TICKER, ...TICKER, ...TICKER];
  return (
    <div
      style={{
        position: 'absolute',
        top: 1290,
        left: 0,
        right: 0,
        height: 92,
        overflow: 'hidden',
        backgroundColor: '#fff',
        borderTop: '2px solid rgba(11,30,63,0.08)',
        borderBottom: '2px solid rgba(11,30,63,0.08)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 60, height: '100%', whiteSpace: 'nowrap', transform: `translateX(${-frame * 4}px)`, fontFamily: fonts.mono }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <span style={{ fontSize: 26, color: 'rgba(11,30,63,0.45)' }}>{it.id}</span>
            <span style={{ fontSize: 20, letterSpacing: 2, padding: '6px 12px', borderRadius: 6, backgroundColor: 'rgba(11,30,63,0.06)', color: 'rgba(11,30,63,0.55)' }}>{it.kind}</span>
            <span style={{ fontSize: 28, fontWeight: 600, letterSpacing: 3, color: it.color }}>{it.verdict}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
