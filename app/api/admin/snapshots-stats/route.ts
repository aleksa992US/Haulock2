import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Returns a daily breakdown of carrier_snapshots writes for the past 30
// days, plus aggregate totals. Powers the "History data growth" panel on
// the admin page so the operator can watch the dataset compound.
export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const now = Date.now();
  const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const since7d  = new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString();

  // We only need light aggregates plus the recent rows for daily bucketing.
  // Pull captured_at + dot/mc + source for the last 30 days; bucket in JS.
  const [allTimeCount, last24hCount, last7dCount, last30dRows, distinctRecent] = await Promise.all([
    svc.from('carrier_snapshots').select('id', { count: 'exact', head: true }),
    svc.from('carrier_snapshots').select('id', { count: 'exact', head: true }).gte('captured_at', since24h),
    svc.from('carrier_snapshots').select('id', { count: 'exact', head: true }).gte('captured_at', since7d),
    svc.from('carrier_snapshots')
      .select('captured_at,dot,mc,source,changed_fields,name,id')
      .gte('captured_at', since30d)
      .order('captured_at', { ascending: false })
      .limit(5000),
    // Distinct carriers in the past 7d — separate query so we don't load
    // every snapshot just to count uniques.
    svc.from('carrier_snapshots')
      .select('dot,mc')
      .gte('captured_at', since7d)
      .limit(5000),
  ]);

  // Day bucketing in YYYY-MM-DD. Local UTC bucket — keeps the chart aligned
  // across server / browser time-zone differences.
  const rows = (last30dRows.data || []) as Array<{ captured_at: string; source: string; changed_fields: string[]; dot: string | null; mc: string | null }>;
  const bucketMap = new Map<string, { total: number; lookup: number; bulk: number; initial: number; updates: number }>();
  // Pre-seed all 30 days so empty days render as zero (chart looks honest).
  for (let i = 0; i < 30; i++) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    bucketMap.set(key, { total: 0, lookup: 0, bulk: 0, initial: 0, updates: 0 });
  }
  for (const r of rows) {
    const key = r.captured_at.slice(0, 10);
    const cur = bucketMap.get(key) || { total: 0, lookup: 0, bulk: 0, initial: 0, updates: 0 };
    cur.total += 1;
    if (r.source === 'bulk') cur.bulk += 1; else cur.lookup += 1;
    if (Array.isArray(r.changed_fields) && r.changed_fields.includes('initial')) cur.initial += 1;
    else cur.updates += 1;
    bucketMap.set(key, cur);
  }
  // Convert to an ordered array, oldest-first, for chart-friendly rendering.
  const daily = Array.from(bucketMap.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, v]) => ({ date, ...v }));

  // Distinct-carrier count: dedupe by DOT (preferred) or MC.
  const distinctSet = new Set<string>();
  for (const r of (distinctRecent.data || []) as Array<{ dot: string | null; mc: string | null }>) {
    if (r.dot) distinctSet.add(`d:${r.dot}`);
    else if (r.mc) distinctSet.add(`m:${r.mc}`);
  }

  // Most-recent 8 rows for an "activity feed" preview on the panel.
  const recentSample = rows.slice(0, 8).map((r: any) => ({
    name: r.name,
    dot: r.dot,
    mc: r.mc,
    capturedAt: r.captured_at,
    changedFields: r.changed_fields,
    source: r.source,
  }));

  // 7-day momentum: this-week count vs prior-week count.
  const since14d = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { count: priorWeekCount } = await svc
    .from('carrier_snapshots')
    .select('id', { count: 'exact', head: true })
    .gte('captured_at', since14d)
    .lt('captured_at', since7d);

  return NextResponse.json({
    totals: {
      allTime: allTimeCount.count ?? 0,
      last24h: last24hCount.count ?? 0,
      last7d: last7dCount.count ?? 0,
      priorWeek: priorWeekCount ?? 0,
      distinctCarriersLast7d: distinctSet.size,
    },
    daily,
    recent: recentSample,
    fetchedAt: new Date().toISOString(),
  });
}
