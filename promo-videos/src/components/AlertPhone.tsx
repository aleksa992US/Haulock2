import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import emailInfo from '../../public/recordings/alert-email.json';
import { clamp, colors, fonts } from '../theme';
import { Phone } from './Devices';

// The own-company alert on a phone: lock screen → notification → tap → the alert email
// (public/recordings/alert-email.png: lib/email.ts rendered with the example inspection).
// The lock screen, notification and mail chrome are generic; the email is the app's own.
// Frames are relative to the parent Sequence.
export type AlertPhoneTiming = { notifyAt: number; openAt: number; scroll: [number, number] };

const SCREEN = { w: 620, h: 1340 };
const STATUS = 64;
const EMAIL = { w: 620, h: Math.round((3099 / 1170) * 620) }; // alert-email.png, scaled to the screen
const SCROLL_PX = 250;

export const AlertPhone: React.FC<{ t: AlertPhoneTiming; top?: number }> = ({ t, top = 600 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16, stiffness: 140 } });
  const open = spring({ frame: frame - t.openAt, fps, config: { damping: 18, stiffness: 150 } });
  return (
    <AbsoluteFill style={{ opacity: Math.min(1, enter * 1.5), transform: `translateY(${(1 - enter) * 160}px)` }}>
      <Phone left={(1080 - (SCREEN.w + 32)) / 2} top={top} screen={SCREEN} statusBar={STATUS}>
        <LockScreen notifyAt={t.notifyAt} openAt={t.openAt} />
        {frame >= t.openAt - 1 ? (
          <div style={{ position: 'absolute', inset: 0, transform: `translateY(${(1 - open) * 100}%)`, backgroundColor: '#F5F3EE' }}>
            <MailView scroll={interpolate(frame, t.scroll, [0, SCROLL_PX], { ...clamp, easing: (v) => (v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2) })} />
          </div>
        ) : null}
      </Phone>
    </AbsoluteFill>
  );
};

const LockScreen: React.FC<{ notifyAt: number; openAt: number }> = ({ notifyAt, openAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drop = spring({ frame: frame - notifyAt, fps, config: { damping: 13, stiffness: 170 } });
  const press = interpolate(frame, [openAt - 6, openAt - 2, openAt + 2], [1, 0.96, 1], clamp);
  const glow = frame >= notifyAt ? 0.5 + 0.5 * Math.sin((frame - notifyAt) / 5) : 0;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(90% 55% at 50% 30%, ${colors.navy} 0%, ${colors.void} 75%)` }}>
      <AbsoluteFill style={{ background: 'radial-gradient(70% 40% at 80% 95%, rgba(255,107,53,0.35) 0%, rgba(4,11,26,0) 70%)' }} />
      <div style={{ position: 'absolute', top: 70, left: 0, right: 0, textAlign: 'center', color: colors.cream }}>
        <div style={{ fontFamily: fonts.sans, fontWeight: 500, fontSize: 150, letterSpacing: -6, lineHeight: 1 }}>9:41</div>
      </div>
      {frame >= notifyAt ? (
        <div
          style={{
            position: 'absolute',
            left: 22,
            right: 22,
            top: 290,
            padding: '22px 24px 24px',
            borderRadius: 34,
            backgroundColor: 'rgba(245,243,238,0.94)',
            boxShadow: `0 20px 60px rgba(0,0,0,0.5), 0 0 ${30 + glow * 30}px rgba(220,38,38,${0.25 + glow * 0.3})`,
            transform: `translateY(${(1 - drop) * -260}px) scale(${press})`,
            opacity: Math.min(1, drop * 1.4),
            fontFamily: fonts.sans,
            color: colors.ink,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <AppIcon size={52} />
            <span style={{ fontFamily: fonts.mono, fontWeight: 600, fontSize: 20, letterSpacing: 2, color: 'rgba(11,30,63,0.6)' }}>HAULOCK</span>
            <span style={{ marginLeft: 'auto', fontSize: 20, color: 'rgba(11,30,63,0.5)' }}>now</span>
          </div>
          <div style={{ marginTop: 14, fontWeight: 600, fontSize: 30, lineHeight: 1.2 }}>{emailInfo.subject}</div>
          <div style={{ marginTop: 8, fontSize: 24, lineHeight: 1.35, color: 'rgba(11,30,63,0.72)' }}>Example Trucking LLC · Oct 2 · Joplin, MO · Level II walk-around</div>
          <div style={{ marginTop: 12, display: 'inline-block', padding: '5px 14px', borderRadius: 999, backgroundColor: 'rgba(220,38,38,0.12)', color: colors.red, fontSize: 21, fontWeight: 600 }}>Out of service · vehicle</div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const AppIcon: React.FC<{ size: number }> = ({ size }) => (
  <span style={{ width: size, height: size, borderRadius: size * 0.24, backgroundColor: colors.navy, color: colors.orange, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.sans, fontWeight: 700, fontSize: size * 0.5 }}>H</span>
);

const MailView: React.FC<{ scroll: number }> = ({ scroll }) => (
  <AbsoluteFill>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 150, bottom: 0, overflow: 'hidden' }}>
      <Img src={staticFile('recordings/alert-email.png')} style={{ position: 'absolute', left: 0, top: -scroll, width: EMAIL.w, height: EMAIL.h, maxWidth: 'none' }} />
    </div>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 150, backgroundColor: '#fff', borderBottom: '1px solid rgba(11,30,63,0.1)', padding: '14px 26px 0', boxSizing: 'border-box', fontFamily: fonts.sans, color: colors.ink }}>
      <div style={{ fontSize: 24, color: 'rgba(11,30,63,0.6)' }}>‹ Inbox</div>
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
        <AppIcon size={46} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <span style={{ fontWeight: 600, fontSize: 24 }}>Haulock</span>
            <span style={{ fontSize: 19, color: 'rgba(11,30,63,0.5)' }}>now</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 500 }}>{emailInfo.subject}</div>
        </div>
      </div>
    </div>
  </AbsoluteFill>
);
