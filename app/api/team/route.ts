import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { resolveTeamContext } from '@/lib/teams';
import { getPlan } from '@/lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const ctx = await resolveTeamContext(me.id, me.user_metadata?.plan);
  if (!ctx.team) {
    return NextResponse.json({ team: null, members: [], invites: [], role: null });
  }

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  // Members (use service role to also get email/name for each member)
  const { data: memberRows } = await svc
    .from('team_members')
    .select('user_id, role, joined_at')
    .eq('team_id', ctx.team.id)
    .order('joined_at', { ascending: true });

  const members: any[] = [];
  for (const m of memberRows || []) {
    const { data } = await svc.auth.admin.getUserById(m.user_id);
    const u = data?.user;
    const meta = u?.user_metadata || {};
    members.push({
      user_id: m.user_id,
      email: u?.email || null,
      name: meta.full_name || meta.name || u?.email?.split('@')[0] || 'Member',
      company: meta.company || '',
      role: m.role,
      joined_at: m.joined_at,
      isMe: m.user_id === me.id,
    });
  }

  const { data: invites } = await svc
    .from('team_invites')
    .select('id, email, status, expires_at, created_at, invited_by')
    .eq('team_id', ctx.team.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  const plan = getPlan(ctx.team.plan);
  return NextResponse.json({
    team: { id: ctx.team.id, name: ctx.team.name, plan: ctx.team.plan, planLabel: plan.label, ownerUserId: ctx.team.owner_user_id, userLimit: plan.limits.users },
    members,
    invites: invites || [],
    role: ctx.role,
    seatsUsed: (members.length) + (invites?.length || 0),
    seatsTotal: plan.limits.users,
  });
}
