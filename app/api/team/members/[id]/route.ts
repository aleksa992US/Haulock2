import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { resolveTeamContext } from '@/lib/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const ctx = await resolveTeamContext(me.id, me.user_metadata?.plan);
  if (!ctx.team) return NextResponse.json({ error: 'Not on a team' }, { status: 400 });

  const targetUserId = params.id;
  const isSelfLeaving = targetUserId === me.id;

  // Owner can remove anyone except themselves; member can only leave self.
  if (!isSelfLeaving && ctx.role !== 'owner') {
    return NextResponse.json({ error: 'Only the team owner can remove members' }, { status: 403 });
  }
  if (isSelfLeaving && ctx.role === 'owner') {
    return NextResponse.json({ error: "Owners can't leave their own team. Delete the team or transfer ownership first." }, { status: 400 });
  }

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const { error } = await svc.from('team_members').delete()
    .eq('team_id', ctx.team.id)
    .eq('user_id', targetUserId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
