import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { lookupCarrier, parseQuery } from '@/lib/fmcsa';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // cache-warming may take a while

export async function POST(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null) as { identifiers?: string[] } | null;
  const list = Array.isArray(body?.identifiers) ? body!.identifiers : [];
  if (!list.length) return NextResponse.json({ error: 'Provide `identifiers`: an array of MC/DOT values.' }, { status: 400 });

  // Clamp so a single request can't run forever.
  const toProcess = list.slice(0, 200);

  const results = {
    requested: toProcess.length,
    succeeded: 0,
    failed: 0,
    alreadyCached: 0,
    errors: [] as { identifier: string; error: string }[],
  };

  // Process serially to avoid hammering FMCSA (each lookupCarrier call already
  // has retries + in-flight dedup built in).
  for (const raw of toProcess) {
    const parsed = parseQuery(String(raw));
    if (!parsed) {
      results.failed += 1;
      results.errors.push({ identifier: String(raw), error: 'Unparseable identifier' });
      continue;
    }
    try {
      await lookupCarrier(parsed);
      results.succeeded += 1;
    } catch (err: any) {
      results.failed += 1;
      results.errors.push({
        identifier: String(raw),
        error: err?.message?.slice(0, 200) || 'unknown error',
      });
    }
  }

  return NextResponse.json(results);
}

export async function GET() {
  // Cache stats for the admin UI.
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const now = Date.now();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ count: total }, { count: stale }, { data: oldest }, { data: newest }] = await Promise.all([
    svc.from('fmcsa_cache').select('cache_key', { count: 'exact', head: true }),
    svc.from('fmcsa_cache').select('cache_key', { count: 'exact', head: true }).lt('cached_at', thirtyDaysAgo),
    svc.from('fmcsa_cache').select('cached_at').order('cached_at', { ascending: true }).limit(1),
    svc.from('fmcsa_cache').select('cached_at').order('cached_at', { ascending: false }).limit(1),
  ]);

  return NextResponse.json({
    total: total ?? 0,
    staleOver30Days: stale ?? 0,
    oldest: oldest?.[0]?.cached_at ?? null,
    newest: newest?.[0]?.cached_at ?? null,
  });
}
