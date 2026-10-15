import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { Background } from '../components/Background';
import { Scanlines } from '../components/fx';
import { SourcesRadar } from '../components/SourcesRadar';
import { VerdictCard } from '../components/VerdictCard';
import { Icon } from '../components/VerifyCard';
import { colors, fonts } from '../theme';

// Feed posts (4:5) in the reels' look. They reuse the reels' animated components, so
// each post is a short composition rendered at POST_FRAME, once everything has settled.
export const POST_W = 1080;
export const POST_H = 1350;
export const POST_DURATION = 150;
export const POST_FRAME = 140;

type Token = { text: string; accent?: boolean; color?: string };

export const Headline: React.FC<{ lines: Token[][]; top: number; size?: number; accentSize?: number }> = ({ lines, top, size = 92, accentSize = 128 }) => (
  <div style={{ position: 'absolute', left: 60, right: 60, top, textAlign: 'center' }}>
    {lines.map((line, i) => (
      <div key={i} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'baseline', columnGap: 22 }}>
        {line.map((t, j) =>
          t.accent ? (
            <span key={j} style={{ fontFamily: fonts.serif, fontStyle: 'italic', fontSize: accentSize, letterSpacing: -2, lineHeight: 1.04, color: t.color ?? colors.orange, textShadow: '0 6px 30px rgba(0,0,0,0.55)' }}>
              {t.text}
            </span>
          ) : (
            <span key={j} style={{ fontFamily: fonts.sans, fontWeight: 400, fontSize: size, letterSpacing: -3, lineHeight: 1.08, color: t.color ?? colors.cream, textShadow: '0 6px 30px rgba(0,0,0,0.55)' }}>
              {t.text}
            </span>
          ),
        )}
      </div>
    ))}
  </div>
);

// Corner brackets + mono readouts, sized for 4:5.
export const PostFrame: React.FC<{ topLeft: string; topRight: string }> = ({ topLeft, topRight }) => {
  const stroke = 'rgba(245,243,238,0.5)';
  const L = 56;
  const corner = (x: number, y: number, dx: number, dy: number) => (
    <path d={`M${x + dx * L} ${y} L${x} ${y} L${x} ${y + dy * L}`} fill="none" stroke={stroke} strokeWidth={3} />
  );
  const label: React.CSSProperties = { position: 'absolute', top: 50, fontFamily: fonts.mono, fontWeight: 500, fontSize: 20, letterSpacing: 3, color: colors.dim };
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <svg width={POST_W} height={POST_H} style={{ position: 'absolute', inset: 0 }}>
        {corner(36, 36, 1, 1)}
        {corner(POST_W - 36, 36, -1, 1)}
        {corner(36, POST_H - 36, 1, -1)}
        {corner(POST_W - 36, POST_H - 36, -1, -1)}
      </svg>
      <div style={{ ...label, left: 66 }}>{topLeft}</div>
      <div style={{ ...label, right: 66, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: colors.orange }} />
        {topRight}
      </div>
    </AbsoluteFill>
  );
};

// Bottom strip: navy haulock.com pill (as on the end card) + the free-plan facts.
export const Cta: React.FC<{ label: string; facts: string[] }> = ({ label, facts }) => (
  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 74, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', height: 78, padding: '0 28px', borderRadius: 999, backgroundColor: colors.cream, boxShadow: '0 16px 50px rgba(0,0,0,0.45)' }}>
        <Img src={staticFile('brand/logo.png')} style={{ height: 46 }} />
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          height: 78,
          padding: '0 34px',
          borderRadius: 999,
          backgroundColor: colors.orange,
          color: '#fff',
          fontFamily: fonts.sans,
          fontWeight: 600,
          fontSize: 34,
          boxShadow: '0 16px 50px rgba(255,107,53,0.45)',
        }}
      >
        {label} <span style={{ fontWeight: 400 }}>· haulock.com →</span>
      </div>
    </div>
    <div style={{ display: 'flex', gap: 26, fontFamily: fonts.mono, fontSize: 20, letterSpacing: 2, color: colors.dim }}>
      {facts.map((f) => (
        <span key={f} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon kind="check" color={colors.greenGlow} size={22} /> {f.toUpperCase()}
        </span>
      ))}
    </div>
  </div>
);

export const Post: React.FC<{ hud: [string, string]; children: React.ReactNode }> = ({ hud, children }) => (
  <AbsoluteFill style={{ backgroundColor: colors.void, fontFamily: fonts.sans, overflow: 'hidden' }}>
    <Background />
    {children}
    <PostFrame topLeft={hud[0]} topRight={hud[1]} />
    <Scanlines opacity={0.7} />
  </AbsoluteFill>
);

// Brokers: one score, one verdict — the carrier lookup landing on WALK AWAY.
export const BrokersPost: React.FC = () => (
  <Post hud={['HAULOCK // CARRIER VETTING', 'FOR BROKERS']}>
    <Headline
      top={104}
      size={86}
      accentSize={110}
      lines={[
        [{ text: 'Hey,' }, { text: 'brokers.', accent: true }],
        [{ text: 'Book it', accent: true, color: colors.greenGlow }, { text: 'or' }, { text: 'walk away.', accent: true, color: colors.redGlow }],
      ]}
    />
    <div style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, transform: 'translateY(-200px) scale(0.86)', transformOrigin: '540px 590px' }}>
      <VerdictCard scoreAt={4} bookAt={8} walkAt={40} />
    </div>
    <Cta label="Try for free" facts={['14 data sources', '3 free lookups a month']} />
  </Post>
);

// Carriers: the 14-source radar behind every broker check.
export const CarriersPost: React.FC = () => (
  <Post hud={['HAULOCK // BROKER VETTING', 'FOR CARRIERS']}>
    <Headline top={100} size={84} accentSize={116} lines={[[{ text: 'Check the broker' }], [{ text: 'before you' }], [{ text: 'hook the trailer.', accent: true }]]} />
    <div style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, transform: 'translateY(-305px) scale(0.78)', transformOrigin: '540px 1010px' }}>
      <SourcesRadar start={4} end={60} />
    </div>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 1058, display: 'flex', justifyContent: 'center', gap: 18, fontFamily: fonts.mono, fontWeight: 600, fontSize: 24, letterSpacing: 3 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 22px', borderRadius: 999, backgroundColor: 'rgba(22,163,74,0.16)', border: '2px solid rgba(74,222,128,0.5)', color: colors.greenGlow }}>
        <Icon kind="check" color={colors.greenGlow} size={26} /> TAKE THE LOAD
      </span>
      <span style={{ alignSelf: 'center', color: colors.dim, fontWeight: 500 }}>OR</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 22px', borderRadius: 999, backgroundColor: 'rgba(220,38,38,0.16)', border: '2px solid rgba(248,113,113,0.5)', color: colors.redGlow }}>
        <Icon kind="warn" color={colors.redGlow} size={26} /> WALK AWAY
      </span>
    </div>
    <Cta label="Try for free" facts={['MC · bond · address · website', '3 free lookups a month']} />
  </Post>
);

// Drivers: the PDF check that catches an edited rate con (metadata forensics).
export const DriversPost: React.FC = () => (
  <Post hud={['HAULOCK // PDF FORENSICS', 'FOR DRIVERS']}>
    <Headline top={104} lines={[[{ text: 'Driver… was your' }], [{ text: 'rate con', accent: true }, { text: 'edited?', accent: true, color: colors.redGlow }]]} />
    <PdfCheckCard top={420} />
    <Cta label="Check yours for free" facts={['Reads the hidden PDF data', '3 free PDF checks a month']} />
  </Post>
);

// Site-style result card for the PDF check: tamper score + the signals it found.
// Rows mirror real lib/pdf-forensics.ts findings.
const PdfCheckCard: React.FC<{ top: number }> = ({ top }) => {
  const R = 130;
  const C = { x: 160, y: 150 };
  const p = 0.72;
  const arc = (q: number) => {
    const a = Math.PI * (1 - q);
    return `M ${C.x - R} ${C.y} A ${R} ${R} 0 0 1 ${C.x + R * Math.cos(a)} ${C.y - R * Math.sin(a)}`;
  };
  const rows: { icon: 'clock' | 'file' | 'warn'; text: string }[] = [
    { icon: 'clock', text: 'PDF edited 2 days after creation' },
    { icon: 'file', text: 'Processed with an online PDF editor' },
    { icon: 'warn', text: 'Re-saved by different software' },
  ];
  return (
    <div style={{ position: 'absolute', left: 80, right: 80, top }}>
      <div
        style={{
          position: 'absolute',
          right: -10,
          top: -26,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 24px',
          borderRadius: 999,
          background: 'linear-gradient(90deg, #DC2626, #C2410C)',
          color: '#fff',
          fontFamily: fonts.mono,
          fontSize: 22,
          letterSpacing: 3,
        }}
      >
        <Icon kind="warn" color="#fff" size={24} /> LIKELY TAMPERED
      </div>
      <div style={{ borderRadius: 32, backgroundColor: '#fff', padding: '26px 36px 28px', boxShadow: '0 0 0 3px rgba(220,38,38,0.45), 0 40px 120px rgba(220,38,38,0.3)', color: colors.ink }}>
        <div style={{ display: 'flex', alignItems: 'center', paddingBottom: 18, borderBottom: '2px solid rgba(11,30,63,0.08)' }}>
          {['#FF6B35', '#F59E0B', '#16A34A'].map((c) => (
            <span key={c} style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c, marginRight: 10 }} />
          ))}
          <span style={{ flex: 1, textAlign: 'center', marginRight: 70, fontFamily: fonts.mono, fontSize: 22, color: 'rgba(11,30,63,0.5)' }}>haulock.com/verify</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 30, marginTop: 22 }}>
          <div style={{ position: 'relative', width: 320, height: 170, flexShrink: 0 }}>
            <svg width={320} height={170} viewBox="0 0 320 170">
              <path d={arc(1)} fill="none" stroke="rgba(11,30,63,0.1)" strokeWidth={22} strokeLinecap="round" />
              <path d={arc(p)} fill="none" stroke={colors.red} strokeWidth={22} strokeLinecap="round" />
            </svg>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 58, textAlign: 'center', fontFamily: fonts.serif, fontStyle: 'italic', fontSize: 104, lineHeight: 1, color: colors.red }}>72</div>
          </div>
          <div>
            <div style={{ fontFamily: fonts.mono, fontSize: 20, letterSpacing: 3, color: 'rgba(11,30,63,0.5)' }}>PDF FORENSICS</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, fontFamily: fonts.mono, fontWeight: 600, fontSize: 26 }}>
              <Icon kind="file" color={colors.ink} size={28} /> rate-con-7731.pdf
            </div>
            <div style={{ marginTop: 8, fontSize: 24, color: 'rgba(11,30,63,0.6)' }}>Tamper score · 0–100</div>
          </div>
        </div>
        <div style={{ marginTop: 18 }}>
          {rows.map((r) => (
            <div key={r.text} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', marginTop: 10, borderRadius: 16, backgroundColor: 'rgba(220,38,38,0.06)', border: '2px solid rgba(220,38,38,0.25)' }}>
              <Icon kind={r.icon} color={colors.red} size={30} />
              <span style={{ fontSize: 28 }}>{r.text}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '2px solid rgba(11,30,63,0.08)', fontFamily: fonts.mono, fontSize: 20, color: 'rgba(11,30,63,0.45)' }}>
          Same rate con the broker sent? Now you know.
        </div>
      </div>
    </div>
  );
};
