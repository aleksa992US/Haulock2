import { NextResponse } from 'next/server';
import { fetchFlaggedCarriers } from '@/lib/fmcsa-enforcement';

export const runtime = 'nodejs';
// Refresh once a day — FMCSA's Socrata source itself only updates ~daily,
// so a 24-hour cache matches upstream cadence and removes pressure from
// Socrata rate limits.
const ONE_DAY = 86_400;
export const revalidate = ONE_DAY;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = clamp(Number(searchParams.get('limit')) || 100, 1, 500);

  try {
    const actions = await fetchFlaggedCarriers(limit);
    return NextResponse.json(
      { actions, fetchedAt: new Date().toISOString(), count: actions.length },
      {
        headers: {
          // CDN caches for 24h; while revalidating in background, serve
          // stale for another 24h — guarantees the page never goes blank
          // even if Socrata is briefly down.
          'Cache-Control': `public, max-age=0, s-maxage=${ONE_DAY}, stale-while-revalidate=${ONE_DAY}`,
        },
      },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to fetch enforcement actions', actions: [] },
      { status: 200 }, // 200 with empty actions so the UI renders an honest empty state instead of getting stuck on "Loading…"
    );
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
