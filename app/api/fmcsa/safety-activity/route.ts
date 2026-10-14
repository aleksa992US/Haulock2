import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { fetchSafetyActivity } from '@/lib/fmcsa-inspections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET ?dot=123 → roadside inspections and crashes for the last 24 months
// (public FMCSA data; signed-in users only, to keep it from being scraped
// through us).
export async function GET(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const dot = new URL(req.url).searchParams.get('dot')?.replace(/\D/g, '') || '';
  if (!dot || dot.length > 9) return NextResponse.json({ error: 'A USDOT number is required' }, { status: 400 });
  try {
    const activity = await fetchSafetyActivity(dot);
    if (!activity) return NextResponse.json({ error: 'Invalid USDOT number' }, { status: 400 });
    return NextResponse.json(activity, { headers: { 'Cache-Control': 'private, max-age=1800' } });
  } catch (e: any) {
    console.warn('[safety-activity] fetch failed', { dot, error: e?.message });
    return NextResponse.json({ error: 'FMCSA’s inspection records didn’t respond. Try again in a minute.' }, { status: 503 });
  }
}
