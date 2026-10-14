import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { checkSimpleRateLimit } from '@/lib/rate-limit';
import { suggestCompanies, type SuggestKind } from '@/lib/company-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Type-ahead suggestions from FMCSA's public registry while the user types
// an MC, DOT or company name. Signed-in users only; free (no lookup credit)
// and rate-limited per user. Picking a suggestion runs the real /api/verify.
export async function GET(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ suggestions: [] });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const rl = checkSimpleRateLimit({ bucket: 'search-suggest', identity: user.id, max: 120, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ suggestions: [], rateLimited: true }, { status: 429 });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').slice(0, 80);
  const kindParam = searchParams.get('kind');
  const kind: SuggestKind = kindParam === 'mc' || kindParam === 'dot' || kindParam === 'name' ? kindParam : 'auto';
  try {
    const suggestions = await suggestCompanies(q, kind);
    return NextResponse.json({ suggestions }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (e: any) {
    // Suggestions are a convenience — a registry hiccup just shows none.
    return NextResponse.json({ suggestions: [], error: e?.name === 'AbortError' ? 'timeout' : 'unavailable' });
  }
}
