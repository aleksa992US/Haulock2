import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin: list all support tickets across all users with sender info,
// message counts, and a one-line preview. Optional ?status= filter.
export async function GET(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me?.email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status'); // 'open' | 'working' | 'solved' | null

  let q = svc.from('support_tickets')
    .select('id, user_id, subject, status, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(500);
  if (status && ['open', 'working', 'solved'].includes(status)) q = q.eq('status', status);
  const { data: tickets, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Hydrate user emails (one batch via auth admin) + message counts.
  const userIds = Array.from(new Set((tickets || []).map((t: any) => t.user_id)));
  const emailById = new Map<string, { email: string; name: string | null }>();
  try {
    const { data: usersPage } = await svc.auth.admin.listUsers({ perPage: 1000 });
    for (const u of usersPage?.users || []) {
      if (!userIds.includes(u.id)) continue;
      const meta = (u.user_metadata || {}) as any;
      emailById.set(u.id, {
        email: u.email || '',
        name: (meta.full_name || meta.name || null) as string | null,
      });
    }
  } catch (err) {
    console.warn('[admin/support] listUsers failed:', err);
  }

  const ids = (tickets || []).map((t: any) => t.id);
  const counts = new Map<string, { messageCount: number; lastMessageAt: string | null; lastUserMessage: string | null }>();
  if (ids.length > 0) {
    const { data: msgs } = await svc.from('support_messages')
      .select('ticket_id, is_admin, body, created_at')
      .in('ticket_id', ids)
      .order('created_at', { ascending: true });
    for (const m of msgs || []) {
      const slot = counts.get(m.ticket_id) || { messageCount: 0, lastMessageAt: null, lastUserMessage: null };
      slot.messageCount += 1;
      if (!slot.lastMessageAt || m.created_at > slot.lastMessageAt) slot.lastMessageAt = m.created_at;
      if (!m.is_admin) slot.lastUserMessage = String(m.body || '').slice(0, 200);
      counts.set(m.ticket_id, slot);
    }
  }

  const enriched = (tickets || []).map((t: any) => ({
    ...t,
    user: emailById.get(t.user_id) || { email: '', name: null },
    ...(counts.get(t.id) || { messageCount: 0, lastMessageAt: null, lastUserMessage: null }),
  }));

  return NextResponse.json({
    tickets: enriched,
    counts: {
      open: enriched.filter((t: any) => t.status === 'open').length,
      working: enriched.filter((t: any) => t.status === 'working').length,
      solved: enriched.filter((t: any) => t.status === 'solved').length,
    },
  });
}
