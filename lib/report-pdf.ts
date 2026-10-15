// Builds a branded Haulock PDF report from a carrier verification result.
// Used by /api/report/pdf (download) and /api/report/email (attachment).

import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import { promises as fs } from 'fs';
import path from 'path';
import { carrierAuthorityLabel, recommendationFor } from './recommendation';
import { fetchSafetyActivity, type CrashEvent, type InspectionEvent, type SafetyActivity } from './fmcsa-inspections';

// Standard PDF fonts only cover basic Latin (WinAnsi); swap typographic
// punctuation, and replace anything else they can't encode — pdf-lib throws
// on it, e.g. the Cyrillic letters in a look-alike domain flag.
function pdfSafe(t: string): string {
  return t.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
    .replace(/[^\n\t\x20-\x7E\xA0-\xFF\u20AC\u2022\u2122]/g, '?');
}

// Every string in the report, made drawable.
function pdfSafeDeep<T>(v: T): T {
  if (typeof v === 'string') return pdfSafe(v) as unknown as T;
  if (Array.isArray(v)) return v.map(pdfSafeDeep) as unknown as T;
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v as any).map(([k, x]) => [k, pdfSafeDeep(x)])) as T;
  }
  return v;
}

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

export async function buildReportPdf(input: Carrier): Promise<Uint8Array> {
  const report = pdfSafeDeep(input);
  // The 24-month inspections & crashes panel loads separately on the report
  // page, so the saved report doesn't carry it. Fetch it here (cached by
  // fetchSafetyActivity); a slow or failed fetch just says so in the PDF.
  const activity = report.dot
    ? pdfSafeDeep(await withTimeout(fetchSafetyActivity(report.dot).catch(() => null), 10_000))
    : null;
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
  drawDataSourceNote(ctx, report);
  drawHero(ctx, report);
  drawVerdictNotes(ctx, report);
  drawDetailGrid(ctx, 'Identity', identityItems(report));
  drawDetailGrid(ctx, 'FMCSA authority & insurance', fmcsaItems(report));
  drawDetailGrid(ctx, 'Operations & safety record', opsSafetyItems(report));
  drawSafetyActivity(ctx, report, activity);
  drawSmsScores(ctx, report);
  drawWebPresence(ctx, report);
  drawAddressCheck(ctx, report);
  drawReputation(ctx, report);
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

  // Same role-aware advice as the report page (carrier vs broker).
  const recommendation = recommendationFor(r, r.verdict);
  const rec = pdfSafe(recommendation.headline);
  ctx.page.drawText(rec, { x: rx, y: top - 60, size: 12, font: ctx.helvBold, color: NAVY });

  const rec2 = pdfSafe(recommendation.detail);
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
  // Same rule as the report page: a site is only "theirs" when its name
  // matches AND its listing has the FMCSA address or phone. Age and email
  // setup describe the site's owner, so they're shown only for a confirmed site.
  const confirmed = found && w.verified === true;
  const items: Array<{ label: string; value: string }> = [
    { label: 'Website', value: found ? (w.domain || w.url || '-') : 'None found' },
    { label: 'Ownership', value: !found ? '-' : confirmed
        ? `Confirmed (${w.verifiedBy === 'phone' ? 'phone matches FMCSA' : 'address matches FMCSA'})`
        : 'Not confirmed as theirs' },
  ];
  if (confirmed) {
    items.push({ label: 'Domain age', value: w.domainAgeDays != null
        ? (w.domainAgeDays < 365 ? `${w.domainAgeDays} days` : `${(w.domainAgeDays / 365).toFixed(1)} years`)
        : '-' });
    items.push({ label: 'Email setup', value: w.hasMx == null ? "Couldn't check" : [w.hasMx ? 'MX' : 'No MX', w.hasSpf ? 'SPF' : null].filter(Boolean).join(' · ') });
  }
  if (confirmed && Array.isArray(w.socials) && w.socials.length) {
    items.push({ label: 'Social profiles', value: w.socials.map((s: any) => s.platform).join(' · ') });
  }
  drawDetailRows(ctx, items);
}

function drawAddressCheck(ctx: DrawCtx, r: Carrier) {
  if (!r.addressCheck?.configured) return;
  ensureSpace(ctx, 80);
  drawSectionTitle(ctx, 'Address verification');
  // Field names match CarrierReport.addressCheck (lib/fmcsa.ts).
  const a = r.addressCheck;
  const flagTitles = (Array.isArray(r.flags) ? r.flags : []).map((f: any) => String(f?.title || ''));
  const differentBusiness = flagTitles.some((t: string) => /address resolves to a different business/i.test(t));
  const items: Array<{ label: string; value: string }> = [
    { label: 'FMCSA address', value: r.address || '—' },
  ];
  if (a.error) {
    items.push({ label: 'Google Places', value: 'Could not check' });
  } else if (!a.found) {
    items.push({ label: 'Google Places', value: 'No listing at this address' });
  } else {
    items.push({ label: 'Business at address', value: a.matchedName || '—' });
    if (a.matchedAddress) items.push({ label: 'Places address', value: a.matchedAddress });
    items.push({
      label: 'Status',
      value: a.isMailbox
        ? `Mail-forwarding service${a.mailboxProvider ? ` (${a.mailboxProvider})` : ''}`
        : a.isResidence
          ? 'Residence / no business listed'
          : a.businessStatus === 'CLOSED_PERMANENTLY'
            ? 'Closed permanently'
            : a.businessStatus === 'CLOSED_TEMPORARILY'
              ? 'Closed temporarily'
              : a.businessStatus === 'OPERATIONAL' ? 'Operational' : '—',
    });
    if (differentBusiness) items.push({ label: 'Name check', value: `Different business than ${r.name || 'this company'}` });
  }
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
    { label: 'Phone', value: r.phone ? fmtPhone(r.phone) : '—' },
    { label: (r.officers || []).length > 1 ? 'Company officers' : 'Company officer', value: (r.officers || []).length ? r.officers.join(', ') : '-' },
    { label: r.fmcsaEmail ? 'Email on FMCSA filing' : 'Email domain', value: r.fmcsaEmail || r.emailDomain || '-' },
    // QCMobile has no grant date; age comes from FMCSA's authority history
    // when it could be fetched. Say so instead of a bare dash.
    { label: 'Authority age', value: r.authorityAge || (r.authorityHistory?.checked ? 'No grant on record' : 'Unavailable') },
  ];
}

// "2026-03-15" / "03/15/2026" style dates, or "Overdue" / "Not overdue"
// from FMCSA's Y/N flag. Never "Current" without a date.
function mcs150Label(r: Carrier): string {
  const date = r.mcs150Date || r.sms?.carrier?.mcs150Date;
  if (date) return r.mcs150Outdated === true ? `${date} (overdue)` : String(date);
  if (r.mcs150Outdated === true) return 'Overdue';
  if (r.mcs150Outdated === false) return 'Not overdue';
  return '—';
}

function oosRateLabel(rate: number | null | undefined, nat: number | null | undefined, insp: number | null | undefined): string {
  if (rate == null || !Number.isFinite(Number(rate))) return '—';
  const parts = [`${Number(rate).toFixed(2)}%`];
  if (nat != null && Number.isFinite(Number(nat))) parts.push(`nat. ${Number(nat).toFixed(2)}%`);
  if (insp != null) parts.push(`${insp} insp.`);
  return parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(', ')})` : parts[0];
}

function fmcsaItems(r: Carrier): Array<{ label: string; value: string }> {
  return [
    { label: 'Carrier authority', value: carrierAuthorityLabel(r) },
    { label: 'Broker authority', value: r.brokerAuthority || '—' },
    { label: 'Safety rating', value: r.safetyRating || 'Not rated' },
    { label: 'Out-of-service', value: r.outOfService === true ? 'Yes' : r.outOfService === false ? 'No' : '—' },
    { label: 'Insurance on file', value: r.insuranceSummary || '—' },
    { label: 'MCS-150', value: mcs150Label(r) },
  ];
}

function opsSafetyItems(r: Carrier): Array<{ label: string; value: string }> {
  const fleet = r.powerUnits != null ? `${r.powerUnits} power units${r.drivers != null ? ` · ${r.drivers} drivers` : ''}` : '—';
  const smsInsp = r.sms?.fetched ? r.sms.inspections : null;
  const drvOos = oosRateLabel(r.driverOosRate, r.driverOosRateNat, r.driverInspections ?? smsInsp?.driverInspections);
  const vehOos = oosRateLabel(r.vehicleOosRate, r.vehicleOosRateNat, r.vehicleInspections ?? smsInsp?.vehicleInspections);
  return [
    { label: 'Fleet size', value: fleet },
    { label: 'Classification', value: r.operation || '—' },
    { label: 'Total crashes', value: r.crashTotal != null ? String(r.crashTotal) : '—' },
    { label: 'Fatal crashes', value: r.fatalCrash != null ? String(r.fatalCrash) : '—' },
    { label: 'Driver OOS rate', value: drvOos },
    { label: 'Vehicle OOS rate', value: vehOos },
  ];
}

// ----- sections that mirror the report page --------------------------------

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

function fmtPhone(p: string): string {
  return String(p).replace(/^(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3');
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00` : d);
  return isNaN(t.getTime()) ? String(d) : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

// A cream box with a small label and wrapped text.
function drawNote(ctx: DrawCtx, label: string, text: string) {
  const lines = wrap(text, ctx.helv, 9.5, CONTENT_W - 20);
  const h = 22 + lines.length * 12;
  ensureSpace(ctx, h + 8);
  const top = ctx.y;
  ctx.page.drawRectangle({ x: MARGIN_X, y: top - h, width: CONTENT_W, height: h, color: CREAM });
  ctx.page.drawText(label.toUpperCase(), { x: MARGIN_X + 10, y: top - 12, size: 7, font: ctx.helvBold, color: MUTED });
  let y = top - 25;
  for (const ln of lines) {
    ctx.page.drawText(ln, { x: MARGIN_X + 10, y, size: 9.5, font: ctx.helv, color: NAVY });
    y -= 12;
  }
  ctx.y -= h + 8;
}

// Same wording as the report page's banner when FMCSA's live service
// didn't answer and an older copy was used.
function drawDataSourceNote(ctx: DrawCtx, r: Carrier) {
  const src = r.dataSource;
  if (!src || src === 'fmcsa-live') return;
  const what = src === 'socrata' ? "FMCSA's daily public data file"
    : src === 'cache' ? "Haulock's saved copy of FMCSA data"
    : "FMCSA's archive, which can be years old";
  drawNote(ctx, 'Data source', `FMCSA's live service didn't answer, so this report uses ${what}${r.dataAsOf ? ` from ${fmtDate(r.dataAsOf)}` : ''}.`);
}

// The "what checked out" list from the report page, with the same rule:
// a chip is left out when a scored flag on the same topic contradicts it.
function checkedOut(r: Carrier): string[] {
  const scored = (r.flags || []).filter((f: any) => (Number(f?.pts) || 0) > 0);
  const flagged = (re: RegExp) => scored.some((f: any) => re.test(String(f.title || '')));
  const carrierActive = r.commonAuthority === 'Active' || r.contractAuthority === 'Active';
  const brokerActive = r.brokerAuthority === 'Active';
  const ok: string[] = [];
  if (carrierActive || brokerActive) ok.push(`${carrierActive && brokerActive ? 'Carrier & broker' : carrierActive ? 'Carrier' : 'Broker'} authority active`);
  if (r.authorityAge && !/reactivated/i.test(r.authorityAge) && !flagged(/^Authority (age under|recently reactivated)/)) ok.push(`${r.authorityAge} of authority`);
  if (carrierActive && r.bipdOnFile != null && r.bipdOnFile > 0 && !(r.bipdRequired != null && r.bipdOnFile < r.bipdRequired)) ok.push(`$${(r.bipdOnFile * 1000).toLocaleString('en-US')} liability on file`);
  if (brokerActive && r.bondOnFile != null && r.bondOnFile >= 75) ok.push('Broker bond on file');
  if (r.outOfService === false) ok.push('Not out of service');
  if (r.addressCheck?.found && !r.addressCheck.isMailbox && !flagged(/^(Address |Business at this address)/)) ok.push('Address checks out');
  if (r.webPresence?.verified) ok.push('Website confirmed');
  if (r.webReputation?.ok && (r.webReputation.hits || []).length === 0) ok.push('No fraud reports online');
  return ok;
}

function drawVerdictNotes(ctx: DrawCtx, r: Carrier) {
  // An impersonator on a spoofed number usually can't name the officer.
  const officers: string[] = (r.officers || []).filter(Boolean).slice(0, 2);
  if (officers.length && r.phone) {
    drawNote(ctx, 'Confirm who you are dealing with',
      `Call ${fmtPhone(r.phone)} (the number on FMCSA's record) and ask for ${officers.join(' or ')}, ${officers.length > 1 ? 'the officers' : 'the officer'} on the company's FMCSA filing${r.censusAsOf ? ` (updated ${fmtDate(r.censusAsOf)})` : ''}.`);
  }
  const ok = checkedOut(r);
  if (ok.length) drawNote(ctx, 'What checked out', ok.join('  ·  '));
}

function drawSubheading(ctx: DrawCtx, text: string) {
  ensureSpace(ctx, 40);
  ctx.page.drawText(text.toUpperCase(), { x: MARGIN_X, y: ctx.y - 10, size: 7.5, font: ctx.helvBold, color: MUTED });
  ctx.y -= 16;
}

function inspectionLine(e: InspectionEvent): string {
  const where = e.location || e.state || '';
  const level = e.level ? `Level ${['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][e.level] || e.level}` : '';
  const oosParts = [e.vehicleOos ? `${e.vehicleOos} vehicle` : '', e.driverOos ? `${e.driverOos} driver` : ''].filter(Boolean).join(', ');
  const result = e.oos > 0 ? `${e.oos} out of service${oosParts ? ` (${oosParts})` : ''}`
    : e.violations > 0 ? plural(e.violations, 'violation') : 'Clean';
  return [where, level, result].filter(Boolean).join(' · ');
}

function crashLine(e: CrashEvent): string {
  const where = [e.city, e.state].filter(Boolean).join(', ') || e.location || '';
  const outcome = [
    e.fatalities ? `${e.fatalities} killed` : '',
    e.injuries ? `${e.injuries} injured` : '',
    e.towAway ? 'tow-away' : '',
  ].filter(Boolean).join(', ') || 'Reported crash';
  return [where, outcome].filter(Boolean).join(' · ');
}

function drawSafetyActivity(ctx: DrawCtx, r: Carrier, a: SafetyActivity | null) {
  if (!r.dot) return;
  ensureSpace(ctx, 90);
  drawSectionTitle(ctx, 'Roadside inspections & crashes · last 24 months');
  if (!a) {
    drawDetailRows(ctx, [{ label: 'FMCSA inspection data', value: "Couldn't load right now - see the online report" }]);
    return;
  }
  const i = a.inspections;
  const c = a.crashes;
  const pct = (n: number) => (i.total ? `${Math.round((n / i.total) * 100)}%` : '0%');
  const items: Array<{ label: string; value: string }> = [
    { label: 'Inspections', value: i.total ? `${i.total} · ${i.clean} clean (${pct(i.clean)}) · ${i.withViolations} with violations · ${i.oos} out of service` : 'None in 24 months' },
  ];
  if (i.oos) items.push({ label: 'Out-of-service orders', value: `${i.vehicleOos} vehicle · ${i.driverOos} driver` });
  items.push({ label: 'Crashes', value: c.total ? `${c.total} · ${c.fatal} fatal · ${c.injury} injury · ${c.towAway} tow-away` : 'None in 24 months' });
  items.push({ label: 'Last 30 days', value: `${plural(a.last30.inspections, 'inspection')} (${a.last30.oos} out of service) · ${plural(a.last30.crashes, 'crash', 'crashes')}` });
  if (i.last) items.push({ label: 'Latest inspection', value: `${fmtDate(i.last.date)} · ${inspectionLine(i.last)}` });
  if (c.last) items.push({ label: 'Latest crash', value: `${fmtDate(c.last.date)} · ${crashLine(c.last)}` });
  drawDetailRows(ctx, items);

  const oosRecent = (i.recent || []).filter((e) => e.oos > 0).slice(0, 6);
  if (oosRecent.length) {
    drawSubheading(ctx, 'Recent out-of-service inspections');
    drawDetailRows(ctx, oosRecent.map((e) => ({ label: fmtDate(e.date), value: inspectionLine(e) })));
  }
  const crashesRecent = (c.recent || []).slice(0, 5);
  if (crashesRecent.length) {
    drawSubheading(ctx, 'Recent crashes');
    drawDetailRows(ctx, crashesRecent.map((e) => ({ label: fmtDate(e.date), value: crashLine(e) })));
  }
}

const BASIC_LABELS: Record<string, string> = {
  unsafeDriving: 'Unsafe Driving',
  hoursOfService: 'Hours-of-Service Compliance',
  driverFitness: 'Driver Fitness',
  controlledSubstances: 'Controlled Substances / Alcohol',
  vehicleMaintenance: 'Vehicle Maintenance',
  hazmat: 'Hazardous Materials Compliance',
  crashIndicator: 'Crash Indicator',
};

function drawSmsScores(ctx: DrawCtx, r: Carrier) {
  const s = r.sms;
  if (!s?.fetched) return;
  const rows: Array<{ label: string; value: string }> = [];
  for (const key of Object.keys(BASIC_LABELS)) {
    const b = s.basics?.[key];
    if (!b) continue;
    // Older saved reports carry FMCSA's threshold as a "percentile" on
    // categories with no measure (same guard as the report page).
    const percentile = b.percentile != null && b.measure > 0 ? b.percentile : null;
    if (!(b.measure > 0) && percentile == null && !(b.inspections > 0)) continue;
    const parts = [
      percentile != null ? `${Math.round(percentile)}th percentile` : b.measure > 0 ? `Measure ${Number(b.measure).toFixed(2)}` : 'No violations scored',
      b.inspections > 0 ? plural(b.inspections, 'inspection') : '',
      b.alert ? 'FMCSA alert' : '',
    ].filter(Boolean);
    rows.push({ label: BASIC_LABELS[key], value: parts.join(' · ') });
  }
  if (!rows.length) return;
  ensureSpace(ctx, 40 + rows.length * 22);
  drawSectionTitle(ctx, 'FMCSA safety scores (SMS)');
  drawDetailRows(ctx, rows);
  ensureSpace(ctx, 20);
  drawWrappedText(ctx.page, 'Percentiles compare the carrier with similar carriers; lower is better. FMCSA hides some scores and alert symbols from public view, so a missing score is not a clean bill of health.', ctx.helvObl, 8, MUTED, MARGIN_X, ctx.y - 6, CONTENT_W, 10);
  ctx.y -= 28;
}

function drawReputation(ctx: DrawCtx, r: Carrier) {
  const w = r.webReputation;
  if (!w?.configured) return;
  ensureSpace(ctx, 60);
  drawSectionTitle(ctx, 'Online reputation');
  if (!w.ok) {
    drawDetailRows(ctx, [{ label: 'Web search', value: "Search didn't respond - see the online report" }]);
    return;
  }
  const hits = Array.isArray(w.hits) ? w.hits : [];
  const review = Array.isArray(w.reviewHits) ? w.reviewHits : [];
  const items: Array<{ label: string; value: string }> = [
    { label: 'Fraud reports found', value: hits.length ? plural(hits.length, 'page') : 'None on trusted sites' },
  ];
  for (const h of hits.slice(0, 5)) items.push({ label: truncate(h.domain || 'Page', 24), value: truncate(h.title || h.url || '', 64) });
  if (review.length) items.push({ label: 'Other pages to review', value: `${review.length} (court cases or mentions, not scored)` });
  drawDetailRows(ctx, items);
}

function truncate(s: string, max: number): string {
  if (!s) return '—';
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function slug(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
}
