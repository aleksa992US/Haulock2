import { NextResponse } from 'next/server';
import { authorizeCronOrAdmin } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/service';
import { fetchCensusContact } from '@/lib/fmcsa-census';
import { lookupCarrier, parseQuery } from '@/lib/fmcsa';
import { sendEmail, watchlistUpdateTemplate, isResendConfigured, type WatchlistChange, type WatchlistFieldChange } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Daily watchlist refresh. For each watchlist row:
//   1. Run a fresh FMCSA registry lookup (QCMobile, with its fallbacks).
//   2. Compare only FMCSA registry fields — authority per role, insurance,
//      bond, out-of-service, safety rating, address, phone, name — with the
//      last FMCSA snapshot for that row.
//   3. If any of them changed, email the owner (subject to their
//      notify_watchlist preference) listing exactly what changed.
//
// This is NOT a full scan: web reputation, Places, website, SMS and
// cross-reference checks don't run here. So the job never re-scores, never
// says risk "improved" or "got worse", and never overwrites the saved full
// report (row.data) or its score — the FMCSA snapshot is kept separately in
// row.data.fmcsaWatch. Runs from Vercel Cron once a day. Safe to re-run: the
// snapshot is updated after each check, so the same change isn't re-sent.

type FmcsaWatchSnapshot = {
  // When a real FMCSA change was last found (the weekly digest counts these).
  lastChangeAt?: string;
  name?: string;
  dba?: string;
  address?: string;
  phone?: string;
  commonAuthority?: string;
  contractAuthority?: string;
  brokerAuthority?: string;
  bipdOnFile?: number;
  cargoOnFile?: number;
  bondOnFile?: number;
  outOfService?: boolean;
  safetyRating?: string;
  // From the MCS-150 filing (FMCSA census): who runs the company and the
  // email of record. Changes here are how carrier identities get hijacked.
  officers?: string;
  fmcsaEmail?: string;
  // Every phone FMCSA has returned for this row. QCMobile alternates between
  // phone fields from one response to the next, so a number we've already
  // seen isn't reported as a change.
  seenPhones?: string[];
  checkedAt?: string;
};

const WATCH_KEYS = ['name', 'dba', 'address', 'phone', 'commonAuthority', 'contractAuthority', 'brokerAuthority', 'bipdOnFile', 'cargoOnFile', 'bondOnFile', 'outOfService', 'safetyRating', 'officers', 'fmcsaEmail'] as const;

function snapshotOf(c: any): FmcsaWatchSnapshot {
  const out: FmcsaWatchSnapshot = {};
  for (const k of WATCH_KEYS) {
    let v = c?.[k];
    if (k === 'officers' && Array.isArray(v)) v = v.join(', ');
    if (v === undefined || v === null || v === '') continue;
    (out as any)[k] = v;
  }
  return out;
}

const textKey = (v: unknown) => String(v ?? '').toUpperCase().replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim();
const phoneKey = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);
const moneyK = (k: number) => (k === 0 ? '$0' : `$${(k * 1000).toLocaleString('en-US')}`);
const UNRATED = /^(not rated|none|)$/i;

// FMCSA field changes between two snapshots. A field counts only when both
// sides have a value: a field missing from one response (fallback data
// sources leave some out) is "not checked", not a change.
function diffSnapshots(prev: FmcsaWatchSnapshot, next: FmcsaWatchSnapshot, opts: { legacyBaseline: boolean }): WatchlistFieldChange[] {
  const out: WatchlistFieldChange[] = [];
  const has = (v: unknown) => v !== undefined && v !== null && v !== '';

  const text = (key: 'name' | 'dba' | 'address', label: string) => {
    if (has(prev[key]) && has(next[key]) && textKey(prev[key]) !== textKey(next[key])) {
      out.push({ field: key, label, from: String(prev[key]), to: String(next[key]), concern: true });
    }
  };
  text('name', 'Legal name');
  text('dba', 'DBA name');
  text('address', 'Physical address');

  if (has(prev.phone) && has(next.phone) && phoneKey(prev.phone) !== phoneKey(next.phone)) {
    const seen = new Set((prev.seenPhones || []).map(phoneKey));
    if (!seen.has(phoneKey(next.phone))) {
      out.push({ field: 'phone', label: 'Phone', from: String(prev.phone), to: String(next.phone), concern: true });
    }
  }

  const authority = (key: 'commonAuthority' | 'contractAuthority' | 'brokerAuthority', label: string) => {
    if (has(prev[key]) && has(next[key]) && prev[key] !== next[key]) {
      out.push({ field: key, label, from: String(prev[key]), to: String(next[key]), concern: prev[key] === 'Active' });
    }
  };
  authority('commonAuthority', 'Common carrier authority');
  authority('contractAuthority', 'Contract carrier authority');
  authority('brokerAuthority', 'Broker authority');

  const money = (key: 'bipdOnFile' | 'cargoOnFile' | 'bondOnFile', label: string) => {
    const a = prev[key];
    const b = next[key];
    if (typeof a === 'number' && typeof b === 'number' && a !== b) {
      out.push({ field: key, label, from: moneyK(a), to: moneyK(b), concern: b < a });
    }
  };
  money('bipdOnFile', 'Liability insurance (BIPD) on file');
  money('cargoOnFile', 'Cargo insurance on file');
  money('bondOnFile', 'Broker bond on file');

  if (typeof prev.outOfService === 'boolean' && typeof next.outOfService === 'boolean' && prev.outOfService !== next.outOfService) {
    // Reports saved before the OOS fix counted any old OOS date as "out of
    // service". Yes → No against such a baseline is our correction, not an
    // FMCSA change, so it isn't reported.
    if (!(opts.legacyBaseline && prev.outOfService && !next.outOfService)) {
      out.push({
        field: 'outOfService',
        label: 'Out-of-service order',
        from: prev.outOfService ? 'In effect' : 'None',
        to: next.outOfService ? 'In effect' : 'None',
        concern: next.outOfService,
      });
    }
  }

  // "Not rated" also shows up when a fallback source has no rating at all,
  // so a rating disappearing isn't reported; a new or different one is.
  // MCS-150 contact details. Only compared when both checks got them.
  if (has(prev.officers) && has(next.officers) && textKey(prev.officers) !== textKey(next.officers)) {
    out.push({ field: 'officers', label: 'Company officers on FMCSA filing', from: String(prev.officers), to: String(next.officers), concern: true });
  }
  if (has(prev.fmcsaEmail) && has(next.fmcsaEmail) && String(prev.fmcsaEmail).toLowerCase() !== String(next.fmcsaEmail).toLowerCase()) {
    out.push({ field: 'fmcsaEmail', label: 'Email on FMCSA filing', from: String(prev.fmcsaEmail), to: String(next.fmcsaEmail), concern: true });
  }

  const ra = String(prev.safetyRating ?? '');
  const rb = String(next.safetyRating ?? '');
  if (!UNRATED.test(rb) && textKey(ra) !== textKey(rb)) {
    out.push({ field: 'safetyRating', label: 'Safety rating', from: UNRATED.test(ra) ? 'Not rated' : ra, to: rb, concern: /unsatisfactory|conditional/i.test(rb) });
  }

  return out;
}
export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  const denied = await authorizeCronOrAdmin(req);
  if (denied) return denied;

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const { data: rows, error } = await svc.from('watchlist').select('*').order('last_checked', { ascending: true, nullsFirst: true }).limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) return NextResponse.json({ ok: true, processed: 0 });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === '1';

  // Pull every user once so we know their email + notification preference.
  // Service role can list users via the auth admin API.
  const userMap = new Map<string, { email: string; notifyOn: boolean; notificationEmail: string | null }>();
  {
    const { data: usersPage } = await svc.auth.admin.listUsers({ perPage: 1000 });
    for (const u of usersPage?.users || []) {
      const meta = (u.user_metadata || {}) as any;
      userMap.set(u.id, {
        email: u.email || '',
        notifyOn: meta.notify_watchlist !== false,
        notificationEmail: typeof meta.notification_email === 'string' && meta.notification_email.trim() ? meta.notification_email.trim() : null,
      });
    }
  }

  let processed = 0;
  let sent = 0;
  let skipped = 0;
  const results: any[] = [];
  const { getEmailSiteUrl } = await import('@/lib/email');
  const siteUrl = getEmailSiteUrl();
  const checkedAt = new Date().toISOString();

  for (const row of rows) {
    processed += 1;
    const u = userMap.get(row.user_id);
    if (!u?.email) { skipped += 1; continue; }

    // Build the lookup query — prefer MC over DOT for FMCSA reliability.
    const queryStr = row.mc ? `MC-${row.mc}` : row.dot ? `DOT-${row.dot}` : '';
    const parsed = parseQuery(queryStr);
    if (!parsed) { skipped += 1; continue; }

    let fresh: any;
    try {
      // Registry fields only; the authority-age history isn't compared.
      fresh = await lookupCarrier(parsed, { skipAuthorityHistory: true });
    } catch (err: any) {
      // FMCSA hiccup — leave the row untouched, try again tomorrow.
      results.push({ id: row.id, status: 'fmcsa-error', message: err?.message });
      continue;
    }
    if (fresh?.source !== 'fmcsa') {
      // No live FMCSA data (e.g. no WebKey → mock carrier). Nothing to compare.
      results.push({ id: row.id, status: 'no-live-data' });
      continue;
    }
    // MCS-150 officers + email of record (FMCSA census). A failed fetch just
    // leaves them out of this check — never reported as a change.
    const census = fresh.dot ? await fetchCensusContact(fresh.dot).catch(() => null) : null;
    if (census) {
      if (census.officers.length) fresh.officers = census.officers;
      if (census.email) fresh.fmcsaEmail = census.email;
    }

    const saved = (row.data || {}) as any;
    // Baseline: the FMCSA snapshot from the last daily check, or — the first
    // time — the FMCSA fields of the full report saved with the watch.
    const legacyBaseline = !saved.fmcsaWatch;
    const prevSnap: FmcsaWatchSnapshot = saved.fmcsaWatch || snapshotOf(saved);
    const freshSnap = snapshotOf(fresh);
    const changes = diffSnapshots(prevSnap, freshSnap, { legacyBaseline });

    // Next baseline: fresh values, keeping previous values for fields this
    // response didn't include, plus the phones seen so far.
    const seenPhones = Array.from(new Set([
      ...(prevSnap.seenPhones || []),
      ...(prevSnap.phone ? [prevSnap.phone] : []),
      ...(freshSnap.phone ? [freshSnap.phone] : []),
    ].map((ph) => String(ph)))).slice(-5);
    const nextSnap: FmcsaWatchSnapshot = { ...prevSnap, ...freshSnap, seenPhones, checkedAt, lastChangeAt: changes.length > 0 ? checkedAt : prevSnap.lastChangeAt };
    const saveSnapshot = async () => {
      if (dryRun) return;
      // Only data.fmcsaWatch and last_checked change; the saved full report,
      // last_score and last_verdict stay as the user's last full scan left them.
      await svc.from('watchlist').update({
        last_checked: checkedAt,
        data: { ...saved, fmcsaWatch: nextSnap },
      }).eq('id', row.id);
    };

    if (changes.length === 0) {
      await saveSnapshot();
      skipped += 1;
      continue;
    }

    const change: WatchlistChange = { changes };

    if (u.notifyOn && isResendConfigured() && !dryRun) {
      const toAddress = u.notificationEmail || u.email;
      try {
        const { subject, html } = watchlistUpdateTemplate({
          carrier: { name: fresh.name || row.name, mc: fresh.mc || row.mc, dot: fresh.dot || row.dot },
          change,
          recipientEmail: toAddress,
          siteUrl,
          own: saved.own === true,
        });
        await sendEmail({ to: toAddress, subject, html, kind: 'newsletter' });
        sent += 1;
      } catch (err: any) {
        results.push({ id: row.id, status: 'send-error', message: err?.message });
      }
    }

    await saveSnapshot();

    results.push({
      id: row.id,
      name: fresh.name || row.name,
      mc: row.mc, dot: row.dot,
      changed: changes.map((c) => ({ field: c.field, from: c.from, to: c.to })),
      notified: u.notifyOn && !dryRun,
    });

    // Polite spacing for the FMCSA + Resend APIs.
    await new Promise((r) => setTimeout(r, 400));
  }

  return NextResponse.json({ ok: true, processed, sent, skipped, dryRun, sample: results.slice(0, 10) });
}
