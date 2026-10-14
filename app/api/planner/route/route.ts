import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { dieselPrices, geocode, OutsideUsError, regionForState, routeBetween, type PlannerPoint } from '@/lib/load-planner';
import { nearestUsCity, US_STATES } from '@/lib/us-places';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type StopIn = string | { lat: number; lng: number; label?: string; state?: string } | null | undefined;

// A few plans a minute per user keeps the free routing/geocoding quotas
// (shared by every customer) from being drained by one tab.
const recent = new Map<string, number[]>();
function limited(userId: string): boolean {
  const now = Date.now();
  const list = (recent.get(userId) || []).filter((t) => now - t < 60_000);
  list.push(now);
  recent.set(userId, list);
  return list.length > 12;
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
  let userId = 'local-demo';
  if (supabase) {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    userId = userData.user.id;
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }
  if (limited(userId)) return NextResponse.json({ error: 'Too many plans in a minute. Wait a moment and try again.' }, { status: 429 });

  const b = await req.json().catch(() => null) as { origin?: StopIn; pickup?: StopIn; delivery?: StopIn } | null;
  if (!b) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

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
  });
}
