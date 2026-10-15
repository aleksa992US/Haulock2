import React from 'react';
import { colors, fonts } from '../theme';

// "What changed": each change the PDF tamper check found on the sample rate con,
// before → after. Used by the `pdf-tamper` reel (rows slide in) and its carousel.
export type Change = { label: string; before: string; after: string; pill?: string };

export const CHANGES: Record<'en' | 'sr', { title: string; footer: string; rows: Change[] }> = {
  en: {
    title: 'WHAT CHANGED',
    footer: 'FOUND IN 6 SAVED VERSIONS INSIDE THE PDF',
    rows: [
      { label: 'LINE HAUL', before: '$1,400.00', after: '$1,100.00', pill: '−$300' },
      { label: 'DETENTION', before: '$50/hr after 2 hrs', after: 'Not paid' },
      { label: 'LUMPER', before: 'Reimbursed', after: 'Hidden' },
      { label: 'PAGE 2', before: 'TONU & layover terms', after: 'Deleted' },
    ],
  },
  sr: {
    title: 'ŠTA JE IZMENJENO',
    footer: 'PRONAĐENO U 6 SAČUVANIH VERZIJA UNUTAR PDF-A',
    rows: [
      { label: 'LINE HAUL', before: '$1,400.00', after: '$1,100.00', pill: '−$300' },
      { label: 'DETENTION', before: '$50/h posle 2 h', after: 'Ne plaća se' },
      { label: 'LUMPER', before: 'Refundira se', after: 'Sakriveno' },
      { label: 'STRANA 2', before: 'TONU i layover uslovi', after: 'Obrisana' },
    ],
  },
};

// `shown[i]` (0–1) reveals row i; `footer` (0–1) the footer line.
export const ChangesCard: React.FC<{ lang: 'en' | 'sr'; shown: number[]; footer: number; style?: React.CSSProperties }> = ({ lang, shown, footer, style }) => {
  const c = CHANGES[lang];
  return (
    <div style={{ position: 'absolute', borderRadius: 40, backgroundColor: '#fff', padding: '46px 54px', boxSizing: 'border-box', color: colors.ink, ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: fonts.mono, fontSize: 26, letterSpacing: 3 }}>
        <span style={{ fontWeight: 700, color: colors.red }}>{c.title}</span>
        <span style={{ color: 'rgba(11,30,63,0.5)' }}>RATE-CON-4821.PDF</span>
      </div>
      <div style={{ marginTop: 20, height: 2, backgroundColor: 'rgba(11,30,63,0.1)' }} />
      {c.rows.map((r, i) => {
        const p = shown[i] ?? 1;
        return (
          <div key={r.label} style={{ padding: '40px 0 36px', borderBottom: i < c.rows.length - 1 ? '2px solid rgba(11,30,63,0.08)' : undefined, opacity: p, transform: `translateX(${(1 - p) * 60}px)` }}>
            <div style={{ fontFamily: fonts.mono, fontSize: 27, letterSpacing: 3, color: 'rgba(11,30,63,0.5)' }}>{r.label}</div>
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 20, fontFamily: fonts.sans }}>
              <span style={{ fontSize: 44, color: 'rgba(11,30,63,0.45)', textDecoration: 'line-through', textDecorationColor: 'rgba(220,38,38,0.6)', textDecorationThickness: 3, whiteSpace: 'nowrap' }}>{r.before}</span>
              <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="rgba(11,30,63,0.4)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
              <span style={{ fontSize: 62, fontWeight: 600, letterSpacing: -1, color: colors.red, whiteSpace: 'nowrap' }}>{r.after}</span>
              {r.pill ? (
                <span style={{ marginLeft: 'auto', padding: '8px 18px', borderRadius: 999, backgroundColor: colors.red, color: '#fff', fontSize: 38, fontWeight: 600 }}>{r.pill}</span>
              ) : null}
            </div>
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: 54, right: 54, bottom: 40, fontFamily: fonts.mono, fontSize: 22, letterSpacing: 2, color: 'rgba(11,30,63,0.5)', opacity: footer }}>{c.footer}</div>
    </div>
  );
};
