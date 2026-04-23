import { getServiceSupabase } from './supabase/service';
import { getPlan, type Plan } from './plans';
import { randomBytes } from 'crypto';

export type TeamContext = {
  team: { id: string; name: string | null; plan: string; owner_user_id: string } | null;
  role: 'owner' | 'member' | null;
  ownerUserId: string;
  effectivePlan: Plan;
};

// For a given user, return the team they belong to (if any) plus their effective plan.
// If user is on a team → use the team's plan.
// Otherwise → use the user's user_metadata.plan.
export async function resolveTeamContext(userId: string, userMetaPlan?: string | null): Promise<TeamContext> {
  const svc = getServiceSupabase();
  if (!svc) {
    return { team: null, role: null, ownerUserId: userId, effectivePlan: getPlan(userMetaPlan) };
  }
  const { data: membership } = await svc
    .from('team_members')
    .select('team_id, role, teams ( id, name, plan, owner_user_id )')
    .eq('user_id', userId)
    .maybeSingle();

  if (membership && (membership as any).teams) {
    const team = (membership as any).teams;
    return {
      team: { id: team.id, name: team.name, plan: team.plan, owner_user_id: team.owner_user_id },
      role: (membership as any).role === 'owner' ? 'owner' : 'member',
      ownerUserId: team.owner_user_id,
      effectivePlan: getPlan(team.plan),
    };
  }
  return { team: null, role: null, ownerUserId: userId, effectivePlan: getPlan(userMetaPlan) };
}

export async function ensureTeamForOwner(opts: { userId: string; plan: string; name?: string | null }): Promise<string> {
  const svc = getServiceSupabase();
  if (!svc) throw new Error('Service role not configured');

  // If user already has a team they own, update its plan.
  const { data: existing } = await svc.from('teams').select('id').eq('owner_user_id', opts.userId).maybeSingle();
  if (existing?.id) {
    await svc.from('teams').update({ plan: opts.plan, name: opts.name ?? undefined }).eq('id', existing.id);
    return existing.id;
  }

  // Create a new team and add the user as owner.
  const { data: team, error } = await svc
    .from('teams')
    .insert({ owner_user_id: opts.userId, plan: opts.plan, name: opts.name || null })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  await svc.from('team_members').upsert(
    { team_id: team.id, user_id: opts.userId, role: 'owner' },
    { onConflict: 'team_id,user_id' }
  );
  return team.id;
}

export function newInviteToken(): string {
  return randomBytes(24).toString('base64url');
}
