// Public stats for the marketing landing page.
// Uses the service-role Supabase client to bypass per-user RLS so we can
// surface ANONYMIZED, AGGREGATE numbers — never user identifiers, MCs are
// redacted in the verdict ticker.
//
// Verdict in the ticker comes straight from the stored row, which was scored
// at lookup time using lib/risk.ts — that rule set already differentiates
// pure brokers from carriers (different liability/OOS/crash rules apply), so
// the verdict is entity-aware by construction. We just decorate the row with
// a BROKER / CARRIER / BROKER+CARRIER label using the same logic the report
// page uses (entityBadge in components/Haulock.tsx).

import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { fetchFlaggedCarriers } from '@/lib/fmcsa-enforcement';

export const runtime = 'nodejs';
// Cache for 5 minutes — landing page traffic shouldn't hammer Supabase, but
// the numbers should feel "live" enough to nudge conversions.
export const revalidate = 300;

type EntityKind = 'BROKER' | 'CARRIER' | 'BROKER+CARRIER' | 'NO AUTHORITY';

function entityKindFromData(d: any): EntityKind {
  const isCarrier = d?.commonAuthority === 'Active' || d?.contractAuthority === 'Active';
  const isBroker = d?.brokerAuthority === 'Active';
  if (isCarrier && isBroker) return 'BROKER+CARRIER';
  if (isBroker) return 'BROKER';
  if (isCarrier) return 'CARRIER';
  return 'NO AUTHORITY';
}

function redactId(id: string | null | undefined): string | null {
  if (!id) return null;
  const s = String(id);
  if (s.length <= 3) return '•••';
  return s.slice(0, s.length - 3) + '•••';
}

export async function GET() {
  const svc = getServiceSupabase();

  // Run all queries in parallel — landing-page latency matters.
  const [verifyCount, fraudCount, recentLookups, riskyLookups, fmcsaFlags] = await Promise.all([
    svc ? svc.from('lookups').select('id', { count: 'exact', head: true }) : Promise.resolve({ count: 0 } as any),
    svc ? svc.from('fraud_reports').select('id', { count: 'exact', head: true }) : Promise.resolve({ count: 0 } as any),
    // 12 most recent lookups with a verdict — used for the live MC ticker.
    svc
      ? svc
          .from('lookups')
          .select('mc,dot,verdict,data,created_at')
          .not('verdict', 'is', null)
          .order('created_at', { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [] } as any),
    // Most recent HIGH or MEDIUM risk lookup — used as the "featured scan"
    // hero card. Prefer high; fall back to medium so the card is rarely empty.
    svc
      ? svc
          .from('lookups')
          .select('mc,dot,name,score,verdict,data,created_at')
          .in('verdict', ['high', 'medium'])
          .order('created_at', { ascending: false })
          .limit(1)
      : Promise.resolve({ data: [] } as any),
    // FMCSA enforcement flags — count of currently-active enforcement signals.
    fetchFlaggedCarriers(300).catch(() => [] as any[]),
  ]);

  const ticker = ((recentLookups as any)?.data || [])
    .map((row: any) => {
      const id = row.mc ? `MC-${row.mc}` : row.dot ? `DOT-${row.dot}` : null;
      if (!id) return null;
      // Apply the same redaction the marketing mockup uses, so a real MC
      // doesn't leak into the public ticker.
      const redacted = row.mc ? `MC-${redactId(row.mc)}` : `DOT-${redactId(row.dot)}`;
      const verdict = (row.verdict || 'low').toLowerCase();
      const verdictLabel =
        verdict === 'high' ? 'HIGH RISK'
        : verdict === 'medium' ? 'CAUTION'
        : 'VERIFIED';
      const verdictColor =
        verdict === 'high' ? '#DC2626'
        : verdict === 'medium' ? '#F59E0B'
        : '#16A34A';
      return {
        id: redacted,
        verdict: verdictLabel,
        color: verdictColor,
        entity: entityKindFromData(row.data),
      };
    })
    .filter(Boolean);

  // Featured scan — anonymized real lookup for the hero "broker lookup" card.
  // Uses the verdict the row was scored with at lookup time (lib/risk.ts
  // already differentiated broker vs carrier rules), so the visual class
  // (HIGH RISK / CAUTION) matches what the dashboard would show.
  const featuredRow = ((riskyLookups as any)?.data || [])[0];
  let featuredScan: any = null;
  if (featuredRow) {
    const data = featuredRow.data || {};
    const flagsRaw: any[] = Array.isArray(data.flags) ? data.flags : [];
    // Severity ordering: critical > warning > info — surface the most serious
    // flags first so the card teaches what the product catches.
    const sevRank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    const topFlags = [...flagsRaw]
      .sort((a, b) => (sevRank[a.sev] ?? 9) - (sevRank[b.sev] ?? 9))
      .slice(0, 4)
      .map((f) => ({
        sev: f.sev || 'warning',
        title: f.title || 'Risk signal',
        desc: typeof f.desc === 'string' ? f.desc.slice(0, 120) : undefined,
        pts: typeof f.pts === 'number' ? f.pts : undefined,
      }));

    featuredScan = {
      name: featuredRow.name || data.name || 'Carrier',
      mc: featuredRow.mc ? `MC-${redactId(featuredRow.mc)}` : null,
      dot: featuredRow.dot ? `DOT-${redactId(featuredRow.dot)}` : null,
      score: featuredRow.score ?? data.score ?? 0,
      verdict: featuredRow.verdict || 'low',
      entity: entityKindFromData(data),
      flagCount: flagsRaw.length,
      flags: topFlags,
      scannedAt: featuredRow.created_at,
    };
  }

  return NextResponse.json(
    {
      stats: {
        totalVerifications: (verifyCount as any)?.count || 0,
        totalFraudReports: (fraudCount as any)?.count || 0,
        activeFmcsaFlags: (fmcsaFlags as any[]).length,
      },
      ticker,
      featuredScan,
      fetchedAt: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=300',
      },
    },
  );
}
