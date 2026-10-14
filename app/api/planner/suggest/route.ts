import { NextResponse } from 'next/server';
import { suggestUsPlaces } from '@/lib/us-places';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?q=jol → US cities and ZIP codes for the load planner's type-ahead.
// Served from our own GeoNames list: no API key, no quota.
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') || '').slice(0, 80);
  const places = suggestUsPlaces(q, 8);
  return NextResponse.json({ places }, { headers: { 'Cache-Control': 'public, max-age=86400' } });
}
