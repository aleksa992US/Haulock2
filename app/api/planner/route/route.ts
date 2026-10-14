import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { resolveTeamContext } from '@/lib/teams';
import { isAdmin } from '@/lib/admin';
import { dieselPrices, geocode, OutsideUsError, regionForState, routeBetween, type PlannerPoint } from '@/lib/load-planner';
import { nearestUsCity, US_STATES } from '@/lib/us-places';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type StopIn = string | { lat: number; lng: number; label?: string; state?: string } | null | undefined;

// Fair use of the shared, free routers: after BURST_MAX plans within
// BURST_WINDOW, each further plan waits COOLDOWN after the previous one.
const BURST_MAX = 8;
const BURST_WINDOW_MS = 5 * 60_000;
const COOLDOWN_MS = 30_000;
// A load is pickup → delivery; re-planning it within a day (new truck
// location, edits) doesn't count toward the monthly plan limit again.
const SAME_LOAD_MS = 24 * 60 * 60_000;

// Per-user counters live in app_metadata.planner (server-only):
//   m: 'YYYY-MM', n: new loads planned that month, l: { loadKey: lastAt }, t: recent plan times
type PlannerMeta = { m?: string; n?: number; l?: Record<string, number>; t?: number[] };

const localBurst = new Map<string, number[]>(); // local demo mode only

function cooldownLeft(times: number[], now: number): number {
  const recentTimes = times.filter((t) => now - t < BURST_WINDOW_MS);
  if (recentTimes.length < BURST_MAX) return 0;
  const last = Math.max(...recentTimes);
  return Math.max(0, COOLDOWN_MS - (now - last));
}

function loadKeyOf(pickup: StopIn, delivery: StopIn): string {
  const k = (v: StopIn) => (v && typeof v === 'object' ? `${Number(v.lat).toFixed(2)},${Number(v.lng).toFixed(2)}` : String(v || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  return createHash('sha1').update(`${k(pickup)}>${k(delivery)}`).digest('hex').slice(0, 10);
}

async function resolve(stop: StopIn, name: string): Promise<PlannerPoint> {
  if (stop && typeof stop === 'object' && isFinite(stop.lat) && isFinite(stop.lng)) {
    // A picked suggestion carries its state; a device location doesn't, so
    // it's matched to the nearest US city (and refused outside the US).
    const st = String(stop.state || '').toUpperCase();
    if (US_STATES.has(st)) return { lat: stop.lat, lng: stop.lng, label: String(stop.label || 'Selected place').slice(0, 120), state: st };
    const near = nearestUsCity(stop.lat, stop.lng);
    if (!near) throw new Error(`The ${name} is outside the US. Haulock plans US loads only.`);
    return { lat: stop.lat, lng: stop.lng, label: `Near ${near.label}`, state: near.state };
  }
  const q = typeof stop === 'string' ? stop.trim() : '';
  if (!q) throw new Error(`Enter the ${name}.`);
  let p: PlannerPoint | null;
  try {
    p = await geocode(q);
  } catch (e) {
    if (e instanceof OutsideUsError) throw new Error(`The ${name} “${q}” is outside the US. Haulock plans US loads only.`);
    throw e;
  }
  if (!p) throw new Error(`We couldn’t find the ${name} “${q}” in the US. Pick a city from the list, or enter a ZIP or a full US address.`);
  return p;
}

// POST { origin?, pickup, delivery } → points, miles and hours per leg, the
// route line, and this week's diesel prices.
export async function POST(req: Request) {
  const supabase = getServerSupabase();
  // Local demo mode (no Supabase, not production) skips sign-in so the
  // planner can be tried on localhost.
  let user: any = null;
  if (supabase) {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    user = userData.user;
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const b = await req.json().catch(() => null) as { origin?: StopIn; pickup?: StopIn; delivery?: StopIn } | null;
  if (!b) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  // ---- limits ----
  const now = Date.now();
  const month = new Date().toISOString().slice(0, 7);
  const admin = user ? await isAdmin(user.email) : false;
  const limit = user && !admin ? (await resolveTeamContext(user.id, user.user_metadata?.plan)).effectivePlan.limits.loadPlans : null;
  const meta: PlannerMeta = (user?.app_metadata?.planner as PlannerMeta) || {};
  const times = user ? (meta.t || []) : (localBurst.get('local') || []);
  const plansUsed = meta.m === month ? meta.n || 0 : 0;
  const loads: Record<string, number> = {};
  for (const [k, at] of Object.entries(meta.l || {})) if (now - at < SAME_LOAD_MS) loads[k] = at;
  const loadKey = loadKeyOf(b.pickup, b.delivery);
  const isNewLoad = !(loadKey in loads);
  if (!admin) {
    const wait = cooldownLeft(times, now);
    if (wait > 0) {
      const secs = Math.ceil(wait / 1000);
      return NextResponse.json({ error: `You’ve planned a lot in the last few minutes. Wait ${secs} seconds so everyone gets fast routes.`, code: 'cooldown', retryAfter: secs }, { status: 429, headers: { 'Retry-After': String(secs) } });
    }
    if (limit != null && isNewLoad && plansUsed >= limit) {
      return NextResponse.json({ error: `You’ve planned ${limit} loads this month on the Free plan. Upgrade for unlimited load planning, or plan again next month.`, code: 'limit_reached', limit, used: plansUsed }, { status: 402 });
    }
  }

  let points: PlannerPoint[];
  const hasOrigin = Boolean(b.origin && (typeof b.origin !== 'string' || b.origin.trim()));
  try {
    const [origin, pickup, delivery] = await Promise.all([
      hasOrigin ? resolve(b.origin, 'driver’s location') : Promise.resolve(null),
      resolve(b.pickup, 'pickup'),
      resolve(b.delivery, 'delivery'),
    ]);
    points = [origin, pickup, delivery].filter(Boolean) as PlannerPoint[];
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Couldn’t find one of the places.' }, { status: 400 });
  }

  const [route, diesel] = await Promise.all([
    routeBetween(points),
    dieselPrices().catch(() => null),
  ]);

  // Record this plan (counts a new load once per 24 hours).
  const nextTimes = [...times.filter((t) => now - t < BURST_WINDOW_MS), now].slice(-12);
  const usedNow = isNewLoad ? plansUsed + 1 : plansUsed;
  if (user) {
    const svc = getServiceSupabase();
    if (svc) {
      const nextLoads = { ...loads, [loadKey]: now };
      const keep = Object.entries(nextLoads).sort((x, y) => y[1] - x[1]).slice(0, 40);
      // Merge into the freshest app_metadata so other server-set fields
      // (company verification, …) are never overwritten.
      const { data: fresh } = await svc.auth.admin.getUserById(user.id);
      const base = (fresh?.user?.app_metadata as any) || user.app_metadata || {};
      await svc.auth.admin.updateUserById(user.id, {
        app_metadata: { ...base, planner: { m: month, n: usedNow, l: Object.fromEntries(keep), t: nextTimes } },
      }).catch(() => null);
    }
  } else {
    localBurst.set('local', nextTimes);
  }
  const pickupPt = points[hasOrigin ? 1 : 0];
  const deliveryPt = points[hasOrigin ? 2 : 1];
  // Fuel is bought along the way: average the pickup and delivery regions.
  const regions = Array.from(new Set([regionForState(pickupPt.state), regionForState(deliveryPt.state)]));
  const used = diesel ? regions.map((r) => diesel[r] || diesel['U.S.']).filter(Boolean) : [];
  const suggested = used.length
    ? { price: Math.round((used.reduce((s, d) => s + d.price, 0) / used.length) * 1000) / 1000, regions: used.map((d) => d.region), week: used[0].week, source: used[0].source }
    : null;

  return NextResponse.json({
    ...route,
    hasOrigin,
    diesel: suggested,
    dieselByRegion: diesel,
    usage: { used: usedNow, limit, newLoad: isNewLoad },
  });
}
