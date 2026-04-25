import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);
  const verdict = searchParams.get('verdict');
  const since = searchParams.get('since');

  let query = supabase
    .from('lookups')
    .select('*')
    .eq('user_id', user.id)
    .neq('source', 'auto')
    .is('hidden_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (verdict) query = query.eq('verdict', verdict);
  if (since) query = query.gte('created_at', since);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lookups: data || [] });
}

export async function POST(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => null) as any;
  if (!body || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const row = {
    user_id: user.id,
    query: String(body.query || ''),
    name: body.name,
    mc: body.mc || null,
    dot: body.dot || null,
    score: typeof body.score === 'number' ? body.score : 0,
    verdict: body.verdict || 'low',
    email_query: body.queriedEmail || null,
    source: body.source === 'ratecon' ? 'ratecon' : 'quick',
    data: body,
  };

  const { data, error } = await supabase.from('lookups').insert(row).select().single();
  if (error) {
    console.error('[api/lookups POST] Supabase insert failed:', { code: error.code, message: error.message, details: error.details, hint: error.hint });
    return NextResponse.json({ error: error.message, code: error.code, details: error.details, hint: error.hint }, { status: 500 });
  }
  return NextResponse.json({ lookup: data });
}

export async function DELETE(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const idsParam = searchParams.get('ids');
  const all = searchParams.get('all') === '1';

  // Soft-delete only — hide from history UI but keep the row so monthly
  // usage stays accurate. Quota is not refunded either way.
  if (all) {
    const verdicts = (searchParams.get('verdicts') || '').split(',').map((v) => v.trim()).filter(Boolean);
    const sinceDays = Number(searchParams.get('sinceDays')) || 0;

    let q = supabase
      .from('lookups')
      .update({ hidden_at: new Date().toISOString() }, { count: 'exact' })
      .eq('user_id', user.id)
      .is('hidden_at', null);
    if (verdicts.length > 0) q = q.in('verdict', verdicts);
    if (sinceDays > 0) {
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
      q = q.gte('created_at', since);
    }

    const { count, error } = await q;
    if (error) {
      console.error('[api/lookups DELETE all] Supabase update failed:', { code: error.code, message: error.message, details: error.details, hint: error.hint });
      return NextResponse.json({ error: error.message, code: error.code, hint: error.hint }, { status: 500 });
    }
    return NextResponse.json({ ok: true, deleted: count ?? 0 });
  }

  // Bulk delete by explicit IDs — used when the History UI wants to remove
  // every row in a grouped carrier (multiple lookups, one carrier).
  if (idsParam) {
    const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return NextResponse.json({ error: 'Missing ids' }, { status: 400 });
    const { count, error } = await supabase
      .from('lookups')
      .update({ hidden_at: new Date().toISOString() }, { count: 'exact' })
      .in('id', ids)
      .eq('user_id', user.id);
    if (error) {
      console.error('[api/lookups DELETE ids] Supabase update failed:', { code: error.code, message: error.message, details: error.details, hint: error.hint, ids });
      return NextResponse.json({ error: error.message, code: error.code, hint: error.hint }, { status: 500 });
    }
    return NextResponse.json({ ok: true, deleted: count ?? 0 });
  }

  if (!id) return NextResponse.json({ error: 'Missing id (or pass ?ids=… / ?all=1)' }, { status: 400 });

  const { error } = await supabase
    .from('lookups')
    .update({ hidden_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    console.error('[api/lookups DELETE id] Supabase update failed:', { code: error.code, message: error.message, details: error.details, hint: error.hint, id });
    return NextResponse.json({ error: error.message, code: error.code, hint: error.hint }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
