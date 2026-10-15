import React from 'react';
import { Img, staticFile } from 'remotion';
import { Phone } from '../components/Devices';
import { FootageLayer } from '../components/FootageLayer';
import type { FootageName } from '../footage';
import { colors, fonts } from '../theme';
import { CreamCta, type CreamCtaProps } from './CreamCta';
import { Headline, POST_W, Post } from './Posts';

// 4-slide carousels (4:5) for the feature reels — load planner, COI check, your company,
// officers, authority history, PDF report — in English and Serbian. Same example data and
// screens as the reels (public/recordings/phone-*.png, report-braxtone-p*.png).
export type Lang = 'en' | 'sr';
type Tok = { text: string; accent?: boolean; color?: string };
type Lines = Tok[][];
const h = (plain: string, accent: string, color?: string): Lines => [[{ text: plain }], [{ text: accent, accent: true, color }]];

// ---------- slide types ----------
type HookSpec = { kind: 'hook'; clip: FootageName; headline: Lines; size?: number; card: { label: string; title: string; lines: string[]; stamp: string; stampColor: string; titleColor?: string }; swipe: string };
type Callout = { lines: string[]; side: 'left' | 'right'; y: number; color: string };
type Ring = { x: number; y: number; w: number; h: number; color: string };
type PhoneSpec = { kind: 'phone'; src: string; headline: Lines; accentSize?: number; sub: string; callouts: Callout[]; rings?: Ring[] };
type RowsSpec = { kind: 'rows'; headline: Lines; sub: string; rows: { big: string; label: string; color: string; chip?: boolean }[]; footer?: string };
type TimelineSpec = { kind: 'timeline'; headline: Lines; sub: string; steps: { date: string; label: string; color: string; gap?: boolean }[] };
type PdfSpec = { kind: 'pdf'; headline: Lines; size?: number; sub: string; tilt?: boolean; callouts: Callout[] };
type CtaSpec = { kind: 'cta' } & Omit<CreamCtaProps, 'hudRight'>;
type SlideSpec = HookSpec | PhoneSpec | RowsSpec | TimelineSpec | PdfSpec | CtaSpec;
type Feature = { id: string; hud: string; slides: Record<Lang, SlideSpec[]> };

const Glass: React.CSSProperties = { borderRadius: 28, backgroundColor: 'rgba(6,16,38,0.78)', border: '2px solid rgba(245,243,238,0.22)', boxShadow: '0 20px 60px rgba(0,0,0,0.45)' };
const SubLine: React.FC<{ top: number; text: string; color?: string }> = ({ top, text, color = colors.dim }) => (
  <div style={{ position: 'absolute', left: 60, right: 60, top, textAlign: 'center', fontFamily: fonts.mono, fontSize: 22, letterSpacing: 3, lineHeight: 1.4, color }}>{text}</div>
);

const HookSlide: React.FC<{ s: HookSpec }> = ({ s }) => (
  <>
    <FootageLayer segments={[{ from: 0, to: 300, clip: s.clip, dim: 0.6 }]} />
    <Headline top={120} size={s.size ?? 88} accentSize={118} lines={s.headline} />
    <div style={{ position: 'absolute', left: 110, right: 110, top: 560, padding: '40px 46px 46px', ...Glass }}>
      <div style={{ fontFamily: fonts.mono, fontSize: 24, letterSpacing: 4, color: colors.dim }}>{s.card.label}</div>
      <div style={{ marginTop: 14, fontFamily: fonts.sans, fontWeight: 600, fontSize: s.card.title.length > 14 ? 84 : 104, letterSpacing: -4, lineHeight: 1.02, color: s.card.titleColor ?? colors.cream }}>{s.card.title}</div>
      {s.card.lines.map((l) => (
        <div key={l} style={{ marginTop: 12, fontSize: 36, color: 'rgba(245,243,238,0.8)' }}>{l}</div>
      ))}
    </div>
    <div style={{ position: 'absolute', right: 80, top: 490 }}>
      <div style={{ padding: '12px 30px', borderRadius: 18, border: `5px solid ${s.card.stampColor}`, color: s.card.stampColor, fontFamily: fonts.mono, fontWeight: 700, fontSize: 42, letterSpacing: 4, backgroundColor: 'rgba(4,11,26,0.75)', transform: 'rotate(-6deg)' }}>{s.card.stamp}</div>
    </div>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 1160, textAlign: 'center', fontFamily: fonts.mono, fontWeight: 600, fontSize: 28, letterSpacing: 4, color: colors.orange }}>{s.swipe}</div>
  </>
);

// A full phone screenshot (430×880 pt at 3×) on a phone, with mono callouts at `y` pt.
const SHOT = { w: 430, h: 880, status: 52 };
const PhoneSlide: React.FC<{ s: PhoneSpec }> = ({ s }) => {
  const k = 480 / SHOT.w;
  const screen = { w: 480, h: Math.round((SHOT.h + SHOT.status) * k) };
  const left = (POST_W - (screen.w + 32)) / 2;
  const top = 356;
  const y = (pt: number) => top + 16 + SHOT.status * k + pt * k;
  return (
    <>
      <Headline top={96} size={84} accentSize={s.accentSize ?? 112} lines={s.headline} />
      <SubLine top={300} text={s.sub} />
      <Phone left={left} top={top} screen={screen} statusBar={Math.round(SHOT.status * k)}>
        <Img src={staticFile(`recordings/${s.src}`)} style={{ width: SHOT.w * k, height: SHOT.h * k, display: 'block' }} />
        {(s.rings ?? []).map((r, i) => (
          <div key={i} style={{ position: 'absolute', left: (r.x - 6) * k, top: (r.y - 6) * k, width: (r.w + 12) * k, height: (r.h + 12) * k, borderRadius: 16, border: `5px solid ${r.color}`, boxShadow: `0 0 26px ${r.color}` }} />
        ))}
      </Phone>
      {s.callouts.map((c) => (
        <CalloutView key={c.lines.join()} c={c} top={y(c.y)} width={left - 40} />
      ))}
    </>
  );
};
const CalloutView: React.FC<{ c: Callout; top: number; width: number }> = ({ c, top, width }) => (
  <div style={{ position: 'absolute', top: top - 34, [c.side]: 26, width, display: 'flex', flexDirection: 'column', alignItems: c.side === 'left' ? 'flex-end' : 'flex-start', fontFamily: fonts.mono, fontWeight: 600, fontSize: 24, letterSpacing: 2, lineHeight: 1.35, color: c.color, textAlign: c.side === 'left' ? 'right' : 'left' }}>
    {c.lines.map((l) => (
      <span key={l}>{l}</span>
    ))}
    <span style={{ marginTop: 8, width: 70, height: 3, backgroundColor: c.color, borderRadius: 2 }} />
  </div>
);

const RowsSlide: React.FC<{ s: RowsSpec }> = ({ s }) => (
  <>
    <FootageLayer segments={[{ from: 0, to: 300, clip: 'highway-pov', dim: 0.72 }]} />
    <Headline top={110} size={88} accentSize={118} lines={s.headline} />
    <SubLine top={392} text={s.sub} />
    {s.rows.map((r, i) => (
      <div
        key={r.big + r.label}
        style={{
          position: 'absolute',
          left: 120,
          right: 120,
          top: 460 + i * (s.rows.length > 3 ? 160 : 200),
          height: s.rows.length > 3 ? 140 : 170,
          display: 'flex',
          alignItems: 'center',
          gap: 32,
          padding: '0 40px',
          ...Glass,
          border: `2px solid ${r.color}66`,
        }}
      >
        {r.chip ? (
          <span style={{ flexShrink: 0, width: 250, textAlign: 'center', padding: '14px 0', borderRadius: 16, backgroundColor: r.color, color: '#fff', fontFamily: fonts.mono, fontWeight: 700, fontSize: 34, letterSpacing: 3 }}>{r.big}</span>
        ) : (
          <span style={{ flexShrink: 0, minWidth: 250, fontFamily: fonts.sans, fontWeight: 600, fontSize: 92, letterSpacing: -4, color: r.color }}>{r.big}</span>
        )}
        <span style={{ fontFamily: fonts.mono, fontWeight: 600, fontSize: 26, letterSpacing: 3, lineHeight: 1.35, color: colors.cream, whiteSpace: 'pre-line' }}>{r.label}</span>
      </div>
    ))}
    {s.footer ? <div style={{ position: 'absolute', left: 0, right: 0, top: 1170, textAlign: 'center', fontFamily: fonts.mono, fontWeight: 600, fontSize: 30, letterSpacing: 4, color: colors.orange }}>{s.footer}</div> : null}
  </>
);

const TimelineSlide: React.FC<{ s: TimelineSpec }> = ({ s }) => {
  const x = 250;
  const top = 500;
  const step = 230;
  return (
    <>
      <FootageLayer segments={[{ from: 0, to: 300, clip: 'truck-fog', dim: 0.74 }]} />
      <Headline top={110} size={88} accentSize={112} lines={s.headline} />
      <SubLine top={400} text={s.sub} />
      {s.steps.slice(1).map((st, i) => (
        <div key={i} style={{ position: 'absolute', left: x - 5, top: top + i * step + 30, width: 10, height: step - 30, borderRadius: 5, background: st.gap ? `repeating-linear-gradient(to bottom, ${colors.red} 0 14px, transparent 14px 26px)` : `linear-gradient(${s.steps[i].color}, ${st.color})` }} />
      ))}
      {s.steps.map((st, i) => (
        <React.Fragment key={st.label}>
          <div style={{ position: 'absolute', left: x - 26, top: top + i * step - 26 + 30, width: 52, height: 52, borderRadius: 26, backgroundColor: st.gap ? colors.void : st.color, border: `6px solid ${st.color}`, boxShadow: `0 0 30px ${st.color}` }} />
          <div style={{ position: 'absolute', left: x + 60, right: 90, top: top + i * step, padding: '16px 28px', ...Glass, border: `2px solid ${st.color}88` }}>
            <div style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 54, letterSpacing: -2, color: st.color }}>{st.date}</div>
            <div style={{ marginTop: 4, fontFamily: fonts.mono, fontWeight: 600, fontSize: 24, letterSpacing: 3, color: colors.cream }}>{st.label}</div>
          </div>
        </React.Fragment>
      ))}
    </>
  );
};

// The app's PDF report (report-braxtone-p1.png, 1836×2376), with callouts at page px `y`.
const PdfSlide: React.FC<{ s: PdfSpec }> = ({ s }) => {
  const W = s.tilt ? 640 : 600;
  const k = W / 1836;
  const left = (POST_W - W) / 2;
  const top = s.tilt ? 470 : 400;
  return (
    <>
      <Headline top={96} size={s.size ?? 84} accentSize={112} lines={s.headline} />
      <SubLine top={304} text={s.sub} />
      {s.tilt ? (
        <Img src={staticFile('recordings/report-braxtone-p2.png')} style={{ position: 'absolute', left: left + 90, top: top + 30, width: W, borderRadius: 8, opacity: 0.85, transform: 'rotate(5deg)', boxShadow: '0 40px 120px rgba(0,0,0,0.6)' }} />
      ) : null}
      <Img src={staticFile('recordings/report-braxtone-p1.png')} style={{ position: 'absolute', left, top, width: W, borderRadius: 8, transform: s.tilt ? 'rotate(-4deg)' : undefined, boxShadow: '0 40px 120px rgba(0,0,0,0.6)' }} />
      {s.callouts.map((c) => (
        <CalloutView key={c.lines.join()} c={c} top={top + c.y * k} width={left - 40} />
      ))}
      {s.tilt ? (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 1236, display: 'flex', justifyContent: 'center' }}>
          <div style={{ padding: '12px 26px', borderRadius: 999, backgroundColor: 'rgba(4,11,26,0.82)', border: `2px solid ${colors.line}`, fontFamily: fonts.mono, fontSize: 24, letterSpacing: 3, color: colors.cream }}>haulock-report-305.pdf</div>
        </div>
      ) : null}
    </>
  );
};

// ---------- the six features ----------
const EN_FREE = ['Free plan: 3 lookups a month', 'No credit card'];
const SR_FREE = ['Besplatno: 3 provere mesečno', 'Bez kartice'];

const FEATURES: Feature[] = [
  {
    id: 'planner',
    hud: 'LOAD PLANNER',
    slides: {
      en: [
        { kind: 'hook', clip: 'sunset-drive', headline: h('Is this load', 'worth it?'), card: { label: "LOAD OFFER · 53' DRY VAN", title: '$2,400', lines: ['Joliet, IL → Dallas, TX', 'Truck sitting in Gary, IN'], stamp: 'WORTH IT?', stampColor: colors.orange }, swipe: 'SWIPE → RUN THE NUMBERS' },
        {
          kind: 'phone', src: 'phone-planner.png', headline: h('Haulock plans', 'the truck route.'), sub: 'EMPTY MILES · LOADED MILES · DRIVE TIME · EXAMPLE',
          callouts: [{ lines: ['44 MI EMPTY', '927 MI LOADED'], side: 'left', y: 100, color: colors.orange }, { lines: ['15H 10M', 'DRIVING'], side: 'right', y: 135, color: colors.orange }, { lines: ['$1,194', 'LEFT AFTER', 'COSTS'], side: 'left', y: 500, color: colors.greenGlow }, { lines: ['BREAK-EVEN', '$1.24/MI'], side: 'right', y: 537, color: colors.greenGlow }],
        },
        { kind: 'rows', headline: h("What's", 'really left.', colors.greenGlow), sub: 'JOLIET, IL → DALLAS, TX · DIESEL $3.85 · EXAMPLE', rows: [{ big: '$2,400', label: 'RATE', color: colors.cream }, { big: '−$575', label: 'FUEL', color: colors.redGlow }, { big: '−$631', label: 'DRIVER ($0.65/MI)', color: colors.redGlow }, { big: '$1,194', label: 'LEFT AFTER COSTS', color: colors.greenGlow }], footer: 'BREAK-EVEN: $1.24 / MILE' },
        { kind: 'cta', chip: 'LOAD PLANNER · TRUCK ROUTES · PROFIT', cta: [['Plan 10 loads'], ['a month', 'free.']], steps: ['Truck route: empty & loaded miles', 'Drive time with 10-hr breaks', 'Profit after costs & break-even'], facts: ['Free plan: 10 load plans a month', 'No credit card'] },
      ],
      sr: [
        { kind: 'hook', clip: 'sunset-drive', headline: h('Da li se ovaj load', 'isplati?'), card: { label: "PONUDA ZA LOAD · 53' DRY VAN", title: '$2,400', lines: ['Joliet, IL → Dallas, TX', 'Kamion stoji u Gary, IN'], stamp: 'ISPLATI SE?', stampColor: colors.orange }, swipe: 'PREVUCI → IZRAČUNAJ' },
        {
          kind: 'phone', src: 'phone-planner.png', headline: h('Haulock planira', 'rutu za kamion.'), sub: 'PRAZNE MILJE · PUNE MILJE · VREME VOŽNJE · PRIMER',
          callouts: [{ lines: ['44 MI PRAZNO', '927 MI PUNO'], side: 'left', y: 100, color: colors.orange }, { lines: ['15H 10M', 'VOŽNJE'], side: 'right', y: 135, color: colors.orange }, { lines: ['$1,194', 'OSTAJE POSLE', 'TROŠKOVA'], side: 'left', y: 500, color: colors.greenGlow }, { lines: ['BREAK-EVEN', '$1.24/MI'], side: 'right', y: 537, color: colors.greenGlow }],
        },
        { kind: 'rows', headline: h('Šta ti', 'stvarno ostaje.', colors.greenGlow), sub: 'JOLIET, IL → DALLAS, TX · DIZEL $3.85 · PRIMER', rows: [{ big: '$2,400', label: 'RATE', color: colors.cream }, { big: '−$575', label: 'GORIVO', color: colors.redGlow }, { big: '−$631', label: 'VOZAČ ($0.65/MI)', color: colors.redGlow }, { big: '$1,194', label: 'OSTAJE POSLE TROŠKOVA', color: colors.greenGlow }], footer: 'BREAK-EVEN: $1.24 PO MILJI' },
        { kind: 'cta', chip: 'LOAD PLANNER · RUTE · PROFIT', cta: [['10 planova'], ['mesečno', 'besplatno.']], steps: ['Ruta za kamion: prazne i pune milje', 'Vreme vožnje sa pauzama od 10 h', 'Profit posle troškova i break-even'], facts: ['Besplatno: 10 planova mesečno', 'Bez kartice'] },
      ],
    },
  },
  {
    id: 'coi',
    hud: 'COI CHECK',
    slides: {
      en: [
        { kind: 'hook', clip: 'aerial-traffic', headline: h('The COI says $1M.', 'Is it still active?'), card: { label: 'CERTIFICATE OF INSURANCE · ACORD 25', title: '$1,000,000', lines: ['Auto liability · Kestrelon Freight Group', 'Policy GP-4471209'], stamp: 'STILL ACTIVE?', stampColor: colors.amber }, swipe: 'SWIPE → CHECK IT AGAINST FMCSA' },
        {
          kind: 'phone', src: 'phone-coi.png', headline: h('FMCSA says:', 'cancelling Oct 27.', colors.redGlow), accentSize: 104, sub: "THE INSURER'S FMCSA FILING VS. THE CERTIFICATE · EXAMPLE",
          callouts: [{ lines: ['CANCELLATION', 'PENDING', 'IN 12 DAYS'], side: 'left', y: 290, color: colors.redGlow }, { lines: ['NAME &', 'POLICY MATCH', 'FMCSA'], side: 'right', y: 560, color: colors.greenGlow }],
          rings: [{ x: 50, y: 244, w: 330, h: 216, color: colors.red }],
        },
        { kind: 'rows', headline: h('Three answers.', 'No guessing.'), sub: 'EVERY COI GETS ONE', rows: [{ big: 'MATCH', label: 'MATCHES FMCSA FILINGS', color: colors.green, chip: true }, { big: 'VERIFY', label: 'CALL THE INSURER\nBEFORE ACCEPTING', color: colors.amber, chip: true }, { big: 'MISMATCH', label: "DON'T ACCEPT UNTIL\nTHE INSURER CONFIRMS", color: colors.red, chip: true }] },
        { kind: 'cta', chip: 'COI CHECK · FMCSA INSURANCE FILINGS', cta: [['COI checks on'], ['every paid', 'plan.']], steps: ['Upload the certificate (ACORD 25)', "Compared with the insurer's FMCSA filings", 'Also checks the PDF for edits'], facts: ['Paid plans from $49/mo', '25 COI checks a month on Carrier'] },
      ],
      sr: [
        { kind: 'hook', clip: 'aerial-traffic', headline: h('Na COI piše $1M.', 'Da li još važi?'), card: { label: 'POTVRDA O OSIGURANJU · ACORD 25', title: '$1,000,000', lines: ['Auto liability · Kestrelon Freight Group', 'Polisa GP-4471209'], stamp: 'JOŠ VAŽI?', stampColor: colors.amber }, swipe: 'PREVUCI → PROVERI PREMA FMCSA' },
        {
          kind: 'phone', src: 'phone-coi.png', headline: h('FMCSA kaže:', 'otkaz 27. oktobra.', colors.redGlow), accentSize: 104, sub: 'PRIJAVA OSIGURAVAČA U FMCSA VS. POTVRDA · PRIMER',
          callouts: [{ lines: ['OTKAZ NA', 'ČEKANJU', 'ZA 12 DANA'], side: 'left', y: 290, color: colors.redGlow }, { lines: ['IME I POLISA', 'SE POKLAPAJU', 'SA FMCSA'], side: 'right', y: 560, color: colors.greenGlow }],
          rings: [{ x: 50, y: 244, w: 330, h: 216, color: colors.red }],
        },
        { kind: 'rows', headline: h('Tri odgovora.', 'Bez nagađanja.'), sub: 'SVAKI COI DOBIJE JEDAN', rows: [{ big: 'MATCH', label: 'POKLAPA SE SA\nFMCSA PRIJAVAMA', color: colors.green, chip: true }, { big: 'VERIFY', label: 'POZOVI OSIGURAVAČA\nPRE PRIHVATANJA', color: colors.amber, chip: true }, { big: 'MISMATCH', label: 'NE PRIHVATAJ DOK\nOSIGURAVAČ NE POTVRDI', color: colors.red, chip: true }] },
        { kind: 'cta', chip: 'COI PROVERA · FMCSA PRIJAVE OSIGURANJA', cta: [['Plaćeni planovi'], ['uz', 'COI proveru.']], steps: ['Učitaj potvrdu (ACORD 25)', 'Poređenje sa prijavama osiguravača', 'Provera da li je PDF menjan'], facts: ['Plaćeni planovi od $49/mes', '25 COI provera mesečno (Carrier)'] },
      ],
    },
  },
  {
    id: 'company',
    hud: 'YOUR COMPANY',
    slides: {
      en: [
        { kind: 'hook', clip: 'trucker', headline: h('Brokers are checking', 'your MC.'), card: { label: 'YOUR COMPANY · KEYSTONE FREIGHT NETWORK', title: 'MC-847•••', lines: ['Looked up before', 'every load they tender'], stamp: 'HOW OFTEN?', stampColor: colors.orange }, swipe: 'SWIPE → SEE IT WEEK BY WEEK' },
        {
          kind: 'phone', src: 'phone-company.png', headline: h('See it,', 'week by week.'), sub: 'COUNTS ONLY — NEVER WHO · EXAMPLE',
          callouts: [{ lines: ['23 CHECKS', 'LAST 30 DAYS'], side: 'left', y: 150, color: colors.orange }, { lines: ['DAILY WATCH', 'ON YOUR', 'FMCSA RECORD'], side: 'right', y: 380, color: colors.greenGlow }],
          rings: [{ x: 34, y: 92, w: 362, h: 150, color: colors.orange }],
        },
        {
          kind: 'phone', src: 'phone-company-score.png', headline: h('Know what', 'brokers see.'), sub: 'YOUR HAULOCK SCORE · REFRESHED EVERY 24H',
          callouts: [{ lines: ['YOUR', 'SCORE'], side: 'left', y: 205, color: colors.greenGlow }, { lines: ['AUTHORITY', 'INSURANCE', 'SAFETY'], side: 'right', y: 360, color: colors.orange }],
        },
        { kind: 'cta', chip: "YOUR COMPANY · WHO'S CHECKING · MONITORING", cta: [['Know what'], ['brokers', 'see.']], steps: ['Claim your company on Haulock', 'Checks on your MC, week by week', 'Daily watch on your FMCSA record'], facts: ['Included on paid plans', 'Counts only, never who'] },
      ],
      sr: [
        { kind: 'hook', clip: 'trucker', headline: h('Brokeri proveravaju', 'tvoj MC.'), card: { label: 'TVOJA FIRMA · KEYSTONE FREIGHT NETWORK', title: 'MC-847•••', lines: ['Proveravaju te pre', 'svakog loada'], stamp: 'KOLIKO ČESTO?', stampColor: colors.orange }, swipe: 'PREVUCI → VIDI PO NEDELJAMA' },
        {
          kind: 'phone', src: 'phone-company.png', headline: h('Vidi to,', 'nedelju po nedelju.'), accentSize: 100, sub: 'SAMO BROJ — NIKAD KO · PRIMER',
          callouts: [{ lines: ['23 PROVERE', 'U 30 DANA'], side: 'left', y: 150, color: colors.orange }, { lines: ['DNEVNI NADZOR', 'TVOG FMCSA', 'ZAPISA'], side: 'right', y: 380, color: colors.greenGlow }],
          rings: [{ x: 34, y: 92, w: 362, h: 150, color: colors.orange }],
        },
        {
          kind: 'phone', src: 'phone-company-score.png', headline: h('Znaj šta', 'brokeri vide.'), sub: 'TVOJ HAULOCK SKOR · OSVEŽAVA SE NA 24H',
          callouts: [{ lines: ['TVOJ', 'SKOR'], side: 'left', y: 205, color: colors.greenGlow }, { lines: ['AUTHORITY', 'OSIGURANJE', 'BEZBEDNOST'], side: 'right', y: 360, color: colors.orange }],
        },
        { kind: 'cta', chip: 'TVOJA FIRMA · KO TE PROVERAVA · NADZOR', cta: [['Znaj šta'], ['brokeri', 'vide.']], steps: ['Preuzmi svoju firmu na Haulocku', 'Provere tvog MC-a po nedeljama', 'Dnevni nadzor tvog FMCSA zapisa'], facts: ['Uz plaćene planove', 'Samo broj, nikad ko'] },
      ],
    },
  },
  {
    id: 'officers',
    hud: "WHO'S ON THE PHONE",
    slides: {
      en: [
        { kind: 'hook', clip: 'highway-pov', headline: h('A broker calls.', 'Is it really them?'), card: { label: 'INCOMING CALL · BROKER', title: 'Quillmont Freight', lines: ['(555) 016-3390', 'Hot load · Columbus, OH → Atlanta, GA'], stamp: 'REALLY THEM?', stampColor: colors.orange }, swipe: "SWIPE → CHECK WHO'S ON FILE" },
        {
          kind: 'phone', src: 'phone-officers-identity.png', headline: h("Who's on", 'the FMCSA filing.'), accentSize: 104, sub: 'OFFICERS · PHONE · EMAIL ON RECORD · EXAMPLE',
          callouts: [{ lines: ['PHONE', 'ON RECORD'], side: 'left', y: 383, color: colors.orange }, { lines: ['OFFICERS', 'BY NAME'], side: 'right', y: 450, color: colors.orange }, { lines: ['EMAIL', 'ON RECORD'], side: 'left', y: 518, color: colors.orange }],
          rings: [{ x: 48, y: 362, w: 340, h: 44, color: colors.orange }, { x: 48, y: 428, w: 340, h: 46, color: colors.orange }, { x: 48, y: 496, w: 340, h: 44, color: colors.orange }],
        },
        {
          kind: 'phone', src: 'phone-officers.png', headline: h('Hang up. Call the', 'number FMCSA has.'), accentSize: 100, sub: 'ASK FOR THE OWNER BY NAME',
          callouts: [{ lines: ['CALL THIS', 'NUMBER'], side: 'left', y: 300, color: colors.greenGlow }, { lines: ['ASK FOR', 'THEM BY NAME'], side: 'right', y: 335, color: colors.greenGlow }],
          rings: [{ x: 52, y: 264, w: 330, h: 130, color: colors.greenGlow }],
        },
        { kind: 'cta', chip: 'OFFICERS · PHONE · EMAIL ON FMCSA FILE', cta: [['Check any'], ['company', 'free.']], steps: ['Officers on the FMCSA filing', 'The phone & email on record', 'Call back. Ask for them by name.'], facts: EN_FREE },
      ],
      sr: [
        { kind: 'hook', clip: 'highway-pov', headline: h('Zove broker.', 'Jesu li to stvarno oni?'), card: { label: 'DOLAZNI POZIV · BROKER', title: 'Quillmont Freight', lines: ['(555) 016-3390', 'Hitan load · Columbus, OH → Atlanta, GA'], stamp: 'STVARNO ONI?', stampColor: colors.orange }, swipe: 'PREVUCI → PROVERI KO JE U ZAPISU' },
        {
          kind: 'phone', src: 'phone-officers-identity.png', headline: h('Ko je u', 'FMCSA zapisu.'), sub: 'ODGOVORNA LICA · TELEFON · EMAIL · PRIMER',
          callouts: [{ lines: ['TELEFON', 'IZ ZAPISA'], side: 'left', y: 383, color: colors.orange }, { lines: ['ODGOVORNA', 'LICA PO IMENU'], side: 'right', y: 450, color: colors.orange }, { lines: ['EMAIL', 'IZ ZAPISA'], side: 'left', y: 518, color: colors.orange }],
          rings: [{ x: 48, y: 362, w: 340, h: 44, color: colors.orange }, { x: 48, y: 428, w: 340, h: 46, color: colors.orange }, { x: 48, y: 496, w: 340, h: 44, color: colors.orange }],
        },
        {
          kind: 'phone', src: 'phone-officers.png', headline: h('Prekini. Pozovi', 'broj iz FMCSA.'), accentSize: 104, sub: 'TRAŽI VLASNIKA PO IMENU',
          callouts: [{ lines: ['POZOVI', 'OVAJ BROJ'], side: 'left', y: 300, color: colors.greenGlow }, { lines: ['TRAŽI IH', 'PO IMENU'], side: 'right', y: 335, color: colors.greenGlow }],
          rings: [{ x: 52, y: 264, w: 330, h: 130, color: colors.greenGlow }],
        },
        { kind: 'cta', chip: 'ODGOVORNA LICA · TELEFON · EMAIL IZ FMCSA', cta: [['Proveri firmu'], ['', 'besplatno.']], steps: ['Odgovorna lica iz FMCSA zapisa', 'Telefon i email iz zapisa', 'Pozovi nazad. Traži ih po imenu.'], facts: SR_FREE },
      ],
    },
  },
  {
    id: 'authority',
    hud: 'AUTHORITY HISTORY',
    slides: {
      en: [
        { kind: 'hook', clip: 'truck-fog', headline: h('This MC', 'looks clean.', colors.greenGlow), card: { label: 'CARRIER · MC-118••• · IRONVALE FREIGHT', title: '12 years old', lines: ['Authority: Active', 'Insurance: $1M on file'], stamp: 'LOOKS CLEAN', stampColor: colors.greenGlow }, swipe: 'SWIPE → READ THE HISTORY' },
        { kind: 'timeline', headline: h('But it sat dead', 'for 2+ years.', colors.redGlow), sub: 'AUTHORITY HISTORY FROM FMCSA · EXAMPLE', steps: [{ date: 'Jun 11, 2014', label: 'FIRST GRANTED', color: colors.greenGlow }, { date: '2y 3m', label: 'NO ACTIVE AUTHORITY', color: colors.redGlow, gap: true }, { date: 'Apr 2, 2026', label: 'REACTIVATED · 6 MONTHS AGO', color: colors.orange }] },
        {
          kind: 'phone', src: 'phone-authority-flag.png', headline: h('Haulock flags it:', '+30 red flag.', colors.redGlow), sub: 'A COMMON FREIGHT FRAUD PATTERN',
          callouts: [{ lines: ['GRANTED', '→ DORMANT', '→ BACK'], side: 'left', y: 345, color: colors.redGlow }, { lines: ['WHAT IT', 'MEANS'], side: 'right', y: 500, color: colors.orange }],
          rings: [{ x: 50, y: 306, w: 270, h: 150, color: colors.red }],
        },
        { kind: 'cta', chip: 'AUTHORITY HISTORY · REACTIVATION FLAG', cta: [['Check any'], ['carrier', 'free.']], steps: ['Full authority history from FMCSA', 'Flags reactivation after a long gap', 'See it before you book'], facts: EN_FREE },
      ],
      sr: [
        { kind: 'hook', clip: 'truck-fog', headline: h('Ovaj MC', 'izgleda čisto.', colors.greenGlow), card: { label: 'PREVOZNIK · MC-118••• · IRONVALE FREIGHT', title: '12 godina', lines: ['Authority: aktivan', 'Osiguranje: $1M u zapisu'], stamp: 'IZGLEDA ČISTO', stampColor: colors.greenGlow }, swipe: 'PREVUCI → PROČITAJ ISTORIJU' },
        { kind: 'timeline', headline: h('Ali bio je mrtav', 'više od 2 godine.', colors.redGlow), sub: 'ISTORIJA AUTHORITY-JA IZ FMCSA · PRIMER', steps: [{ date: '11. jun 2014.', label: 'PRVI PUT DOBIJEN', color: colors.greenGlow }, { date: '2 god. 3 mes.', label: 'BEZ AKTIVNOG AUTHORITY-JA', color: colors.redGlow, gap: true }, { date: '2. april 2026.', label: 'PONOVO AKTIVIRAN · PRE 6 MESECI', color: colors.orange }] },
        {
          kind: 'phone', src: 'phone-authority-flag.png', headline: h('Haulock to označi:', '+30 crvena zastavica.', colors.redGlow), accentSize: 92, sub: 'ČEST OBRAZAC PREVARE U FREIGHTU',
          callouts: [{ lines: ['DOBIJEN', '→ UGAŠEN', '→ OŽIVEO'], side: 'left', y: 345, color: colors.redGlow }, { lines: ['ŠTA TO', 'ZNAČI'], side: 'right', y: 500, color: colors.orange }],
          rings: [{ x: 50, y: 306, w: 270, h: 150, color: colors.red }],
        },
        { kind: 'cta', chip: 'ISTORIJA AUTHORITY-JA · ZASTAVICA', cta: [['Proveri prevoznika'], ['', 'besplatno.']], steps: ['Cela istorija authority-ja iz FMCSA', 'Ponovo aktiviran posle duge pauze?', 'Vidi to pre nego što bukiraš'], facts: SR_FREE },
      ],
    },
  },
  {
    id: 'pdfreport',
    hud: 'PDF REPORT',
    slides: {
      en: [
        { kind: 'pdf', headline: h('Checked a carrier?', 'Share the proof.'), sub: 'SWIPE → WHAT YOUR TEAM GETS', tilt: true, callouts: [] },
        { kind: 'pdf', headline: h('Every report,', 'one clean PDF.'), sub: 'SCORE · AUTHORITY · INSURANCE · SAFETY · INSPECTIONS · WHO TO CALL', callouts: [{ lines: ['SCORE &', 'VERDICT'], side: 'left', y: 640, color: colors.orange }, { lines: ['WHO TO', 'CALL'], side: 'right', y: 940, color: colors.greenGlow }, { lines: ['AUTHORITY &', 'INSURANCE'], side: 'left', y: 1780, color: colors.orange }, { lines: ['+ SAFETY &', 'INSPECTIONS', 'ON PAGE 2'], side: 'right', y: 2100, color: colors.cream }] },
        {
          kind: 'phone', src: 'phone-pdf-email.png', headline: h('Export it. Or email', 'it to dispatch.'), accentSize: 104, sub: 'BRANDED PDF ATTACHED · UP TO 10 RECIPIENTS',
          callouts: [{ lines: ['SEND TO', 'YOUR TEAM'], side: 'left', y: 378, color: colors.orange }, { lines: ['ADD A', 'NOTE'], side: 'right', y: 480, color: colors.orange }],
        },
        { kind: 'cta', chip: 'SHAREABLE PDF REPORT · EXPORT · EMAIL', cta: [['Check any'], ['carrier', 'free.']], steps: ['Every report as a clean PDF', 'Export it in one tap', 'Email it to dispatch, up to 10 people'], facts: EN_FREE },
      ],
      sr: [
        { kind: 'pdf', headline: h('Proverio si prevoznika?', 'Podeli dokaz.'), size: 76, sub: 'PREVUCI → ŠTA TVOJ TIM DOBIJA', tilt: true, callouts: [] },
        { kind: 'pdf', headline: h('Svaki izveštaj,', 'jedan čist PDF.'), sub: 'SKOR · AUTHORITY · OSIGURANJE · BEZBEDNOST · INSPEKCIJE · KOGA ZVATI', callouts: [{ lines: ['SKOR I', 'PRESUDA'], side: 'left', y: 640, color: colors.orange }, { lines: ['KOGA', 'ZVATI'], side: 'right', y: 940, color: colors.greenGlow }, { lines: ['AUTHORITY I', 'OSIGURANJE'], side: 'left', y: 1780, color: colors.orange }, { lines: ['+ BEZBEDNOST', 'I INSPEKCIJE', 'NA STRANI 2'], side: 'right', y: 2100, color: colors.cream }] },
        {
          kind: 'phone', src: 'phone-pdf-email.png', headline: h('Izvezi ga. Ili pošalji', 'dispečeru.'), sub: 'BRENDIRAN PDF U PRILOGU · DO 10 PRIMALACA',
          callouts: [{ lines: ['POŠALJI', 'SVOM TIMU'], side: 'left', y: 378, color: colors.orange }, { lines: ['DODAJ', 'PORUKU'], side: 'right', y: 480, color: colors.orange }],
        },
        { kind: 'cta', chip: 'PDF IZVEŠTAJ · IZVOZ · EMAIL', cta: [['Proveri prevoznika'], ['', 'besplatno.']], steps: ['Svaki izveštaj kao čist PDF', 'Izvoz jednim dodirom', 'Pošalji dispečeru, do 10 ljudi'], facts: SR_FREE },
      ],
    },
  },
];

const Slide: React.FC<{ s: SlideSpec; n: number; hud: string }> = ({ s, n, hud }) => {
  if (s.kind === 'cta') return <CreamCta hudRight={`${n} / 4`} chip={s.chip} cta={s.cta} steps={s.steps} facts={s.facts} stepsLeft={130} />;
  const example = s.kind !== 'hook' && s.kind !== 'rows' ? ' · EXAMPLE DATA' : '';
  return (
    <Post hud={[`HAULOCK // ${hud}${example}`, `${n} / 4`]}>
      {s.kind === 'hook' ? <HookSlide s={s} /> : null}
      {s.kind === 'phone' ? <PhoneSlide s={s} /> : null}
      {s.kind === 'rows' ? <RowsSlide s={s} /> : null}
      {s.kind === 'timeline' ? <TimelineSlide s={s} /> : null}
      {s.kind === 'pdf' ? <PdfSlide s={s} /> : null}
    </Post>
  );
};

// Composition ids: `${feature}-${lang}-${n}`, e.g. coi-sr-2.
export const FEATURE_SLIDES = FEATURES.flatMap((f) =>
  (['en', 'sr'] as const).flatMap((lang) =>
    f.slides[lang].map((s, i) => ({ id: `${f.id}-${lang}-${i + 1}`, component: () => <Slide s={s} n={i + 1} hud={f.hud} /> }))
  )
);
export const FEATURE_IDS = FEATURES.map((f) => f.id);
