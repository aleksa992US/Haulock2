import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { applyUserPlan, ensureTeamForOwner } from '@/lib/teams';
import { enforcedPlanId } from '@/lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Two callers: switching to Free on the Plan page (body.plan = 'free'), and
// "Set up team" on the Team tab, which creates the owner's team. The plan is
// never taken from the request — it accepted any plan, so anyone could give
// themselves Fleet. Paid plans are only set by Stripe (webhook / billing
// sync) or an admin.
export async function POST(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => null) as { plan?: string } | null;
  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  // Don't allow plan-syncing if user is a non-owner member of an existing team.
  const { data: existingMembership } = await svc.from('team_members')
    .select('team_id, role').eq('user_id', me.id).maybeSingle();
  if (existingMembership && existingMembership.role !== 'owner') {
    return NextResponse.json({ error: "You're a member of a team. Plan changes are managed by the team owner." }, { status: 403 });
  }

  if (body?.plan === 'free') {
    await applyUserPlan(me.id, 'free');
    return NextResponse.json({ ok: true, plan: 'free' });
  }

  const plan = enforcedPlanId(me);
  const teamName = me.user_metadata?.company || me.user_metadata?.full_name || me.user_metadata?.name || me.email?.split('@')[0] || 'My team';
  const teamId = await ensureTeamForOwner({ userId: me.id, plan, name: teamName });
  return NextResponse.json({ ok: true, teamId, plan });
}
