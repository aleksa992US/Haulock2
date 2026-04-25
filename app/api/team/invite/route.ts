import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { resolveTeamContext, newInviteToken } from '@/lib/teams';
import { getPlan } from '@/lib/plans';
import { sendEmail, teamInviteTemplate, isResendConfigured } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function POST(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => null) as { email?: string } | null;
  const email = String(body?.email || '').trim().toLowerCase();
  if (!email || !isValidEmail(email)) return NextResponse.json({ error: 'Valid email required' }, { status: 400 });

  const ctx = await resolveTeamContext(me.id, me.user_metadata?.plan);
  if (!ctx.team || ctx.role !== 'owner') {
    return NextResponse.json({ error: 'Only the team owner can invite members' }, { status: 403 });
  }

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  // Seat check: members + pending invites + 1 new <= plan.users
  const plan = getPlan(ctx.team.plan);
  const seatLimit = plan.limits.users;
  const [{ count: memberCount }, { count: inviteCount }] = await Promise.all([
    svc.from('team_members').select('user_id', { count: 'exact', head: true }).eq('team_id', ctx.team.id),
    svc.from('team_invites').select('id', { count: 'exact', head: true }).eq('team_id', ctx.team.id).eq('status', 'pending'),
  ]);
  if ((memberCount || 0) + (inviteCount || 0) + 1 > seatLimit) {
    return NextResponse.json({ error: `Team is at the ${seatLimit}-seat limit for the ${plan.label} plan.` }, { status: 402 });
  }

  // Don't invite someone who's already a member of this team
  const { data: existingMembers } = await svc.auth.admin.listUsers({ perPage: 1000 });
  const existingUser = existingMembers?.users?.find((u: any) => (u.email || '').toLowerCase() === email);
  if (existingUser) {
    const { data: existingMembership } = await svc.from('team_members').select('team_id').eq('user_id', existingUser.id).maybeSingle();
    if (existingMembership?.team_id === ctx.team.id) {
      return NextResponse.json({ error: 'They are already on this team.' }, { status: 400 });
    }
    if (existingMembership?.team_id) {
      return NextResponse.json({ error: 'That user is already on a different team.' }, { status: 400 });
    }
  }

  const token = newInviteToken();
  const { data: invite, error } = await svc
    .from('team_invites')
    .upsert({
      team_id: ctx.team.id,
      email,
      token,
      invited_by: me.id,
      status: 'pending',
    }, { onConflict: 'team_id,email' })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Send email (best-effort)
  if (isResendConfigured()) {
    const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://haulock.com';
    const acceptUrl = `${site}/auth/accept-invite?token=${encodeURIComponent(token)}`;
    const inviterName = me.user_metadata?.full_name || me.user_metadata?.name || me.email || 'A teammate';
    const { subject, html } = teamInviteTemplate({
      inviterName,
      teamName: ctx.team.name,
      planLabel: plan.label,
      acceptUrl,
    });
    try { await sendEmail({ to: email, subject, html, replyTo: me.email || undefined, kind: 'team_invite' }); }
    catch (e: any) { console.error('[team/invite] email send failed:', e?.message); }
  }

  return NextResponse.json({ ok: true, invite });
}
