import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Get a single ticket the user owns, with the full message thread.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: ticket, error: tErr } = await supabase
    .from('support_tickets')
    .select('id, subject, status, created_at, updated_at')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();
  if (tErr || !ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

  const { data: messages, error: mErr } = await supabase
    .from('support_messages')
    .select('id, body, is_admin, created_at')
    .eq('ticket_id', params.id)
    .order('created_at', { ascending: true });
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  return NextResponse.json({ ticket, messages: messages || [] });
}

// User reply on their own ticket. RLS allows insert when is_admin=false and
// the ticket belongs to them; we still send is_admin: false explicitly.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => null) as { body?: string } | null;
  const message = (body?.body || '').toString().trim().slice(0, 5000);
  if (!message) return NextResponse.json({ error: 'Message body is required.' }, { status: 400 });

  // Confirm the ticket belongs to the user before inserting (RLS will also
  // block, but the explicit check returns a friendlier error message).
  const { data: ticket } = await supabase
    .from('support_tickets')
    .select('id, status')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

  const { data: inserted, error } = await supabase
    .from('support_messages')
    .insert({ ticket_id: params.id, user_id: user.id, is_admin: false, body: message })
    .select('id, body, is_admin, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Bump updated_at + reopen if the ticket was solved (a user reply means
  // they have a follow-up). Service role would be cleaner but we have RLS
  // permitting select-only on tickets, so we route through service for
  // the status flip if needed. Keep it simple: just bump updated_at.
  // This needs service to actually write — fall back to leaving updated_at
  // as-is rather than failing the reply.
  try {
    const { getServiceSupabase } = await import('@/lib/supabase/service');
    const svc = getServiceSupabase();
    if (svc) {
      const newStatus = ticket.status === 'solved' ? 'open' : ticket.status;
      await svc.from('support_tickets')
        .update({ updated_at: new Date().toISOString(), status: newStatus })
        .eq('id', params.id);
    }
  } catch (err) {
    console.warn('[api/support reply] updated_at bump failed (non-fatal):', err);
  }

  return NextResponse.json({ message: inserted });
}
