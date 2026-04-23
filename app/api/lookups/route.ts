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
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  // Soft-delete: hide from history UI but keep the row so monthly usage
  // stays accurate. Quota is not refunded.
  const { error } = await supabase
    .from('lookups')
    .update({ hidden_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
