// Builds a branded Haulock PDF report from a carrier verification result.
// Used by /api/report/pdf (download) and /api/report/email (attachment).

import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import { promises as fs } from 'fs';
import path from 'path';

// Brand palette — keep in sync with app/globals.css and Haulock.tsx.
const NAVY = rgb(0.043, 0.118, 0.247);          // #0B1E3F
const NAVY_SOFT = rgb(0.043, 0.118, 0.247);
const ORANGE = rgb(1.0, 0.42, 0.208);            // #FF6B35
const GREEN = rgb(0.086, 0.639, 0.290);          // #16A34A
const AMBER = rgb(0.961, 0.620, 0.043);          // #F59E0B
const RED = rgb(0.863, 0.149, 0.149);            // #DC2626
const CREAM = rgb(0.961, 0.953, 0.933);          // #F5F3EE
const BORDER = rgb(0.85, 0.85, 0.88);
const MUTED = rgb(0.45, 0.48, 0.55);
const WHITE = rgb(1, 1, 1);

const PAGE_W = 612; // 8.5"
const PAGE_H = 792; // 11"
const MARGIN_X = 48;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

type Carrier = any;

export async function buildReportPdf(report: Carrier): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Haulock Risk Report — ${report.name || 'Carrier'}`);
  pdf.setAuthor('Haulock');
  pdf.setProducer('Haulock');
  pdf.setCreator('haulock.com');
  pdf.setCreationDate(new Date());

  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const helvObl = await pdf.embedFont(StandardFonts.HelveticaOblique);

  // Embed the wordmark if present; fall back to text otherwise.
  let logoImg: any = null;
  try {
    const logoPath = path.join(process.cwd(), 'public', 'haulock-logo.png');
    const bytes = await fs.readFile(logoPath);
    logoImg = await pdf.embedPng(bytes);
  } catch { /* fall back to text wordmark */ }

  const ctx: DrawCtx = {
    pdf, helv, helvBold, helvObl, logoImg,
    page: pdf.addPage([PAGE_W, PAGE_H]),
    y: PAGE_H - MARGIN_X,
    pageNum: 1,
  };

  drawHeader(ctx, report);
  drawHero(ctx, report);
  drawDetailGrid(ctx, 'Identity', identityItems(report));
  drawDetailGrid(ctx, 'FMCSA authority & insurance', fmcsaItems(report));
  drawDetailGrid(ctx, 'Operations & safety record', opsSafetyItems(report));
  drawWebPresence(ctx, report);
  drawAddressCheck(ctx, report);
  drawRedFlags(ctx, report);

  const total = pdf.getPageCount();
  for (let i = 0; i < total; i++) drawFooter(pdf.getPage(i), helv, i + 1, total);

  return pdf.save();
}

export function reportPdfFilename(report: Carrier): string {
  const id = (report.mc || report.dot || report.name || 'carrier').toString();
  return `haulock-report-${slug(id)}.pdf`;
}

// ----- internal drawing helpers -------------------------------------------

type DrawCtx = {
  pdf: PDFDocument;
  helv: PDFFont;
  helvBold: PDFFont;
  helvObl: PDFFont;
  logoImg: any;
  page: PDFPage;
  y: number;
  pageNum: number;
};

function ensureSpace(ctx: DrawCtx, needed: number) {
  if (ctx.y - needed < 70) {
    ctx.page = ctx.pdf.addPage([PAGE_W, PAGE_H]);
    ctx.y = PAGE_H - MARGIN_X;
    ctx.pageNum += 1;
  }
}

function drawHeader(ctx: DrawCtx, r: Carrier) {
  if (ctx.logoImg) {
    const logoH = 22;
    const ratio = ctx.logoImg.width / ctx.logoImg.height;
    const logoW = logoH * ratio;
    ctx.page.drawImage(ctx.logoImg, { x: MARGIN_X, y: ctx.y - logoH, width: logoW, height: logoH });
  } else {
    ctx.page.drawText('HAULOCK', { x: MARGIN_X, y: ctx.y - 16, size: 18, font: ctx.helvBold, color: NAVY });
  }
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  drawTextRight(ctx.page, today, ctx.helv, 9, MUTED, PAGE_W - MARGIN_X, ctx.y - 6);
  drawTextRight(ctx.page, 'haulock.com', ctx.helvBold, 9, NAVY, PAGE_W - MARGIN_X, ctx.y - 18);
  ctx.y -= 36;
  ctx.page.drawLine({ start: { x: MARGIN_X, y: ctx.y }, end: { x: PAGE_W - MARGIN_X, y: ctx.y }, thickness: 0.5, color: BORDER });
  ctx.y -= 22;

  ctx.page.drawText('Risk Report', { x: MARGIN_X, y: ctx.y - 18, size: 22, font: ctx.helvBold, color: NAVY });
  const idLine = [r.mc ? `MC-${r.mc}` : null, r.dot ? `DOT-${r.dot}` : null].filter(Boolean).join(' · ');
  if (idLine) drawTextRight(ctx.page, idLine, ctx.helv, 10, MUTED, PAGE_W - MARGIN_X, ctx.y - 10);
  ctx.y -= 26;

  ctx.page.drawText(truncate(r.name || 'Unknown carrier', 60), {
    x: MARGIN_X, y: ctx.y - 16, size: 16, font: ctx.helvBold, color: NAVY,
  });
  const badge = entityLabel(r);
  drawBadge(ctx, badge.label, PAGE_W - MARGIN_X, ctx.y - 14, badge.color);
  ctx.y -= 28;
}

function drawHero(ctx: DrawCtx, r: Carrier) {
  ensureSpace(ctx, 130);
  const heroH = 110;
  const top = ctx.y;
  ctx.page.drawRectangle({
    x: MARGIN_X, y: top - heroH, width: CONTENT_W, height: heroH,
    color: WHITE, borderColor: BORDER, borderWidth: 0.5,
  });

  const score = typeof r.score === 'number' ? r.score : 0;
  const verdict = r.verdict === 'high' ? 'HIGH RISK' : r.verdict === 'medium' ? 'CAUTION' : 'LOW RISK';
  const verdictColor = r.verdict === 'high' ? RED : r.verdict === 'medium' ? AMBER : GREEN;
  const cx = MARGIN_X + 70;
  const cy = top - heroH / 2;

  ctx.page.drawCircle({ x: cx, y: cy, size: 38, color: WHITE, borderColor: verdictColor, borderWidth: 3 });
  drawTextCentered(ctx.page, String(score), ctx.helvBold, 24, NAVY, cx, cy - 8);
  drawTextCentered(ctx.page, '/ 100', ctx.helv, 8, MUTED, cx, cy - 22);

  const rx = MARGIN_X + 160;
  ctx.page.drawText('RISK LEVEL', { x: rx, y: top - 22, size: 8, font: ctx.helvBold, color: MUTED });
  ctx.page.drawText(verdict, { x: rx, y: top - 38, size: 16, font: ctx.helvBold, color: verdictColor });

  const rec = r.verdict === 'high'
    ? 'Do not book this load.'
    : r.verdict === 'medium' ? 'Proceed with caution.'
    : 'Safe to book.';
  ctx.page.drawText(rec, { x: rx, y: top - 60, size: 12, font: ctx.helvBold, color: NAVY });

  const rec2 = r.verdict === 'high'
    ? 'Multiple serious red flags detected. Verify identity through an independent channel.'
    : r.verdict === 'medium' ? 'Some risk signals. Verify rate-con details against FMCSA records.'
    : 'Clean record. No major red flags. Standard payment terms appropriate.';
  drawWrappedText(ctx.page, rec2, ctx.helv, 9, MUTED, rx, top - 75, CONTENT_W - 160 - 8, 11);

  ctx.y -= heroH + 20;
}

function drawDetailGrid(ctx: DrawCtx, title: string, items: Array<{ label: string; value: string }>) {
  if (items.length === 0) return;
  ensureSpace(ctx, 40 + items.length * 18);
  drawSectionTitle(ctx, title);
  const colW = CONTENT_W / 2;
  let y = ctx.y;
  for (let i = 0; i < items.length; i += 2) {
    const left = items[i];
    const right = items[i + 1];
    ensureSpace(ctx, 30);
    if (y !== ctx.y) y = ctx.y;
    drawDetailRow(ctx.page, ctx.helv, ctx.helvBold, MARGIN_X, y, colW - 12, left);
    if (right) drawDetailRow(ctx.page, ctx.helv, ctx.helvBold, MARGIN_X + colW, y, colW - 12, right);
    y -= 28;
    ctx.y = y;
  }
  ctx.y -= 6;
}

function drawDetailRow(page: PDFPage, helv: PDFFont, helvBold: PDFFont, x: number, y: number, w: number, item: { label: string; value: string }) {
  page.drawRectangle({ x, y: y - 22, width: w, height: 22, color: CREAM });
  page.drawText(item.label.toUpperCase(), { x: x + 8, y: y - 9, size: 7, font: helvBold, color: MUTED });
  const valStr = truncate(item.value || '—', Math.floor(w / 4.5));
  page.drawText(valStr, { x: x + 8, y: y - 19, size: 9.5, font: helvBold, color: NAVY });
}

function drawWebPresence(ctx: DrawCtx, r: Carrier) {
  if (!r.webPresence?.configured) return;
  ensureSpace(ctx, 90);
  drawSectionTitle(ctx, 'Web presence');
  const w = r.webPresence;
  const found = !!w.found;
  const items: Array<{ label: string; value: string }> = [
    { label: 'Website', value: found ? (w.domain || w.url || '—') : 'Not found via Google' },
    { label: 'Name match', value: found ? (w.nameMatch ? 'Yes — domain matches name' : 'No — possible mismatch') : '—' },
    { label: 'Domain age', value: w.domainAgeDays != null
        ? (w.domainAgeDays < 365 ? `${w.domainAgeDays} days` : `${(w.domainAgeDays / 365).toFixed(1)} years`)
        : '—' },
    { label: 'Email infra', value: [w.hasMx ? 'MX' : null, w.hasSpf ? 'SPF' : null].filter(Boolean).join(' · ') || '—' },
  ];
  if (Array.isArray(w.socials) && w.socials.length) {
    items.push({ label: 'Social profiles', value: w.socials.map((s: any) => s.platform).join(' · ') });
  }
  drawDetailRows(ctx, items);
}

function drawAddressCheck(ctx: DrawCtx, r: Carrier) {
  if (!r.addressCheck?.configured) return;
  ensureSpace(ctx, 80);
  drawSectionTitle(ctx, 'Address verification');
  const a = r.addressCheck;
  const items: Array<{ label: string; value: string }> = [
    { label: 'FMCSA address', value: r.address || '—' },
    { label: 'Google Places match', value: a.found ? (a.formatted || a.placeName || 'Found') : 'Not found in Places' },
    { label: 'Status', value: a.isMailbox ? 'Mailbox / mail-forwarding' : a.businessStatus || (a.found ? 'Operational' : '—') },
  ];
  drawDetailRows(ctx, items);
}

function drawRedFlags(ctx: DrawCtx, r: Carrier) {
  const flags = Array.isArray(r.flags) ? r.flags : [];
  ensureSpace(ctx, 60);
  drawSectionTitle(ctx, `Red flags detected · ${flags.length}`);
  if (!flags.length) {
    ensureSpace(ctx, 26);
    ctx.page.drawText('No red flags detected.', { x: MARGIN_X, y: ctx.y - 12, size: 10, font: ctx.helvObl, color: MUTED });
    ctx.y -= 18;
    return;
  }
  for (const f of flags) {
    const titleH = 14;
    const descLines = wrap(f.desc || '', ctx.helv, 9, CONTENT_W - 24);
    const cardH = titleH + 6 + descLines.length * 12 + 12;
    ensureSpace(ctx, cardH + 8);
    const top = ctx.y;
    const sevColor = f.sev === 'critical' ? RED : f.sev === 'warning' ? AMBER : NAVY;
    ctx.page.drawRectangle({ x: MARGIN_X, y: top - cardH, width: 3, height: cardH, color: sevColor });
    ctx.page.drawRectangle({ x: MARGIN_X + 3, y: top - cardH, width: CONTENT_W - 3, height: cardH, color: WHITE, borderColor: BORDER, borderWidth: 0.5 });
    ctx.page.drawText(truncate(f.title || 'Risk signal', 80), { x: MARGIN_X + 12, y: top - 14, size: 10.5, font: ctx.helvBold, color: NAVY });
    if (typeof f.pts === 'number') {
      drawTextRight(ctx.page, `+${f.pts}`, ctx.helvBold, 9, sevColor, PAGE_W - MARGIN_X - 12, top - 14);
    }
    let dy = top - 14 - 12;
    for (const line of descLines) {
      ctx.page.drawText(line, { x: MARGIN_X + 12, y: dy, size: 9, font: ctx.helv, color: MUTED });
      dy -= 12;
    }
    ctx.y -= cardH + 8;
  }
}

function drawDetailRows(ctx: DrawCtx, items: Array<{ label: string; value: string }>) {
  for (const it of items) {
    ensureSpace(ctx, 22);
    ctx.page.drawRectangle({ x: MARGIN_X, y: ctx.y - 20, width: CONTENT_W, height: 20, color: CREAM });
    ctx.page.drawText(it.label.toUpperCase(), { x: MARGIN_X + 10, y: ctx.y - 9, size: 7, font: ctx.helvBold, color: MUTED });
    const valStr = truncate(it.value || '—', 80);
    drawTextRight(ctx.page, valStr, ctx.helvBold, 9.5, NAVY, PAGE_W - MARGIN_X - 10, ctx.y - 13);
    ctx.y -= 22;
  }
  ctx.y -= 4;
}

function drawSectionTitle(ctx: DrawCtx, title: string) {
  ensureSpace(ctx, 28);
  ctx.page.drawText(title.toUpperCase(), { x: MARGIN_X, y: ctx.y - 12, size: 9, font: ctx.helvBold, color: NAVY });
  ctx.page.drawLine({
    start: { x: MARGIN_X, y: ctx.y - 18 },
    end:   { x: PAGE_W - MARGIN_X, y: ctx.y - 18 },
    thickness: 0.5, color: BORDER,
  });
  ctx.y -= 24;
}

function drawFooter(page: PDFPage, helv: PDFFont, pageNum: number, total: number) {
  const y = 36;
  page.drawLine({ start: { x: MARGIN_X, y: y + 14 }, end: { x: PAGE_W - MARGIN_X, y: y + 14 }, thickness: 0.5, color: BORDER });
  page.drawText('Generated by Haulock · haulock.com', { x: MARGIN_X, y, size: 8, font: helv, color: MUTED });
  drawTextRight(page, `Page ${pageNum} of ${total}`, helv, 8, MUTED, PAGE_W - MARGIN_X, y);
}

function drawBadge(ctx: DrawCtx, label: string, rightX: number, baselineY: number, color: any) {
  const padX = 8;
  const w = ctx.helvBold.widthOfTextAtSize(label, 8) + padX * 2;
  const h = 14;
  ctx.page.drawRectangle({ x: rightX - w, y: baselineY - 3, width: w, height: h, color });
  ctx.page.drawText(label, { x: rightX - w + padX, y: baselineY + 2, size: 8, font: ctx.helvBold, color: WHITE });
}

function drawTextRight(page: PDFPage, text: string, font: PDFFont, size: number, color: any, rightX: number, y: number) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: rightX - w, y, size, font, color });
}

function drawTextCentered(page: PDFPage, text: string, font: PDFFont, size: number, color: any, cx: number, y: number) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: cx - w / 2, y, size, font, color });
}

function drawWrappedText(page: PDFPage, text: string, font: PDFFont, size: number, color: any, x: number, y: number, maxW: number, lineH: number) {
  const lines = wrap(text, font, size, maxW);
  let yy = y;
  for (const ln of lines) {
    page.drawText(ln, { x, y: yy, size, font, color });
    yy -= lineH;
  }
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = String(text || '').split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? cur + ' ' + w : w;
    if (font.widthOfTextAtSize(trial, size) > maxW) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = trial;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function entityLabel(r: Carrier): { label: string; color: any } {
  const isCarrier = r.commonAuthority === 'Active' || r.contractAuthority === 'Active';
  const isBroker = r.brokerAuthority === 'Active';
  if (isCarrier && isBroker) return { label: 'CARRIER + BROKER', color: NAVY_SOFT };
  if (isBroker) return { label: 'BROKER', color: ORANGE };
  if (isCarrier) return { label: 'CARRIER', color: NAVY_SOFT };
  return { label: 'NO AUTHORITY', color: RED };
}

function identityItems(r: Carrier): Array<{ label: string; value: string }> {
  return [
    { label: 'Legal name', value: r.name || '—' },
    { label: 'DBA', value: r.dba || '—' },
    { label: 'Physical address', value: r.address || '—' },
    { label: 'Phone', value: r.phone || '—' },
    { label: 'Email domain', value: r.emailDomain || '—' },
    { label: 'Authority age', value: r.authorityAge || '—' },
  ];
}

function fmcsaItems(r: Carrier): Array<{ label: string; value: string }> {
  return [
    { label: 'Operating authority', value: r.authorityStatus || '—' },
    { label: 'Broker authority', value: r.brokerAuthority || '—' },
    { label: 'Safety rating', value: r.safetyRating || 'Not rated' },
    { label: 'Out-of-service', value: r.outOfService ? 'Yes' : 'No' },
    { label: 'Insurance on file', value: r.insuranceSummary || '—' },
    { label: 'MCS-150', value: r.mcs150Date || (r.mcs150Outdated ? 'Overdue' : 'Current') },
  ];
}

function opsSafetyItems(r: Carrier): Array<{ label: string; value: string }> {
  const fleet = r.powerUnits != null ? `${r.powerUnits} power units${r.drivers != null ? ` · ${r.drivers} drivers` : ''}` : '—';
  const drvOos = r.driverOosRate != null
    ? `${r.driverOosRate.toFixed(2)}%${r.driverOosRateNat != null ? ` (nat. ${r.driverOosRateNat.toFixed(2)}%)` : ''}`
    : '—';
  const vehOos = r.vehicleOosRate != null
    ? `${r.vehicleOosRate.toFixed(2)}%${r.vehicleOosRateNat != null ? ` (nat. ${r.vehicleOosRateNat.toFixed(2)}%)` : ''}`
    : '—';
  return [
    { label: 'Fleet size', value: fleet },
    { label: 'Classification', value: r.operation || '—' },
    { label: 'Total crashes', value: r.crashTotal != null ? String(r.crashTotal) : '—' },
    { label: 'Fatal crashes', value: r.fatalCrash != null ? String(r.fatalCrash) : '—' },
    { label: 'Driver OOS rate', value: drvOos },
    { label: 'Vehicle OOS rate', value: vehOos },
  ];
}

function truncate(s: string, max: number): string {
  if (!s) return '—';
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function slug(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
}
