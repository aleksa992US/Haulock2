import {
  getResendClient,
  getEmailSiteUrl,
  sendEmail,
  inboundScanReplyTemplate,
  type InboundScanResult,
  type InboundReplyMode,
} from './email';
import { getServiceSupabase } from './supabase/service';
import { resolveTeamContext, type TeamContext } from './teams';
import { countMonthlyLookups } from './usage';
import { monthStart, type Plan } from './plans';
import { isAdmin } from './admin';
import { ocrForScan, analyzeRateConText, PipelineError } from './rate-con-pipeline';
import { runCoiCheckFromText, type CoiReport } from './coi-check';
import { analyzePdfForensics } from './pdf-forensics';
import { parseQuery, lookupCarrier } from './fmcsa';
import { scoreCarrier } from './risk';

// Forward-to-scan: someone emails a rate con or COI to scan@haulock.com and
// gets a verdict back in the same thread. Called by the Resend inbound
// webhook (app/api/inbound/email/route.ts) after it has verified the
// signature and claimed the email in `inbound_scans` (dedupe).
//
// Privacy: attachments are downloaded into memory, checked and dropped.
// Nothing from the email itself is stored except the sender address, the
// document types and the verdict (for rate limiting and support).

export const scanAddress = () => (process.env.INBOUND_SCAN_ADDRESS || 'scan@haulock.com').trim().toLowerCase();
const PREVIEW_MONTHLY = Number(process.env.INBOUND_PREVIEW_MONTHLY || 3);
const DAILY_CAP = Number(process.env.INBOUND_DAILY_CAP || 25);
const MAX_ATTACHMENTS = 3;
const MAX_BYTES = 10 * 1024 * 1024;

export type InboundOutcome = {
  status: 'replied' | 'ignored' | 'failed';
  tier?: 'full' | 'preview' | 'limit' | 'nothing';
  userId?: string | null;
  docTypes?: string[];
  verdict?: string;
  note?: string;
};

export function emailAddress(raw: string | null | undefined): string {
  const s = String(raw || '');
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

const RATECON_DISCLAIMER =
  'Automated check of the document you forwarded against public FMCSA records, domain data and the PDF’s metadata. It is not a finding that any company acted improperly. Verify the broker through an independent channel — the FMCSA-listed phone number, not one printed on the rate con — before booking. Questions or corrections: contact@haulock.com.';
const MC_DISCLAIMER =
  'Automated check of public FMCSA data for the number in your email. It is not a finding that any company acted improperly. Confirm identity through the FMCSA-listed phone number before booking. Questions or corrections: contact@haulock.com.';

// ---------- sender recognition ----------

const userCache = new Map<string, { id: string; email: string; plan?: string; at: number } | null>();

async function findUserByEmail(addr: string): Promise<{ id: string; email: string; plan?: string } | null> {
  const hit = userCache.get(addr);
  if (hit !== undefined && (hit === null || Date.now() - hit.at < 10 * 60_000)) return hit;
  const svc = getServiceSupabase();
  if (!svc) return null;
  // Supabase's admin API has no lookup-by-email; page through users (1,000 a
  // page) and stop at the first match.
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    const users = data?.users || [];
    const u = users.find((x: any) => String(x.email || '').toLowerCase() === addr);
    if (u) {
      const found = { id: u.id, email: addr, plan: (u.user_metadata as any)?.plan, at: Date.now() };
      userCache.set(addr, found);
      return found;
    }
    if (users.length < 1000) break;
  }
  userCache.set(addr, null);
  return null;
}

// ---------- loop and abuse protection ----------

function shouldIgnore(from: string, headers: Record<string, string>): string | null {
  const h = (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? '';
  const ownDomain = scanAddress().split('@')[1];
  const fromDomain = from.split('@')[1] || '';
  if (!from.includes('@')) return 'no sender';
  if (ownDomain && (fromDomain === ownDomain || fromDomain.endsWith(`.${ownDomain}`))) return 'own domain';
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce)/i.test(from)) return 'system sender';
  if (h('x-haulock-scan')) return 'our own reply';
  const autoSubmitted = h('auto-submitted');
  if (autoSubmitted && !/^no$/i.test(autoSubmitted)) return 'auto-submitted';
  if (/bulk|list|junk/i.test(h('precedence'))) return 'bulk mail';
  if (h('list-id') || h('list-unsubscribe')) return 'mailing list';
  if (h('x-autoreply') || h('x-autorespond')) return 'auto-reply';
  return null;
}

async function countInbound(from: string, sinceIso: string, tier?: string): Promise<number> {
  const svc = getServiceSupabase();
  if (!svc) return 0;
  let q = svc.from('inbound_scans').select('id', { count: 'exact', head: true }).eq('from_email', from).gte('created_at', sinceIso);
  if (tier) q = q.eq('tier', tier);
  const { count } = await q;
  return count ?? 0;
}

// ---------- result cards ----------

function coiCard(r: CoiReport, filename?: string): InboundScanResult {
  return {
    kind: 'coi',
    filename,
    headline: r.name,
    idLine: [r.mc && `MC-${r.mc}`, r.dot && `DOT-${r.dot}`].filter(Boolean).join(' · ') || undefined,
    tone: r.verdict === 'mismatch' ? 'bad' : r.verdict === 'verify' ? 'warn' : 'good',
    verdictLabel: r.verdictLabel,
    findings: r.checks.map((c) => ({
      tone: c.status === 'fail' ? 'bad' : c.status === 'warn' ? 'warn' : c.status === 'pass' ? 'good' : 'info',
      title: c.title,
      desc: c.detail,
    })),
    disclaimer: r.disclaimer,
  };
}

function carrierCard(kind: 'ratecon' | 'mc', report: any, filename: string | undefined, extra: InboundScanResult['findings']): InboundScanResult {
  const verdict = report.verdict || (report.score >= 61 ? 'high' : report.score >= 31 ? 'medium' : 'low');
  const flags: InboundScanResult['findings'] = (report.flags || [])
    .filter((f: any) => f.sev !== 'info' || f.pts > 0)
    .sort((a: any, b: any) => (b.pts || 0) - (a.pts || 0))
    .map((f: any) => ({ tone: f.sev === 'critical' ? 'bad' : f.sev === 'warning' ? 'warn' : 'info', title: f.title, desc: f.desc }));
  return {
    kind,
    filename,
    headline: report.name || 'Unknown company',
    idLine: [report.mc && `MC-${report.mc}`, report.dot && `DOT-${report.dot}`].filter(Boolean).join(' · ') || undefined,
    tone: verdict === 'high' ? 'bad' : verdict === 'medium' ? 'warn' : 'good',
    verdictLabel: verdict === 'high' ? 'High risk · verify before booking' : verdict === 'medium' ? 'Caution · verify before booking' : 'Low risk · no major red flags',
    score: typeof report.score === 'number' ? report.score : undefined,
    findings: [...extra, ...flags],
    disclaimer: kind === 'mc' ? MC_DISCLAIMER : RATECON_DISCLAIMER,
  };
}

// ---------- main ----------

export async function processInboundEmail(emailId: string): Promise<InboundOutcome> {
  const resend = getResendClient();
  if (!resend) return { status: 'failed', note: 'RESEND_API_KEY is not set' };

  const { data: email, error } = await resend.emails.receiving.get(emailId);
  if (error || !email) return { status: 'failed', note: error?.message || 'email not found' };

  const from = emailAddress(email.from);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(email.headers || {})) headers[k.toLowerCase()] = String(v);
  const ignore = shouldIgnore(from, headers);
  if (ignore) return { status: 'ignored', note: ignore };

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  if ((await countInbound(from, dayAgo)) > DAILY_CAP) return { status: 'ignored', note: 'daily cap' };

  // Who is this, and what do they get?
  const user = await findUserByEmail(from);
  let ctx: TeamContext | null = null;
  let plan: Plan | null = null;
  let admin = false;
  if (user) {
    ctx = await resolveTeamContext(user.id, user.plan);
    plan = ctx.effectivePlan;
    admin = await isAdmin(user.email);
  }
  const paid = admin || (plan != null && plan.id !== 'free');

  const siteUrl = getEmailSiteUrl();
  const reply = async (results: InboundScanResult[], mode: InboundReplyMode) => {
    const { html } = inboundScanReplyTemplate({ results, reply: mode, siteUrl, scanAddress: scanAddress(), hasAccount: Boolean(user) });
    const subject = email.subject ? (/^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`) : 'Your Haulock check';
    const messageId = email.message_id ? (email.message_id.startsWith('<') ? email.message_id : `<${email.message_id}>`) : null;
    await sendEmail({
      to: from,
      subject,
      html,
      replyTo: 'contact@haulock.com',
      headers: {
        ...(messageId ? { 'In-Reply-To': messageId, References: messageId } : {}),
        'Auto-Submitted': 'auto-replied',
        'X-Haulock-Scan': '1',
      },
      kind: 'inbound_scan',
    });
  };

  let previewsLeft = 0;
  if (!paid) {
    const used = await countInbound(from, monthStart().toISOString(), 'preview');
    previewsLeft = PREVIEW_MONTHLY - used;
    if (previewsLeft <= 0) {
      await reply([], {
        mode: 'limit',
        reason: `Free email checks are limited to ${PREVIEW_MONTHLY} a month per address. ${user ? 'Upgrade to a paid plan for full reports on every email you forward.' : 'Create a free Haulock account, or upgrade, for more checks.'}`,
        upgrade: Boolean(user),
      });
      return { status: 'replied', tier: 'limit', userId: user?.id ?? null };
    }
  }

  // Attachments: PDFs and real (non-inline) images, up to 3.
  const list = await resend.emails.receiving.attachments.list({ emailId });
  const attachments = (list.data?.data || [])
    .filter((a) => {
      const type = String(a.content_type || '').toLowerCase();
      const name = String(a.filename || '').toLowerCase();
      const pdf = type.includes('pdf') || name.endsWith('.pdf');
      const image = /image\/(png|jpe?g)/.test(type) && a.content_disposition === 'attachment' && a.size >= 20_000;
      return (pdf || image) && a.size <= MAX_BYTES;
    })
    .slice(0, MAX_ATTACHMENTS);

  const results: InboundScanResult[] = [];
  const docTypes: string[] = [];
  let limited = 0;
  let notInPlan = false;
  const svc = getServiceSupabase();
  // Only paid plans get results saved to history; free and unknown senders
  // get the email preview only.
  const save = async (row: Record<string, any>) => {
    if (!user || !svc || !paid) return;
    try { await svc.from('lookups').insert({ user_id: user.id, ...row }); } catch { /* history is best-effort */ }
  };
  const overCap = async (source: 'ratecon' | 'coi' | 'quick', cap: number | null | undefined) =>
    paid && !admin && cap != null && user && ctx ? (await countMonthlyLookups(user.id, ctx, source)) >= cap : false;

  for (const a of attachments) {
    const filename = a.filename || 'attachment';
    try {
      const res = await fetch(a.download_url);
      if (!res.ok) throw new Error(`download ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      const mime = String(a.content_type || '').toLowerCase().includes('pdf') || filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : String(a.content_type).toLowerCase().replace('image/jpg', 'image/jpeg');
      const ocrText = await ocrForScan(bytes, mime);
      const isCoi = /CERTIFICATE\s+OF\s+(LIABILITY\s+)?INSURANCE|ACORD\s*25|ACORD\s+CORPORATION/i.test(ocrText);

      if (isCoi) {
        docTypes.push('coi');
        if (!paid && !admin) {
          limited += 1;
          notInPlan = true;
          results.push({ kind: 'coi', filename, headline: 'COI checks are on paid plans', tone: 'warn', verdictLabel: 'Not checked', findings: [{ tone: 'info', title: 'Upgrade to check certificates', desc: 'COI checks are included on the Carrier, Team and Fleet plans.' }], disclaimer: RATECON_DISCLAIMER });
          continue;
        }
        if (await overCap('coi', plan?.limits.coiChecks)) {
          limited += 1;
          results.push({ kind: 'coi', filename, headline: 'Monthly COI check limit reached', tone: 'warn', verdictLabel: 'Not checked', findings: [{ tone: 'info', title: 'Upgrade for more COI checks', desc: `Your plan includes ${plan?.limits.coiChecks} COI checks a month.` }], disclaimer: RATECON_DISCLAIMER });
          continue;
        }
        const report = await runCoiCheckFromText({ ocrText, bytes, mime, filename });
        results.push(coiCard(report, filename));
        await save({
          query: report.mc ? `COI · MC-${report.mc}` : `COI · ${report.extraction.insured_name || filename}`,
          name: report.name, mc: report.mc || null, dot: report.dot || null, score: report.score,
          verdict: report.verdict === 'mismatch' ? 'high' : report.verdict === 'verify' ? 'medium' : 'low',
          source: 'coi', data: { ...report, via: 'email' },
        });
      } else {
        docTypes.push('ratecon');
        if (await overCap('ratecon', plan?.limits.rateConScans)) {
          limited += 1;
          results.push({ kind: 'ratecon', filename, headline: 'Monthly rate con scan limit reached', tone: 'warn', verdictLabel: 'Not checked', findings: [{ tone: 'info', title: 'Upgrade for more rate con scans', desc: `Your plan includes ${plan?.limits.rateConScans} rate con scans a month.` }], disclaimer: RATECON_DISCLAIMER });
          continue;
        }
        const [scan, forensics] = await Promise.all([
          analyzeRateConText(ocrText),
          mime === 'application/pdf' ? analyzePdfForensics(bytes).catch(() => null) : Promise.resolve(null),
        ]);
        const extra: InboundScanResult['findings'] = [];
        if (forensics?.verdict === 'likely_tampered') {
          extra.push({ tone: 'bad', title: 'PDF was modified after it was created', desc: forensics.flags.filter((f) => f.sev !== 'info').slice(0, 2).map((f) => f.title).join(' · ') || 'The file metadata shows edits after creation. Compare the rate with what the broker confirmed.' });
        } else if (forensics?.verdict === 'suspicious') {
          extra.push({ tone: 'warn', title: 'PDF metadata has irregularities', desc: forensics.flags.filter((f) => f.sev !== 'info').slice(0, 2).map((f) => f.title).join(' · ') || 'Some metadata looks unusual.' });
        }
        results.push(carrierCard('ratecon', scan.report, filename, extra));
        await save({
          query: scan.lookupQuery, name: scan.report.name, mc: scan.report.mc || null, dot: scan.report.dot || null,
          score: scan.report.score, verdict: scan.report.verdict, email_query: scan.extraction.broker_email || null,
          source: 'ratecon', data: { ...scan.report, source_hint: 'email', forensics: forensics || undefined },
        });
      }
    } catch (e: any) {
      const msg = e instanceof PipelineError ? e.message : 'We couldn’t read this file.';
      results.push({ kind: 'ratecon', filename, headline: 'Couldn’t check this attachment', tone: 'warn', verdictLabel: 'Not checked', findings: [{ tone: 'info', title: 'What happened', desc: msg }], disclaimer: RATECON_DISCLAIMER });
      console.warn('[inbound-scan] attachment failed', { emailId, filename, error: e?.message });
    }
  }

  // No usable attachment: look for an MC/DOT number in the message itself.
  if (attachments.length === 0) {
    const text = `${email.subject || ''}\n${email.text || String(email.html || '').replace(/<[^>]+>/g, ' ')}`;
    const mc = text.match(/\bM\.?C\.?\s*(?:#|No\.?|number)?\s*[:\-]?\s*(\d{4,8})\b/i)?.[1];
    const dot = text.match(/\b(?:US\s*)?DOT\s*(?:#|No\.?|number)?\s*[:\-]?\s*(\d{5,8})\b/i)?.[1];
    const q = mc ? `MC-${mc}` : dot ? `DOT-${dot}` : null;
    const parsed = q ? parseQuery(q) : null;
    if (!parsed) {
      await reply([], { mode: 'nothing' });
      return { status: 'replied', tier: 'nothing', userId: user?.id ?? null };
    }
    docTypes.push('mc');
    if (await overCap('quick', plan?.limits.fmcsaLookups)) {
      await reply([], { mode: 'limit', reason: `Your plan includes ${plan?.limits.fmcsaLookups} lookups a month.`, upgrade: true });
      return { status: 'replied', tier: 'limit', userId: user?.id ?? null };
    }
    try {
      const report = scoreCarrier(await lookupCarrier(parsed));
      if (report.source === 'mock') throw new Error('not found');
      results.push(carrierCard('mc', report, undefined, []));
      await save({ query: q!, name: report.name, mc: report.mc || null, dot: report.dot || null, score: report.score, verdict: report.verdict, source: 'quick', data: report });
    } catch {
      results.push({ kind: 'mc', headline: `${q} not found in FMCSA`, tone: 'warn', verdictLabel: 'Couldn’t verify', findings: [{ tone: 'warn', title: 'No FMCSA match', desc: `We couldn’t find ${q} in FMCSA records. Double-check the number with the company using an independent phone number.` }], disclaimer: MC_DISCLAIMER });
    }
  }

  const checked = results.filter((r) => r.verdictLabel !== 'Not checked');
  let mode: InboundReplyMode;
  if (checked.length === 0 && limited > 0) {
    mode = { mode: 'limit', reason: notInPlan ? 'COI checks are included on paid plans.' : 'Your plan’s monthly allowance for these checks is used up.', upgrade: true };
  } else if (checked.length === 0) {
    mode = { mode: 'error' };
  } else {
    mode = paid ? { mode: 'full' } : { mode: 'preview', remaining: previewsLeft - 1 };
  }
  await reply(results, mode);
  const worst = checked.some((r) => r.tone === 'bad') ? 'bad' : checked.some((r) => r.tone === 'warn') ? 'warn' : 'good';
  return {
    status: checked.length === 0 && limited === 0 ? 'failed' : 'replied',
    // Only a delivered preview counts against the free monthly allowance.
    tier: mode.mode === 'preview' ? 'preview' : mode.mode === 'full' ? 'full' : mode.mode === 'limit' ? 'limit' : undefined,
    userId: user?.id ?? null,
    docTypes,
    verdict: worst,
  };
}
