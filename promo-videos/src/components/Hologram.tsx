import React from 'react';
import { interpolate, random, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp, colors, fonts } from '../theme';
import { Decode, glitchAt, rgbSplit, usePop } from './fx';

// Frames relative to the scene's Sequence.
export type HoloTiming = {
  payAt: number; // "fourteen hundred": the broker's rate lights up
  editAt: number; // "eleven hundred": the rate glitches to the edited number
  scanAt: number; // "Haulock…": scan beam sweeps the file
  splitAt: number; // "inside the PDF": the file shrinks, its metadata opens up
  verdictAt: number; // "catches": tamper score lands
};

const DOC_W = 760;
const DOC_H = 700;
const DOC_LEFT = (1080 - DOC_W) / 2;
const DOC_TOP = 590;

// The rate con as a floating glass panel, then the metadata Haulock reads out of it.
export const HoloScene: React.FC<{ t: HoloTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const split = spring({ frame: frame - t.splitAt, fps, config: { damping: 18, stiffness: 110 } });
  const sway = Math.sin(frame / 40) * 4;

  // Centered and large for the edit, then parked top-left as the "source file".
  const scale = interpolate(split, [0, 1], [1, 0.54]);
  const x = interpolate(split, [0, 1], [0, -238]);
  const y = interpolate(split, [0, 1], [0, -10]);
  const rotY = interpolate(split, [0, 1], [-12, 18]) + sway;

  return (
    <>
      <div style={{ position: 'absolute', left: DOC_LEFT, top: DOC_TOP, width: DOC_W, height: DOC_H, perspective: 1800 }}>
        <div
          style={{
            width: '100%',
            height: '100%',
            transformOrigin: '50% 0%',
            transform: `translate(${x}px, ${y}px) scale(${scale}) rotateX(9deg) rotateY(${rotY}deg)`,
          }}
        >
          <DocPanel t={t} />
        </div>
      </div>
      {split > 0.02 ? <Connector progress={split} /> : null}
      <DiffPanel at={t.editAt + 5} until={t.scanAt} />
      <Analyzing from={t.splitAt + 6} to={t.verdictAt} />
      <VerdictCard at={t.verdictAt} />
      <MetaPanel at={t.splitAt + 8} verdictAt={t.verdictAt} />
    </>
  );
};

const DocPanel: React.FC<{ t: HoloTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  const build = interpolate(frame, [0, 16], [0, 1], { ...clamp, easing: (v) => 1 - Math.pow(1 - v, 2) });
  const flicker = frame < 18 && random(`f${frame}`) < 0.25 ? 0.55 : 1;
  const edited = frame >= t.editAt;
  const g = glitchAt(frame, t.editAt, 12);
  const caught = frame >= t.verdictAt;
  const edge = caught ? colors.red : colors.orange;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        borderRadius: 28,
        padding: '40px 46px',
        backgroundColor: 'rgba(6,16,38,0.88)',
        backgroundImage: 'linear-gradient(160deg, rgba(245,243,238,0.12) 0%, rgba(245,243,238,0.03) 55%, rgba(255,107,53,0.08) 100%)',
        border: `2px solid ${edge}`,
        boxShadow: `0 0 70px ${caught ? 'rgba(220,38,38,0.45)' : 'rgba(255,107,53,0.3)'}, inset 0 0 60px rgba(255,107,53,0.08)`,
        clipPath: `inset(0 0 ${(1 - build) * 100}% 0 round 28px)`,
        opacity: flicker,
        overflow: 'hidden',
        color: colors.cream,
        fontFamily: fonts.mono,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 22, letterSpacing: 3, color: colors.dim }}>
        <span style={{ color: colors.orange }}>● SOURCE FILE</span>
        <span>rate-con-4821.pdf</span>
      </div>
      <div style={{ marginTop: 22, fontWeight: 700, fontSize: 44, letterSpacing: 2 }}>RATE CONFIRMATION</div>
      <div style={{ height: 2, backgroundColor: colors.line, margin: '18px 0 20px' }} />
      <Grid>
        <Field label="BROKER"><Bar w={250} /></Field>
        <Field label="MC #"><Bar w={150} /></Field>
        <Field label="PICKUP">Chicago, IL</Field>
        <Field label="DELIVERY">Dallas, TX</Field>
        <Field label="EQUIPMENT">53' Dry Van</Field>
        <Field label="LOAD">#4821</Field>
      </Grid>
      <div
        style={{
          marginTop: 22,
          padding: '16px 26px 18px',
          borderRadius: 18,
          border: `2px solid ${edited ? 'rgba(248,113,113,0.7)' : frame >= t.payAt ? 'rgba(74,222,128,0.7)' : colors.line}`,
          backgroundColor: edited ? 'rgba(220,38,38,0.12)' : frame >= t.payAt ? 'rgba(22,163,74,0.12)' : 'rgba(245,243,238,0.04)',
        }}
      >
        <div style={{ fontSize: 22, letterSpacing: 3, color: colors.dim }}>TOTAL CARRIER PAY</div>
        <div
          style={{
            marginTop: 6,
            fontWeight: 700,
            fontSize: 92,
            letterSpacing: -2,
            color: edited ? colors.redGlow : frame >= t.payAt ? colors.greenGlow : colors.cream,
            textShadow: rgbSplit(g * 10),
            transform: g ? `translateX(${g * 14 * (frame % 2 ? 1 : -1)}px)` : undefined,
          }}
        >
          {g > 0 ? scramble('$1,100.00', frame) : edited ? '$1,100.00' : '$1,400.00'}
        </div>
      </div>
      <ScanBeam at={t.scanAt} />
      {build < 1 ? (
        <div style={{ position: 'absolute', left: 0, right: 0, top: `${build * 100}%`, height: 4, backgroundColor: colors.orange, boxShadow: '0 0 24px 6px rgba(255,107,53,0.7)' }} />
      ) : null}
    </div>
  );
};

const scramble = (text: string, frame: number) =>
  text
    .split('')
    .map((ch, i) => (/[0-9]/.test(ch) && random(`s${frame}-${i}`) > 0.5 ? String(Math.floor(random(`n${frame}-${i}`) * 10)) : ch))
    .join('');

const Grid: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 16, columnGap: 30 }}>{children}</div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <div style={{ fontSize: 20, letterSpacing: 3, color: colors.dim, marginBottom: 6 }}>{label}</div>
    <div style={{ fontFamily: fonts.sans, fontWeight: 500, fontSize: 36 }}>{children}</div>
  </div>
);

const Bar: React.FC<{ w: number }> = ({ w }) => <div style={{ width: w, height: 34, borderRadius: 6, backgroundColor: 'rgba(245,243,238,0.85)' }} />;

const ScanBeam: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const DUR = 26;
  if (frame < at || frame > at + DUR + 6) return null;
  const y = interpolate(frame, [at, at + DUR], [-20, DOC_H], { ...clamp, easing: (v) => v * v * (3 - 2 * v) });
  const fade = interpolate(frame, [at + DUR, at + DUR + 6], [1, 0], clamp);
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: fade }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: Math.max(0, y), background: 'linear-gradient(180deg, rgba(255,107,53,0) 0%, rgba(255,107,53,0.18) 100%)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: y, height: 5, backgroundColor: colors.orange, boxShadow: '0 0 34px 12px rgba(255,107,53,0.65)' }} />
      <div style={{ position: 'absolute', right: 20, top: y - 50, padding: '6px 14px', borderRadius: 8, backgroundColor: colors.orange, color: '#fff', fontSize: 22, fontWeight: 700, letterSpacing: 2 }}>
        HAULOCK SCAN
      </div>
    </div>
  );
};

// What happened to the money, shown under the file once it is edited.
const DiffPanel: React.FC<{ at: number; until: number }> = ({ at, until }) => {
  const frame = useCurrentFrame();
  const enter = usePop(at, { damping: 16, stiffness: 170 });
  const exit = interpolate(frame, [until - 6, until], [1, 0], clamp);
  if (frame < at || frame >= until) return null;
  const rows = [
    { k: 'BROKER SENT', v: '$1,400.00', c: colors.greenGlow },
    { k: 'YOU RECEIVED', v: '$1,100.00', c: colors.redGlow },
    { k: 'MISSING', v: '−$300.00', c: colors.orange, big: true },
  ];
  return (
    <div
      style={{
        position: 'absolute',
        left: 90,
        right: 90,
        top: 1322,
        padding: '22px 34px',
        borderRadius: 24,
        background: 'rgba(4,11,26,0.78)',
        border: `2px solid ${colors.line}`,
        boxShadow: '0 30px 70px rgba(0,0,0,0.5)',
        opacity: Math.min(enter, exit),
        transform: `translateY(${(1 - enter) * 60}px)`,
        fontFamily: fonts.mono,
      }}
    >
      {rows.map((r, i) => {
        const p = interpolate(frame, [at + i * 5, at + i * 5 + 6], [0, 1], clamp);
        return (
          <div key={r.k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', opacity: p, padding: '6px 0', borderTop: i ? `1px solid ${colors.line}` : undefined }}>
            <span style={{ fontSize: 24, letterSpacing: 3, color: colors.dim }}>{r.k}</span>
            <span style={{ fontWeight: 700, fontSize: r.big ? 52 : 38, color: r.c }}>{r.v}</span>
          </div>
        );
      })}
    </div>
  );
};

// Dashed line from the parked file to the metadata panel.
const Connector: React.FC<{ progress: number }> = ({ progress }) => (
  <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
    <path
      d="M 330 990 C 330 1010, 330 1020, 330 1040"
      fill="none"
      stroke={colors.orange}
      strokeWidth={3}
      strokeDasharray="8 8"
      opacity={progress}
    />
  </svg>
);

const META = [
  { k: 'CREATOR', v: 'Microsoft Word', flag: false },
  { k: 'PRODUCER', v: 'Online PDF editor', flag: true },
  { k: 'CREATED', v: 'Oct 12 · 09:41', flag: false },
  { k: 'MODIFIED', v: 'Oct 13 · 22:17', flag: true },
];

const MetaPanel: React.FC<{ at: number; verdictAt: number }> = ({ at, verdictAt }) => {
  const frame = useCurrentFrame();
  const enter = usePop(at, { damping: 16, stiffness: 160 });
  if (frame < at) return null;
  const caught = frame >= verdictAt;
  return (
    <div
      style={{
        position: 'absolute',
        left: 70,
        right: 70,
        top: 1040,
        padding: '26px 34px 22px',
        borderRadius: 26,
        background: 'rgba(4,11,26,0.82)',
        border: `2px solid ${caught ? 'rgba(220,38,38,0.8)' : 'rgba(255,107,53,0.6)'}`,
        boxShadow: caught ? '0 0 60px rgba(220,38,38,0.35)' : '0 0 50px rgba(255,107,53,0.2)',
        opacity: enter,
        transform: `translateY(${(1 - enter) * 80}px) scale(${0.94 + 0.06 * enter})`,
        fontFamily: fonts.mono,
        color: colors.cream,
      }}
    >
      <div style={{ fontSize: 24, letterSpacing: 4, color: colors.orange, marginBottom: 14 }}>
        <Decode text="▸ HIDDEN METADATA" at={at} dur={12} />
      </div>
      {META.map((m, i) => {
        const rowAt = at + 6 + i * 5;
        if (frame < rowAt) return null;
        const red = caught && m.flag;
        return (
          <div
            key={m.k}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              marginTop: 4,
              borderRadius: 12,
              backgroundColor: red ? 'rgba(220,38,38,0.2)' : 'transparent',
            }}
          >
            <span style={{ fontSize: 24, letterSpacing: 3, color: colors.dim, width: 210 }}>{m.k}</span>
            <span style={{ flex: 1, fontSize: 34, fontWeight: 500, color: red ? colors.redGlow : colors.cream }}>
              <Decode text={m.v} at={rowAt} dur={10} />
            </span>
            {red ? <span style={{ fontSize: 34, color: colors.redGlow }}>⚠</span> : null}
          </div>
        );
      })}
    </div>
  );
};

// Placeholder in the verdict slot while the file is being read.
const Analyzing: React.FC<{ from: number; to: number }> = ({ from, to }) => {
  const frame = useCurrentFrame();
  if (frame < from || frame >= to) return null;
  const p = interpolate(frame, [from, to], [0, 0.96], clamp);
  return (
    <div style={{ position: 'absolute', left: 590, top: 640, width: 420, fontFamily: fonts.mono, color: colors.dim }}>
      <svg width={120} height={120} viewBox="0 0 120 120" style={{ display: 'block', margin: '0 auto', transform: `rotate(${frame * 12}deg)` }}>
        <circle cx={60} cy={60} r={48} fill="none" stroke={colors.line} strokeWidth={8} />
        <path d="M60 12 A48 48 0 0 1 108 60" fill="none" stroke={colors.orange} strokeWidth={8} strokeLinecap="round" />
      </svg>
      <div style={{ marginTop: 26, textAlign: 'center', fontSize: 24, letterSpacing: 3 }}>ANALYZING FILE…</div>
      <div style={{ marginTop: 16, height: 6, borderRadius: 3, backgroundColor: colors.line }}>
        <div style={{ width: `${p * 100}%`, height: '100%', borderRadius: 3, backgroundColor: colors.orange }} />
      </div>
    </div>
  );
};

// Semicircle gauge like the one on haulock.com, plus the verdict chip.
const VerdictCard: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const enter = usePop(at, { damping: 11, stiffness: 220 });
  if (frame < at) return null;
  const SCORE = 72;
  const fill = interpolate(frame, [at, at + 16], [0, SCORE / 100], { ...clamp, easing: (v) => 1 - Math.pow(1 - v, 3) });
  const R = 140;
  const arc = (p: number) => {
    const a = Math.PI * (1 - p);
    return `M ${170 - R} 170 A ${R} ${R} 0 0 1 ${170 + R * Math.cos(a)} ${170 - R * Math.sin(a)}`;
  };
  return (
    <div
      style={{
        position: 'absolute',
        left: 572,
        top: 590,
        width: 450,
        padding: '26px 20px 28px',
        borderRadius: 28,
        background: 'rgba(4,11,26,0.85)',
        border: '2px solid rgba(220,38,38,0.85)',
        boxShadow: '0 0 80px rgba(220,38,38,0.45)',
        textAlign: 'center',
        transform: `scale(${interpolate(enter, [0, 1], [1.4, 1])})`,
        opacity: Math.min(1, enter * 1.5),
        fontFamily: fonts.mono,
      }}
    >
      <div style={{ fontSize: 22, letterSpacing: 4, color: colors.dim }}>TAMPER SCORE</div>
      <svg width={340} height={196} viewBox="0 0 340 196" style={{ display: 'block', margin: '10px auto 0' }}>
        <path d={arc(1)} fill="none" stroke="rgba(245,243,238,0.14)" strokeWidth={24} strokeLinecap="round" />
        {fill > 0.005 ? <path d={arc(fill)} fill="none" stroke={colors.red} strokeWidth={24} strokeLinecap="round" /> : null}
      </svg>
      <div style={{ marginTop: -118, fontFamily: fonts.serif, fontStyle: 'italic', fontSize: 120, lineHeight: 1, color: colors.redGlow }}>
        {Math.round(fill * 100)}
      </div>
      <div
        style={{
          display: 'inline-block',
          marginTop: 20,
          padding: '12px 22px',
          borderRadius: 999,
          backgroundColor: colors.red,
          color: '#fff',
          fontWeight: 700,
          fontSize: 28,
          letterSpacing: 3,
        }}
      >
        ⚠ LIKELY TAMPERED
      </div>
    </div>
  );
};
