import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { type PhoneCut, PhoneRecording } from '../components/AppScreen';
import { FeatureReel, HookCard, Stamp, phraseVo, reelDuration } from '../components/FeatureReel';
import type { CaptionChunk } from '../components/Captions';
import marks from '../../public/recordings/report-pdf.marks.json';
import { clamp, colors, fonts } from '../theme';

// ~18 s reel: the shareable PDF report — the app's own PDF for a clean example carrier
// (scripts/render-report-pdf.cts → report-braxtone-p1/p2.png), then Export PDF and
// "Email this report" on the phone (scripts/record-reports.mjs, take "report-pdf").
// Example carrier: scripts/examples.mjs BRAXTONE.

// Take A (Desmond, eleven_v4), cut at its measured pauses; one entry per phrase.
const VO = phraseVo(
  'voiceovers/pdf-report.mp3',
  [
    { text: 'Checked a carrier?', speech: [0.03, 0.82], gap: 0.15 }, // 0
    { text: 'Share the PROOF.', speech: [1.1, 1.95], gap: 0.2 }, // 1
    { text: 'Every Haulock report becomes a clean PDF —', speech: [2.42, 4.7], gap: 0.35 }, // 2
    { text: 'score, authority, insurance, safety, inspections… and who to call.', speech: [5.15, 8.65], gap: 0.2 }, // 3
    { text: 'Export it.', speech: [8.85, 9.55], gap: 0.25 }, // 4
    { text: 'Or email it straight to dispatch.', speech: [9.97, 12.45], gap: 0.25 }, // 5
    { text: 'Your whole team, on the same page.', speech: [12.72, 14.72], gap: 0.25 }, // 6
    { text: 'Check any carrier free…', speech: [15.05, 16.27], gap: 0.5 }, // 7
    { text: 'at haulock.com.', speech: [16.57, 17.65], gap: 0.2 }, // 8
  ],
  17.92
);
const W = VO.at;
// Inside phrase 3 (measured in the take): authority +0.63 s, insurance +1.41, safety +2.15,
// inspections +2.47, "and who to call" +2.99.
const P3 = (sec: number) => W(3) + Math.round(sec * 30);

const DOC_IN = W(2) - 6;
const PHONE_IN = W(4) - 8;
const END = W(7) - 8;
export const PDF_REPORT_DURATION = reelDuration(END, VO);
const M = marks.marks;
const S = (f: number) => f - PHONE_IN;
const center = (r: { x: number; y: number; w: number; h: number } | null) => ({ x: r!.x + r!.w / 2, y: r!.y + r!.h / 2 });
const SEND_CUT = 90;
const CUTS: PhoneCut[] = [
  { at: 0, from: M.export.t - 0.27 }, // Export PDF → Generating…
  { at: S(W(5)) - 2, from: M.email.t - 0.3, punch: true }, // Email → "Email this report" → dispatch@…
  { at: SEND_CUT, from: M.send.t - 0.55 }, // note typed → Send report → Sent
];
const TAPS = [
  { at: 8, ...center(M.export.rect) },
  { at: S(W(5)) + 7, ...center(M.email.rect) },
  { at: SEND_CUT + 16, ...center(M.send.rect) },
];
const SENT = PHONE_IN + SEND_CUT + Math.round((M.send.t + 1.0 - (M.send.t - 0.55)) * 30) + 4;

// ---------- the PDF: both pages, a camera that visits each section ----------
const PAGE = { w: 1836, h: 2376 }; // report-braxtone-p*.png
const PW = 940;
const K = PW / PAGE.w;
const PH = PAGE.h * K;
const GAP = 44;
const VIEW = { cx: 540, cy: 1250 };
type Rect = { x: number; y: number; w: number; h: number };
// Page regions in page-image px (page 2 offset below page 1).
const p1 = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x: x0 * K, y: y0 * K, w: (x1 - x0) * K, h: (y1 - y0) * K });
const p2 = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x: x0 * K, y: PH + GAP + y0 * K, w: (x1 - x0) * K, h: (y1 - y0) * K });
const KEYS: { at: number; fx: number; fy: number; z: number; box?: Rect }[] = [
  { at: 0, fx: PW / 2, fy: PH / 2, z: 0.96 },
  { at: P3(0) - DOC_IN - 4, fx: PW / 2, fy: 331, z: 1.3, box: p1(143, 482, 1695, 812) }, // score
  { at: P3(0.63) - DOC_IN - 3, fx: PW / 2, fy: 900, z: 1.3, box: p1(143, 1690, 1695, 1762) }, // authority
  { at: P3(1.41) - DOC_IN - 3, fx: PW / 2, fy: 900, z: 1.3, box: p1(143, 1858, 885, 1932) }, // insurance
  { at: P3(2.15) - DOC_IN - 4, fx: PW / 2, fy: PH + GAP + 160, z: 1.28, box: p2(143, 155, 1695, 452) }, // safety
  { at: P3(2.47) - DOC_IN - 2, fx: PW / 2, fy: PH + GAP + 440, z: 1.18, box: p2(143, 497, 1695, 1208) }, // inspections
  { at: P3(2.99) - DOC_IN - 4, fx: PW / 2, fy: 481, z: 1.3, box: p1(143, 871, 1695, 1009) }, // who to call
];
const MOVE = 9;

const PdfPages: React.FC<{ exitAt: number }> = ({ exitAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16, stiffness: 120 } });
  const exit = interpolate(frame, [exitAt - 6, exitAt + 2], [0, 1], clamp);
  let i = 0;
  while (i + 1 < KEYS.length && frame >= KEYS[i + 1].at) i++;
  const cur = KEYS[i];
  const prev = KEYS[Math.max(0, i - 1)];
  const p = i === 0 ? 1 : interpolate(frame, [cur.at, cur.at + MOVE], [0, 1], { ...clamp, easing: (v) => 1 - Math.pow(1 - v, 3) });
  const fx = prev.fx + (cur.fx - prev.fx) * p;
  const fy = prev.fy + (cur.fy - prev.fy) * p;
  const z = (prev.z + (cur.z - prev.z) * p) * (i === 0 ? interpolate(frame, [0, cur.at + 80], [1, 1.04], clamp) : 1);
  const blur = i > 0 ? Math.abs(cur.fy - prev.fy) * 0.012 * Math.sin(Math.PI * p) : 0;
  const ring = cur.box ? spring({ frame: frame - cur.at - 3, fps, config: { damping: 13, stiffness: 210 } }) : 0;
  return (
    <AbsoluteFill style={{ opacity: Math.min(1, enter * 1.4) * (1 - exit), transform: `translateY(${(1 - enter) * 220}px) scale(${1 - 0.1 * exit})` }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 560, bottom: 0, overflow: 'hidden', maskImage: 'linear-gradient(to bottom, transparent 0, #000 40px)' }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: -560,
            width: PW,
            height: PH * 2 + GAP,
            transformOrigin: '0 0',
            transform: `translate(${VIEW.cx - fx * z}px, ${VIEW.cy - fy * z}px) scale(${z})`,
            filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
          }}
        >
          {[1, 2].map((n) => (
            <Img
              key={n}
              src={staticFile(`recordings/report-braxtone-p${n}.png`)}
              style={{ position: 'absolute', left: 0, top: (n - 1) * (PH + GAP), width: PW, height: PH, borderRadius: 8, boxShadow: '0 40px 120px rgba(0,0,0,0.55)' }}
            />
          ))}
          {cur.box ? (
            <div
              style={{
                position: 'absolute',
                left: cur.box.x - 12,
                top: cur.box.y - 12,
                width: cur.box.w + 24,
                height: cur.box.h + 24,
                borderRadius: 14,
                border: `5px solid ${colors.orange}`,
                boxShadow: `0 0 30px ${colors.orange}, 0 0 0 3000px rgba(4,11,26,${0.22 * ring})`,
                opacity: Math.min(1, ring * 1.5),
                transform: `scale(${interpolate(ring, [0, 1], [1.08, 1])})`,
              }}
            />
          ) : null}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 1812,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div style={{ padding: '12px 26px', borderRadius: 999, backgroundColor: 'rgba(4,11,26,0.82)', border: `2px solid ${colors.line}`, fontFamily: fonts.mono, fontSize: 26, letterSpacing: 3, color: colors.cream }}>
          haulock-report-305.pdf · 3 pages
        </div>
      </div>
    </AbsoluteFill>
  );
};

// "Export it": the file the app downloads (lib/report-pdf.ts reportPdfFilename).
const DownloadChip: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 13, stiffness: 220 } });
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 1700, display: 'flex', justifyContent: 'center', opacity: Math.min(1, pop * 1.5), transform: `translateY(${(1 - pop) * 40}px)` }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 22,
          padding: '20px 34px',
          borderRadius: 24,
          backgroundColor: colors.cream,
          color: colors.navy,
          boxShadow: '0 30px 80px rgba(0,0,0,0.5), 0 0 0 5px rgba(255,107,53,0.9)',
        }}
      >
        <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke={colors.orange} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12m0 0l-5-5m5 5l5-5M4 19h16" />
        </svg>
        <span style={{ fontFamily: fonts.mono, fontWeight: 600, fontSize: 34, letterSpacing: 1 }}>haulock-report-305.pdf</span>
      </div>
    </div>
  );
};

const CAPTIONS: CaptionChunk[] = [
  { layout: 'top', until: W(1) - 3, lines: [[{ text: 'Checked', at: 0 }], [{ text: 'a carrier?', at: 0, accent: 'serif', color: colors.orange }]] },
  { layout: 'top', until: W(2) - 3, lines: [[{ text: 'Share the', at: 1 }], [{ text: 'proof.', at: 1, accent: 'serif', color: colors.orange }]] },
  { layout: 'top', until: W(3) - 2, lines: [[{ text: 'Every report becomes', at: 2 }], [{ text: 'a clean PDF.', at: 2, accent: 'serif', color: colors.orange }]] },
  { layout: 'top', until: W(4) - 2, lines: [[{ text: 'Score · authority · insurance', at: 3 }], [{ text: 'safety · who to call', at: 3, accent: 'serif', color: colors.orange, size: 96 }]] },
  { layout: 'top', until: W(5) - 2, lines: [[{ text: 'Export', at: 4 }], [{ text: 'it.', at: 4, accent: 'serif', color: colors.orange }]] },
  { layout: 'top', until: W(6) - 2, lines: [[{ text: 'Or email it straight', at: 5 }], [{ text: 'to dispatch.', at: 5, accent: 'serif', color: colors.orange }]] },
  { layout: 'top', until: END, lines: [[{ text: 'Your whole team,', at: 6 }], [{ text: 'on the same page.', at: 6, accent: 'serif', color: colors.orange }]] },
];

export const PdfReport: React.FC = () => (
  <FeatureReel
    vo={VO}
    duration={PDF_REPORT_DURATION}
    captions={CAPTIONS}
    hudTop="HAULOCK // PDF REPORT"
    hook={{
      until: DOC_IN,
      node: (
        <HookCard
          clip="sunset-drive"
          exitAt={DOC_IN}
          label="CARRIER CHECKED · BRAXTONE TRANSPORT"
          title="Low risk · 0"
          lines={['MC-305••• · authority active', '$1M liability on file']}
          stamp={{ text: 'SHARE IT', at: W(1) + 2, color: colors.orange }}
        />
      ),
    }}
    scenes={[
      { from: DOC_IN, until: PHONE_IN + 4, node: <PdfPages exitAt={PHONE_IN + 4 - DOC_IN} /> },
      {
        from: PHONE_IN,
        until: END,
        node: (
          <>
            <PhoneRecording src="recordings/report-pdf.mp4" css={{ w: 430, h: 880 }} screenW={700} top={590} cuts={CUTS} until={END - PHONE_IN} taps={TAPS} />
            <Sequence from={S(W(4)) + 12} durationInFrames={W(5) - W(4) - 14}>
              <DownloadChip />
            </Sequence>
            <Sequence from={SENT - PHONE_IN}>
              <Stamp big="Sent." small={['PDF TO', 'DISPATCH']} color={colors.green} top={1690} />
            </Sequence>
          </>
        ),
      },
    ]}
    end={{
      at: END,
      urlAt: W(8),
      chip: 'SHAREABLE PDF REPORT · EXPORT · EMAIL',
      headline: [
        [{ text: 'Check any', at: 7 }],
        [{ text: 'carrier', at: 7 }, { text: 'free.', at: 7, accent: true }],
      ],
      checks: ['Free plan included', 'No credit card'],
      hud: { topLeft: 'HAULOCK.COM', bottomLeft: 'PDF REPORT', bottomRight: '3 FREE LOOKUPS / MO' },
    }}
    music={{ src: 'music/epical-drums-02.mp3', bed: [[0, 30], [0.21, 0.21]], swell: 0.5 }}
    sfx={[
      { src: 'sfx/impact.mp3', at: W(1) + 1, volume: 0.22 },
      { src: 'sfx/riser.mp3', at: DOC_IN - 4, volume: 0.25 },
      { src: 'sfx/beep.mp3', at: P3(0), volume: 0.2 },
      { src: 'sfx/beep.mp3', at: P3(0.63), volume: 0.2 },
      { src: 'sfx/beep.mp3', at: P3(1.41), volume: 0.2 },
      { src: 'sfx/beep.mp3', at: P3(2.15), volume: 0.2 },
      { src: 'sfx/beep.mp3', at: P3(2.47), volume: 0.2 },
      { src: 'sfx/beep.mp3', at: P3(2.99), volume: 0.2 },
      { src: 'sfx/beep.mp3', at: PHONE_IN + 8, volume: 0.24 },
      { src: 'sfx/beep.mp3', at: PHONE_IN + TAPS[1].at, volume: 0.22 },
      { src: 'sfx/beep.mp3', at: PHONE_IN + TAPS[2].at, volume: 0.22 },
      { src: 'sfx/impact.mp3', at: SENT - 1, volume: 0.22 },
    ]}
    hits={[
      { at: W(1) + 2, glitch: 10, flash: 0.2, color: colors.orange, shake: 10 },
      { at: DOC_IN, glitch: 6, flash: 0.14 },
      { at: PHONE_IN, glitch: 6, flash: 0.12 },
      { at: SENT, flash: 0.16, color: colors.green, shake: 6 },
    ]}
  />
);
