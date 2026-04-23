import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET: peek at the invite (does it exist? what email? what team?)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token') || '';
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const { data: invite } = await svc
    .from('team_invites')
    .select('id, email, team_id, status, expires_at, teams ( name, plan )')
    .eq('token', token)
    .maybeSingle();

  if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
  if (invite.status !== 'pending') return NextResponse.json({ error: `Invite is ${invite.status}` }, { status: 410 });
  if (new Date(invite.expires_at).getTime() < Date.now()) return NextResponse.json({ error: 'Invite expired' }, { status: 410 });

  const team = (invite as any).teams;
  return NextResponse.json({
    invite: {
      email: invite.email,
      teamName: team?.name || 'Haulock team',
      teamPlan: team?.plan || 'free',
    },
  });
}

// POST: accept the invite (user must be authed; email must match)
export async function POST(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => null) as { token?: string } | null;
  const token = body?.token || '';
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const { data: invite } = await svc
    .from('team_invites')
    .select('id, email, team_id, status, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
  if (invite.status !== 'pending') return NextResponse.json({ error: `Invite is ${invite.status}` }, { status: 410 });
  if (new Date(invite.expires_at).getTime() < Date.now()) return NextResponse.json({ error: 'Invite expired' }, { status: 410 });
  if (String(me.email || '').toLowerCase() !== String(invite.email || '').toLowerCase()) {
    return NextResponse.json({ error: 'This invite was sent to a different email address. Please sign in with the invited email.' }, { status: 403 });
  }

  // User can only be on one team at a time
  const { data: existingMembership } = await svc.from('team_members').select('team_id').eq('user_id', me.id).maybeSingle();
  if (existingMembership && existingMembership.team_id !== invite.team_id) {
    return NextResponse.json({ error: "You're already on another team. Leave that team first." }, { status: 400 });
  }

  // Add membership + mark invite accepted
  const { error: memErr } = await svc.from('team_members').upsert(
    { team_id: invite.team_id, user_id: me.id, role: 'member' },
    { onConflict: 'team_id,user_id' }
  );
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

  await svc.from('team_invites').update({ status: 'accepted' }).eq('id', invite.id);

  return NextResponse.json({ ok: true, teamId: invite.team_id });
}
