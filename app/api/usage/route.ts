import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { monthStart } from '@/lib/plans';
import { isAdmin } from '@/lib/admin';
import { resolveTeamContext } from '@/lib/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const ctx = await resolveTeamContext(user.id, user.user_metadata?.plan);
  const plan = ctx.effectivePlan;
  const since = monthStart().toISOString();

  // Determine which user_ids count toward usage.
  let countableUserIds: string[] = [user.id];
  if (ctx.team) {
    const svc = getServiceSupabase();
    if (svc) {
      const { data: members } = await svc.from('team_members').select('user_id').eq('team_id', ctx.team.id);
      countableUserIds = (members || []).map((m: any) => m.user_id);
    }
  }

  const [quick, scans, watchlist] = await Promise.all([
    supabase.from('lookups').select('id', { count: 'exact', head: true }).in('user_id', countableUserIds).eq('source', 'quick').gte('created_at', since),
    supabase.from('lookups').select('id', { count: 'exact', head: true }).in('user_id', countableUserIds).eq('source', 'ratecon').gte('created_at', since),
    supabase.from('watchlist').select('id', { count: 'exact', head: true }).in('user_id', countableUserIds),
  ]);

  return NextResponse.json({
    plan,
    isAdmin: await isAdmin(user.email),
    team: ctx.team ? { id: ctx.team.id, name: ctx.team.name, plan: ctx.team.plan, role: ctx.role, memberCount: countableUserIds.length } : null,
    usage: {
      fmcsaLookups: quick.count ?? 0,
      rateConScans: scans.count ?? 0,
      watchlist: watchlist.count ?? 0,
    },
    periodStart: since,
  });
}
