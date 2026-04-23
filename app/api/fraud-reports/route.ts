import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = ['non_payment', 'double_broker', 'identity_fraud', 'fake_load', 'other'];

export async function GET(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const mc = searchParams.get('mc');
  const dot = searchParams.get('dot');
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);

  let query = supabase
    .from('fraud_reports')
    .select('id, mc, dot, name, type, amount, description, created_at, reporter_user_id')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (mc || dot) {
    const ors: string[] = [];
    if (mc) ors.push(`mc.eq.${mc}`);
    if (dot) ors.push(`dot.eq.${dot}`);
    query = query.or(ors.join(','));
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Anonymize reporter — never leak user_ids to other users.
  const reports = (data || []).map((r: any) => {
    const { reporter_user_id, ...rest } = r;
    return { ...rest, mine: reporter_user_id === user.id };
  });
  return NextResponse.json({ reports });
}

export async function POST(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => null) as any;
  if (!body || typeof body.name !== 'string' || (!body.mc && !body.dot)) {
    return NextResponse.json({ error: 'Need at least a name and an MC or DOT' }, { status: 400 });
  }
  const type = ALLOWED_TYPES.includes(body.type) ? body.type : 'other';
  const amount = body.amount != null && body.amount !== '' ? Number(body.amount) : null;
  if (amount != null && (isNaN(amount) || amount < 0)) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
  }

  const row = {
    reporter_user_id: user.id,
    mc: body.mc || null,
    dot: body.dot || null,
    name: String(body.name).slice(0, 200),
    type,
    amount,
    description: body.description ? String(body.description).slice(0, 2000) : null,
  };

  const { data, error } = await supabase.from('fraud_reports').insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ report: data });
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
  const { error } = await supabase.from('fraud_reports').delete().eq('id', id).eq('reporter_user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
