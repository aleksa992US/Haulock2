import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/admin';
import { resolveTeamContext } from '@/lib/teams';
import { getServiceSupabase } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data, error } = await supabase
    .from('watchlist')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ watchlist: data || [] });
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

  const ctx = await resolveTeamContext(user.id, user.user_metadata?.plan);
  const plan = ctx.effectivePlan;
  const cap = plan.limits.watchlist;
  if (cap != null && !(await isAdmin(user.email))) {
    let countableIds: string[] = [user.id];
    if (ctx.team) {
      const svc2 = getServiceSupabase();
      if (svc2) {
        const { data: members } = await svc2.from('team_members').select('user_id').eq('team_id', ctx.team.id);
        countableIds = (members || []).map((m: any) => m.user_id);
      }
    }
    const { count } = await supabase
      .from('watchlist')
      .select('id', { count: 'exact', head: true })
      .in('user_id', countableIds);
    // Allow re-upserting an existing entry even if at cap; only block NEW entries.
    const { data: existing } = await supabase
      .from('watchlist')
      .select('id')
      .eq('user_id', user.id)
      .eq('mc', body.mc || null)
      .eq('dot', body.dot || null)
      .maybeSingle();
    if (!existing && (count ?? 0) >= cap) {
      return NextResponse.json({
        error: `You've hit the ${cap}-broker watchlist limit on the ${plan.label} plan. Upgrade for more.`,
        code: 'limit_reached',
        limit: cap,
        used: count ?? 0,
      }, { status: 402 });
    }
  }

  const row = {
    user_id: user.id,
    mc: body.mc || null,
    dot: body.dot || null,
    name: body.name,
    last_score: typeof body.score === 'number' ? body.score : null,
    last_verdict: body.verdict || null,
    last_checked: new Date().toISOString(),
    data: body,
  };

  const { data, error } = await supabase
    .from('watchlist')
    .upsert(row, { onConflict: 'user_id,mc,dot' })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
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

  const { error } = await supabase.from('watchlist').delete().eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
