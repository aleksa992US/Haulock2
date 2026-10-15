import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { Icon } from '../components/VerifyCard';
import { colors, fonts } from '../theme';
import { POST_H, POST_W } from './Posts';

// The reels' cream end card as a 4:5 slide: logo, chip, headline with a serif accent,
// numbered points, the haulock.com pill and the plan facts.
export type CreamCtaProps = { hudRight: string; chip: string; cta: [string[], string[]]; steps: string[]; facts: string[]; stepsLeft?: number };

export const CreamCta: React.FC<CreamCtaProps> = ({ hudRight, chip, cta, steps, facts, stepsLeft = 150 }) => {
  const stroke = 'rgba(11,30,63,0.35)';
  const L = 56;
  const corner = (x: number, y: number, dx: number, dy: number) => <path d={`M${x + dx * L} ${y} L${x} ${y} L${x} ${y + dy * L}`} fill="none" stroke={stroke} strokeWidth={3} />;
  return (
    <AbsoluteFill style={{ backgroundColor: colors.cream, fontFamily: fonts.sans, color: colors.ink, overflow: 'hidden' }}>
      <AbsoluteFill style={{ backgroundImage: 'linear-gradient(rgba(11,30,63,0.045) 2px, transparent 2px), linear-gradient(90deg, rgba(11,30,63,0.045) 2px, transparent 2px)', backgroundSize: '72px 72px' }} />
      <AbsoluteFill style={{ background: 'radial-gradient(60% 30% at 50% 20%, rgba(255,107,53,0.16) 0%, rgba(245,243,238,0) 100%)' }} />
      <svg width={POST_W} height={POST_H} style={{ position: 'absolute', inset: 0 }}>
        {corner(36, 36, 1, 1)}
        {corner(POST_W - 36, 36, -1, 1)}
        {corner(36, POST_H - 36, 1, -1)}
        {corner(POST_W - 36, POST_H - 36, -1, -1)}
      </svg>
      <div style={{ position: 'absolute', top: 50, left: 66, fontFamily: fonts.mono, fontWeight: 500, fontSize: 20, letterSpacing: 3, color: 'rgba(11,30,63,0.55)' }}>HAULOCK.COM</div>
      <div style={{ position: 'absolute', top: 50, right: 66, fontFamily: fonts.mono, fontWeight: 500, fontSize: 20, letterSpacing: 3, color: 'rgba(11,30,63,0.55)' }}>{hudRight}</div>

      <div style={{ position: 'absolute', top: 120, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
        <Img src={staticFile('brand/logo.png')} style={{ width: 560 }} />
      </div>
      <div style={{ position: 'absolute', top: 300, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 26px', borderRadius: 999, backgroundColor: '#fff', border: '2px solid rgba(11,30,63,0.1)', fontFamily: fonts.mono, fontSize: 24, letterSpacing: 3 }}>
          <span style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: colors.orange, boxShadow: '0 0 0 6px rgba(255,107,53,0.2)' }} />
          {chip}
        </div>
      </div>
      <div style={{ position: 'absolute', top: 380, left: 50, right: 50, textAlign: 'center', lineHeight: 1.02 }}>
        <div style={{ fontWeight: 400, fontSize: 112, letterSpacing: -5 }}>{cta[0][0]}</div>
        <div style={{ fontWeight: 400, fontSize: 112, letterSpacing: -5 }}>
          {cta[1][0]} <span style={{ fontFamily: fonts.serif, fontStyle: 'italic', fontSize: 130, letterSpacing: -2, color: colors.orange }}>{cta[1][1]}</span>
        </div>
      </div>
      <div style={{ position: 'absolute', top: 650, left: stepsLeft, right: 110, display: 'flex', flexDirection: 'column', gap: 26 }}>
        {steps.map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <span style={{ flexShrink: 0, width: 58, height: 58, borderRadius: 29, backgroundColor: colors.navy, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.mono, fontWeight: 700, fontSize: 28 }}>{i + 1}</span>
            <span style={{ fontSize: 38, letterSpacing: -0.5 }}>{s}</span>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', top: 980, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '22px 54px 26px', borderRadius: 999, backgroundColor: colors.navy, color: '#fff', fontWeight: 500, fontSize: 70, letterSpacing: -2, boxShadow: '0 30px 60px rgba(11,30,63,0.35)' }}>
          haulock.com
          <svg width={54} height={54} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </div>
      </div>
      <div style={{ position: 'absolute', top: 1146, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 40 }}>
        {facts.map((f) => (
          <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 32, color: 'rgba(11,30,63,0.7)' }}>
            <Icon kind="check" color={colors.green} size={32} /> {f}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
