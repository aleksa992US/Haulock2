import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { lookupCarrier, parseQuery } from '@/lib/fmcsa';
import { scoreCarrier } from '@/lib/risk';
import { checkAddress } from '@/lib/places';
import { findCarrierWebsite, nameMatchesDomain } from '@/lib/website-finder';
import { checkDomain } from '@/lib/domain';
import { findSocialLinks } from '@/lib/social-finder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Diff a new auto-snapshot against the previous one. Returns null when
// nothing meaningful changed, so the chip stays calm. Direction tells the
// UI whether the change is concerning (worse) or reassuring (better).
type AutoChange = {
  at: string;
  direction: 'worse' | 'better' | 'neutral';
  scoreFrom: number;
  scoreTo: number;
  scoreDelta: number;
  verdictFrom: string;
  verdictTo: string;
  verdictChanged: boolean;
  newFlags: string[];
  removedFlags: string[];
  authorityChanged: boolean;
  authorityFrom?: string | null;
  authorityTo?: string | null;
  addressChanged: boolean;
  addressFrom?: string | null;
  addressTo?: string | null;
  insuranceChanged: boolean;
  outOfServiceChanged: boolean;
  summary: string;
};

function diffAutoSnapshots(curr: any, prev: any, currCreatedAt: string): AutoChange | null {
  if (!curr || !prev) return null;
  const scoreFrom = Number(prev.score) || 0;
  const scoreTo = Number(curr.score) || 0;
  const scoreDelta = scoreTo - scoreFrom;
  const verdictFrom = String(prev.verdict || '');
  const verdictTo = String(curr.verdict || '');
  const verdictChanged = verdictFrom !== verdictTo;

  const prevFlagTitles = new Set<string>(((prev.flags || []) as any[]).map((f) => String(f?.title || '')).filter(Boolean));
  const currFlagTitles = new Set<string>(((curr.flags || []) as any[]).map((f) => String(f?.title || '')).filter(Boolean));
  const newFlags: string[] = [];
  const removedFlags: string[] = [];
  for (const t of currFlagTitles) if (!prevFlagTitles.has(t)) newFlags.push(t);
  for (const t of prevFlagTitles) if (!currFlagTitles.has(t)) removedFlags.push(t);

  const authorityFrom = prev.authorityStatus ?? null;
  const authorityTo = curr.authorityStatus ?? null;
  const authorityChanged = (authorityFrom || '') !== (authorityTo || '');

  const addressFrom = prev.address ?? null;
  const addressTo = curr.address ?? null;
  const addressChanged = (addressFrom || '').trim().toLowerCase() !== (addressTo || '').trim().toLowerCase();

  const insuranceChanged = (prev.insuranceSummary || '') !== (curr.insuranceSummary || '');
  const outOfServiceChanged = !!prev.outOfService !== !!curr.outOfService;

  const meaningful =
    scoreDelta !== 0 ||
    verdictChanged ||
    newFlags.length > 0 ||
    removedFlags.length > 0 ||
    authorityChanged ||
    addressChanged ||
    insuranceChanged ||
    outOfServiceChanged;
  if (!meaningful) return null;

  // "worse" if the carrier's risk picture deteriorated; "better" if it improved.
  const verdictRank: Record<string, number> = { low: 0, medium: 1, high: 2 };
  const verdictWorse = verdictChanged && (verdictRank[verdictTo] ?? 0) > (verdictRank[verdictFrom] ?? 0);
  const verdictBetter = verdictChanged && (verdictRank[verdictTo] ?? 0) < (verdictRank[verdictFrom] ?? 0);
  const direction: AutoChange['direction'] =
    verdictWorse || scoreDelta > 0 || newFlags.length > 0 || (outOfServiceChanged && curr.outOfService) || (authorityChanged && curr.authorityStatus !== 'Active' && prev.authorityStatus === 'Active')
      ? 'worse'
      : verdictBetter || scoreDelta < 0 || removedFlags.length > 0
        ? 'better'
        : 'neutral';

  // Short human-readable summary for the pulse tooltip + modal banner.
  const parts: string[] = [];
  if (scoreDelta !== 0) parts.push(`Score ${scoreDelta > 0 ? 'up' : 'down'} ${Math.abs(scoreDelta)} (${scoreFrom} → ${scoreTo})`);
  if (verdictChanged) parts.push(`Verdict ${verdictFrom.toUpperCase()} → ${verdictTo.toUpperCase()}`);
  if (newFlags.length > 0) parts.push(`${newFlags.length} new flag${newFlags.length === 1 ? '' : 's'}`);
  if (removedFlags.length > 0) parts.push(`${removedFlags.length} flag${removedFlags.length === 1 ? '' : 's'} resolved`);
  if (authorityChanged) parts.push(`Authority ${authorityFrom || '—'} → ${authorityTo || '—'}`);
  if (addressChanged) parts.push('Address changed');
  if (outOfServiceChanged) parts.push(curr.outOfService ? 'Now out of service' : 'No longer out of service');
  if (insuranceChanged && parts.length === 0) parts.push('Insurance updated');
  const summary = parts.join(' · ') || 'Carrier record updated';

  return {
    at: currCreatedAt,
    direction,
    scoreFrom,
    scoreTo,
    scoreDelta,
    verdictFrom,
    verdictTo,
    verdictChanged,
    newFlags,
    removedFlags,
    authorityChanged,
    authorityFrom,
    authorityTo,
    addressChanged,
    addressFrom,
    addressTo,
    insuranceChanged,
    outOfServiceChanged,
    summary,
  };
}

// Returns the user's own broker report (using user_metadata.mc or .dot).
// Re-runs FMCSA at most once per 24h. Always free of quota — never counts against
// the user's monthly lookup limit. Saves auto-refreshes with source='auto'.
export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const ownMc = (me.user_metadata?.mc || '').trim();
  const ownDot = (me.user_metadata?.dot || '').trim();
  if (!ownMc && !ownDot) return NextResponse.json({ ownMc: null, ownDot: null });

  const queryStr = ownMc ? `MC-${ownMc}` : `DOT-${ownDot}`;
  const matchCol = ownMc ? 'mc' : 'dot';
  const matchVal = ownMc || ownDot;

  // Pull the two most-recent auto rows for this user/MC/DOT — the latest is
  // what we serve, the one before it is what we diff against to flag a change.
  const { data: recentAutos } = await supabase
    .from('lookups')
    .select('*')
    .eq('user_id', me.id)
    .eq(matchCol, matchVal)
    .eq('source', 'auto')
    .order('created_at', { ascending: false })
    .limit(2);
  const latestAuto = recentAutos?.[0] || null;
  const previousAuto = recentAutos?.[1] || null;

  // If the latest auto row is < 24h old, serve it directly. The diff is
  // computed once when the row was inserted (path below) and persisted in
  // `data.autoChange` so subsequent reads stay consistent.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  if (latestAuto && new Date(latestAuto.created_at).toISOString() >= since) {
    return NextResponse.json({
      ownMc: ownMc || null,
      ownDot: ownDot || null,
      report: { ...latestAuto.data, cached: true, cachedAt: latestAuto.created_at },
    });
  }

  // Stale → run a fresh FMCSA lookup. Bypass the plan limit.
  const parsed = parseQuery(queryStr);
  if (!parsed) return NextResponse.json({ ownMc, ownDot, report: null, error: 'Invalid ID' });
  const carrier = await lookupCarrier(parsed);
  if (carrier.address) {
    const ac = await checkAddress(carrier.address, carrier.name);
    if (ac.configured) carrier.addressCheck = ac;
  }
  try {
    const web = await findCarrierWebsite({ name: carrier.name, mc: carrier.mc, dot: carrier.dot });
    if (web.configured) {
      let domainAgeDays: number | null | undefined;
      let hasMx: boolean | undefined;
      let hasSpf: boolean | undefined;
      let socials: { platform: string; url: string }[] | undefined;
      if (web.found && web.domain) {
        const [dc, sc] = await Promise.all([
          checkDomain(web.domain).catch(() => null),
          web.url ? findSocialLinks(web.url).catch(() => []) : Promise.resolve([]),
        ]);
        if (dc) {
          domainAgeDays = dc.whois.ageDays ?? null;
          hasMx = dc.mx.hasMx;
          hasSpf = dc.spf.hasSpf;
        }
        if (sc && sc.length) socials = sc;
      }
      carrier.webPresence = {
        configured: true,
        found: web.found,
        domain: web.domain,
        url: web.url,
        title: web.title,
        snippet: web.snippet,
        nameMatch: web.found && web.domain ? nameMatchesDomain(carrier.name, web.domain) : undefined,
        domainAgeDays,
        hasMx,
        hasSpf,
        socials,
        error: web.error,
      };
    }
  } catch {}
  const scored: any = scoreCarrier(carrier);

  // Compare against the previous auto row (the most-recent one we have).
  // Use `latestAuto` here because we're about to insert a NEW row that
  // becomes the latest — so `latestAuto` IS the prior snapshot for this run.
  const insertedAt = new Date().toISOString();
  const change = diffAutoSnapshots(scored, latestAuto?.data, insertedAt);
  if (change) scored.autoChange = change;

  try {
    await supabase.from('lookups').insert({
      user_id: me.id,
      query: queryStr,
      name: scored.name,
      mc: scored.mc || ownMc || null,
      dot: scored.dot || ownDot || null,
      score: scored.score,
      verdict: scored.verdict,
      source: 'auto',
      data: scored,
      created_at: insertedAt,
    });
  } catch {}

  return NextResponse.json({ ownMc: ownMc || null, ownDot: ownDot || null, report: scored });
}
