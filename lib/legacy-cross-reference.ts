// Cross-references built from the imported partner-2021 reference dataset.
//
// LEGAL POSTURE
// We never claim a carrier "is" anything based on this data. We surface
// FMCSA-derived identifiers shared between carriers as starting points for
// investigation. Cited as "Nov 2021 third-party reference data" — never
// attributed to the original partner.
//
// What we surface:
//   1. The carrier's own 2021 third-party rating (verbatim, neutral).
//   2. OTHER FMCSA-registered carriers in our 2021 reference set that
//      shared this carrier's email address — with a clear disclaimer that
//      sharing can be legitimate.

import type { CarrierReport } from './fmcsa';

export type LegacyRating = {
  riskOverall: string | null;
  trucksTotal: number | null;
  capturedAt: string;     // ISO date
  source: string;         // generic label, never names the partner
};

export type LegacyEmailMatch = {
  email: string;
  otherCarrier: { name: string | null; mc: string | null; dot: string | null };
  capturedAt: string;
};

export type LegacyCrossReference = {
  rating: LegacyRating | null;
  emailMatches: LegacyEmailMatch[];
};

export async function findLegacyCrossReferences(c: CarrierReport): Promise<LegacyCrossReference> {
  const result: LegacyCrossReference = { rating: null, emailMatches: [] };
  if (!c.dot && !c.mc) return result;

  const { getServiceSupabase } = await import('./supabase/service');
  const svc = getServiceSupabase();
  if (!svc) return result;

  // 1. Look up THIS carrier's 2021 rating. Match preferably by DOT (more
  //    stable identifier), fall back to MC.
  let ratingQuery = svc
    .from('legacy_risk_ratings')
    .select('risk_overall,trucks_total,captured_at,source')
    .order('captured_at', { ascending: false })
    .limit(1);
  if (c.dot) ratingQuery = ratingQuery.eq('dot', c.dot);
  else if (c.mc) ratingQuery = ratingQuery.eq('mc', c.mc);

  const { data: ratingRow } = await ratingQuery.maybeSingle();
  if (ratingRow) {
    result.rating = {
      riskOverall: ratingRow.risk_overall,
      trucksTotal: ratingRow.trucks_total,
      capturedAt: ratingRow.captured_at,
      source: ratingRow.source,
    };
  }

  // 2. Look up the carrier's email from the legacy snapshot table, then
  //    find OTHER 2021-source rows that used the same email. The data is
  //    keyed in carrier_snapshots.data.emailFull (added by the legacy
  //    importer). We deliberately constrain this lookup to legacy data
  //    only — we don't want to lump live FMCSA-derived shares with the
  //    partner-supplied email pool.
  const myEmail = await fetchSelfLegacyEmail(svc, c);
  if (myEmail) {
    const { data: matches } = await svc
      .from('carrier_snapshots')
      .select('dot,mc,name,data,captured_at')
      .eq('source', 'partner-2021')
      .filter('data->>emailFull', 'ilike', myEmail)
      .limit(15);

    for (const row of matches || []) {
      // Skip the carrier looking itself up.
      if (row.dot && c.dot && row.dot === c.dot) continue;
      if (row.mc && c.mc && row.mc === c.mc) continue;
      // Defensive: ensure this row's email actually equals (case-insensitive).
      const rowEmail = String((row as any).data?.emailFull || '').toLowerCase();
      if (rowEmail !== myEmail.toLowerCase()) continue;
      result.emailMatches.push({
        email: myEmail,
        otherCarrier: {
          name: row.name ?? (row as any).data?.name ?? null,
          mc: row.mc ?? null,
          dot: row.dot ?? null,
        },
        capturedAt: row.captured_at,
      });
    }
  }

  return result;
}

// Pull the carrier's own legacy email out of carrier_snapshots so we have
// a needle to match against. The legacy importer puts the original email
// on the row's `data.emailFull` field.
async function fetchSelfLegacyEmail(svc: any, c: CarrierReport): Promise<string | null> {
  let q = svc
    .from('carrier_snapshots')
    .select('data')
    .eq('source', 'partner-2021')
    .order('captured_at', { ascending: false })
    .limit(1);
  if (c.dot) q = q.eq('dot', c.dot);
  else if (c.mc) q = q.eq('mc', c.mc);
  const { data } = await q.maybeSingle();
  const email: string | null = data?.data?.emailFull ?? null;
  if (!email) return null;
  return String(email).trim().toLowerCase() || null;
}
