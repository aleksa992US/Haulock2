import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { ensureTeamForOwner } from '@/lib/teams';
import { PLANS } from '@/lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Called after a user picks a plan in the Plan picker.
// Updates user_metadata.plan AND ensures the user has a team with that plan
// (creates one if missing). Idempotent.
export async function POST(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => null) as { plan?: string } | null;
  const plan = body?.plan;
  if (!plan || !(plan in PLANS)) return NextResponse.json({ error: 'Unknown plan' }, { status: 400 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  // Don't allow plan-syncing if user is a non-owner member of an existing team.
  const { data: existingMembership } = await svc.from('team_members')
    .select('team_id, role').eq('user_id', me.id).maybeSingle();
  if (existingMembership && existingMembership.role !== 'owner') {
    return NextResponse.json({ error: "You're a member of a team. Plan changes are managed by the team owner." }, { status: 403 });
  }

  const teamName = me.user_metadata?.company || me.user_metadata?.full_name || me.user_metadata?.name || me.email?.split('@')[0] || 'My team';
  const teamId = await ensureTeamForOwner({ userId: me.id, plan, name: teamName });
  return NextResponse.json({ ok: true, teamId });
}
