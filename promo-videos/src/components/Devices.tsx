import React from 'react';
import { fonts } from '../theme';

// Generic device mockups (no maker logos) for app screenshots in posts.

// A modern phone: dark frame, island cutout, status bar. `screen` is the screen's size in
// px; the children fill the area under the status bar.
export const Phone: React.FC<{ left: number; top: number; screen: { w: number; h: number }; statusBar?: number; children: React.ReactNode }> = ({
  left,
  top,
  screen,
  statusBar = 64,
  children,
}) => {
  const pad = 16;
  const r = screen.w * 0.16;
  return (
    <div style={{ position: 'absolute', left, top, width: screen.w + pad * 2, height: screen.h + pad * 2 }}>
      {/* side buttons */}
      {[
        { side: -5, y: 0.17, h: 0.05 },
        { side: -5, y: 0.25, h: 0.09 },
        { side: -5, y: 0.36, h: 0.09 },
        { side: screen.w + pad * 2 - 1, y: 0.28, h: 0.13 },
      ].map((b, i) => (
        <div key={i} style={{ position: 'absolute', left: b.side, top: screen.h * b.y, width: 6, height: screen.h * b.h, borderRadius: 3, background: 'linear-gradient(90deg, #3a3f48, #1b1e24)' }} />
      ))}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: r + pad,
          background: 'linear-gradient(145deg, #4a4f58 0%, #1d2026 18%, #121418 60%, #2c3038 100%)',
          boxShadow: '0 50px 120px rgba(0,0,0,0.7), 0 0 0 2px rgba(255,255,255,0.08), inset 0 0 0 2px rgba(255,255,255,0.1)',
        }}
      />
      <div style={{ position: 'absolute', left: pad, top: pad, width: screen.w, height: screen.h, borderRadius: r, overflow: 'hidden', backgroundColor: '#fff' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: statusBar, bottom: 0, overflow: 'hidden' }}>{children}</div>
        <StatusBar height={statusBar} />
        <div style={{ position: 'absolute', top: statusBar * 0.24, left: '50%', width: screen.w * 0.27, height: statusBar * 0.56, marginLeft: -(screen.w * 0.27) / 2, borderRadius: 999, backgroundColor: '#000' }} />
      </div>
    </div>
  );
};

const StatusBar: React.FC<{ height: number }> = ({ height }) => {
  const s = height / 64;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${44 * s}px`, backgroundColor: '#fff', fontFamily: fonts.sans, fontWeight: 600, fontSize: 24 * s, color: '#0B1E3F' }}>
      <span>9:41</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 * s }}>
        <svg width={28 * s} height={18 * s} viewBox="0 0 28 18">
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={i * 7} y={14 - i * 4} width={5} height={4 + i * 4} rx={1.2} fill="#0B1E3F" />
          ))}
        </svg>
        <svg width={26 * s} height={18 * s} viewBox="0 0 26 18" fill="none" stroke="#0B1E3F" strokeWidth={2.6} strokeLinecap="round">
          <path d="M2 6.5a16 16 0 0 1 22 0" />
          <path d="M6.5 10.5a9.5 9.5 0 0 1 13 0" />
          <circle cx={13} cy={15} r={1.6} fill="#0B1E3F" stroke="none" />
        </svg>
        <svg width={40 * s} height={20 * s} viewBox="0 0 40 20">
          <rect x={1} y={2} width={33} height={16} rx={5} fill="none" stroke="#0B1E3F" strokeOpacity={0.45} strokeWidth={2} />
          <rect x={4} y={5} width={24} height={10} rx={2.5} fill="#0B1E3F" />
          <rect x={36} y={7} width={3} height={6} rx={1.5} fill="#0B1E3F" fillOpacity={0.45} />
        </svg>
      </span>
    </div>
  );
};

// A laptop: thin black bezel with camera, aluminium base with the opening lip.
// `screen` is the display area in px; children fill it.
export const Laptop: React.FC<{ left: number; top: number; screen: { w: number; h: number }; children: React.ReactNode }> = ({ left, top, screen, children }) => {
  const bezel = 18;
  const lid = { w: screen.w + bezel * 2, h: screen.h + bezel * 2 + 8 };
  const base = { w: lid.w * 1.14, h: 30 };
  return (
    <div style={{ position: 'absolute', left, top, width: lid.w, height: lid.h + base.h }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: lid.w, height: lid.h, borderRadius: '30px 30px 8px 8px', background: '#0c0d10', boxShadow: '0 40px 100px rgba(0,0,0,0.6), 0 0 0 3px #3b3f47, inset 0 0 0 1px rgba(255,255,255,0.08)' }}>
        <div style={{ position: 'absolute', left: '50%', top: 7, width: 8, height: 8, marginLeft: -4, borderRadius: 4, backgroundColor: '#22252b', boxShadow: 'inset 0 0 0 2px #2f333b' }} />
        <div style={{ position: 'absolute', left: bezel, top: bezel, width: screen.w, height: screen.h, borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff' }}>{children}</div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: (lid.w - base.w) / 2,
          top: lid.h,
          width: base.w,
          height: base.h,
          borderRadius: '4px 4px 22px 22px',
          background: 'linear-gradient(180deg, #e8eaee 0%, #c4c8cf 45%, #8f949c 100%)',
          boxShadow: '0 24px 50px rgba(0,0,0,0.55)',
        }}
      >
        <div style={{ position: 'absolute', left: '50%', top: 0, width: base.w * 0.16, height: 10, marginLeft: -(base.w * 0.16) / 2, borderRadius: '0 0 12px 12px', background: 'linear-gradient(180deg, #a3a8b0, #c9cdd3)' }} />
      </div>
    </div>
  );
};

// A desktop PDF viewer window: title bar with window dots, file name and zoom level.
export const PdfViewer: React.FC<{ file: string; zoom: string; children: React.ReactNode }> = ({ file, zoom, children }) => (
  <div style={{ position: 'absolute', inset: 0, backgroundColor: '#d9dce1' }}>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 52, display: 'flex', alignItems: 'center', padding: '0 20px', backgroundColor: '#f1f2f4', borderBottom: '1px solid #c9ccd2', fontFamily: fonts.sans, fontSize: 22, color: '#3b3f47' }}>
      <span style={{ display: 'flex', gap: 10 }}>
        {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
          <span key={c} style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c }} />
        ))}
      </span>
      <span style={{ flex: 1, textAlign: 'center', fontWeight: 600 }}>{file}</span>
      <span style={{ fontFamily: fonts.mono, fontSize: 18, color: '#6b7079' }}>{zoom}</span>
    </div>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 52, bottom: 0, overflow: 'hidden' }}>{children}</div>
  </div>
);
