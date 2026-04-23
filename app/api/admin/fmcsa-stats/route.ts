import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const countBetween = async (since: string, extra?: { status?: string; http_status?: number }) => {
    let q = svc.from('fmcsa_events').select('id', { count: 'exact', head: true }).gte('created_at', since);
    if (extra?.status) q = q.eq('status', extra.status);
    if (extra?.http_status != null) q = q.eq('http_status', extra.http_status);
    const { count } = await q;
    return count ?? 0;
  };

  const [
    hourTotal,
    hourErrors,
    dayTotal,
    dayOk,
    dayErrors,
    dayThrottled,
    weekTotal,
    recent,
    durationSample,
  ] = await Promise.all([
    countBetween(hourAgo),
    countBetween(hourAgo, { status: 'error' }),
    countBetween(dayAgo),
    countBetween(dayAgo, { status: 'ok' }),
    countBetween(dayAgo, { status: 'error' }),
    countBetween(dayAgo, { http_status: 429 }),
    countBetween(weekAgo),
    svc.from('fmcsa_events').select('path,status,http_status,duration_ms,error,created_at').order('created_at', { ascending: false }).limit(10),
    svc.from('fmcsa_events').select('duration_ms').gte('created_at', dayAgo).not('duration_ms', 'is', null).limit(500),
  ]);

  const durations = (durationSample.data || []).map((r: any) => r.duration_ms).filter((n: any) => typeof n === 'number');
  const avgDurationMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  // Cache hit rate derivation: compare FMCSA-hitting events to lookup rows inserted.
  // Rows in `lookups` inserted over the same window include both cache-hit and FMCSA-hit requests,
  // so: cache_hit_rate ≈ 1 - (fmcsa_hits / lookups_inserted).
  let cacheHitRate: number | null = null;
  {
    const { count: lookupsDay } = await svc
      .from('lookups')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', dayAgo);
    if (lookupsDay != null && lookupsDay > 0 && dayTotal <= lookupsDay) {
      cacheHitRate = 1 - dayTotal / lookupsDay;
    }
  }

  return NextResponse.json({
    window: {
      hour: { total: hourTotal, errors: hourErrors },
      day: { total: dayTotal, ok: dayOk, errors: dayErrors, throttled429: dayThrottled, avgDurationMs, cacheHitRate },
      week: { total: weekTotal },
    },
    recent: recent.data || [],
    fetchedAt: new Date().toISOString(),
  });
}
