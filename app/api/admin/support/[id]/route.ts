import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = new Set(['open', 'working', 'solved']);

async function authorizeAdmin(): Promise<{ ok: true; me: any } | { ok: false; status: number; error: string }> {
  const supabase = getServerSupabase();
  if (!supabase) return { ok: false, status: 500, error: 'Supabase not configured' };
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me?.email) return { ok: false, status: 401, error: 'Not authenticated' };
  if (!(await isAdmin(me.email))) return { ok: false, status: 403, error: 'Forbidden' };
  return { ok: true, me };
}

// Admin GET — full ticket + thread + the user's email/name.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authorizeAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const { data: ticket, error: tErr } = await svc.from('support_tickets')
    .select('id, user_id, subject, status, created_at, updated_at')
    .eq('id', params.id)
    .single();
  if (tErr || !ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

  const { data: messages } = await svc.from('support_messages')
    .select('id, body, is_admin, created_at')
    .eq('ticket_id', params.id)
    .order('created_at', { ascending: true });

  let userInfo: { email: string; name: string | null } = { email: '', name: null };
  try {
    const { data: u } = await svc.auth.admin.getUserById(ticket.user_id);
    if (u?.user) {
      const meta = (u.user.user_metadata || {}) as any;
      userInfo = { email: u.user.email || '', name: (meta.full_name || meta.name || null) as string | null };
    }
  } catch { /* non-fatal */ }

  return NextResponse.json({ ticket: { ...ticket, user: userInfo }, messages: messages || [] });
}

// Admin reply — inserts a message with is_admin=true, bumps updated_at,
// and flips status from 'open' to 'working' if it was still open.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorizeAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const body = await req.json().catch(() => null) as { body?: string } | null;
  const message = (body?.body || '').toString().trim().slice(0, 5000);
  if (!message) return NextResponse.json({ error: 'Message body is required.' }, { status: 400 });

  const { data: ticket } = await svc.from('support_tickets')
    .select('id, status')
    .eq('id', params.id)
    .single();
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

  const { data: inserted, error } = await svc.from('support_messages')
    .insert({ ticket_id: params.id, user_id: auth.me.id, is_admin: true, body: message })
    .select('id, body, is_admin, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const newStatus = ticket.status === 'open' ? 'working' : ticket.status;
  await svc.from('support_tickets')
    .update({ updated_at: new Date().toISOString(), status: newStatus })
    .eq('id', params.id);

  return NextResponse.json({ message: inserted, status: newStatus });
}

// Admin status change — open / working / solved.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorizeAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const body = await req.json().catch(() => null) as { status?: string } | null;
  const status = (body?.status || '').toString().toLowerCase();
  if (!STATUSES.has(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });

  const { error } = await svc.from('support_tickets')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, status });
}
