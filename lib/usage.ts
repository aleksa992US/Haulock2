import { getServiceSupabase } from './supabase/service';
import { monthStart } from './plans';
import type { TeamContext } from './teams';

// User ids whose usage counts against the same quota: the whole team when
// the user is on one, otherwise just the user.
export async function countableUserIds(userId: string, ctx: TeamContext): Promise<string[]> {
  if (!ctx.team) return [userId];
  const svc = getServiceSupabase();
  if (!svc) return [userId];
  const { data: members } = await svc.from('team_members').select('user_id').eq('team_id', ctx.team.id);
  const ids = (members || []).map((m: any) => m.user_id as string);
  return ids.length > 0 ? ids : [userId];
}

// Rows in `lookups` with the given source this calendar month, team-wide.
export async function countMonthlyLookups(userId: string, ctx: TeamContext, source: string): Promise<number> {
  const svc = getServiceSupabase();
  if (!svc) return 0;
  const ids = await countableUserIds(userId, ctx);
  const { count } = await svc
    .from('lookups')
    .select('id', { count: 'exact', head: true })
    .in('user_id', ids)
    .eq('source', source)
    .gte('created_at', monthStart().toISOString());
  return count ?? 0;
}
