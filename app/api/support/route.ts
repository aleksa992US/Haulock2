import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { sendEmail, supportReceivedTemplate, isResendConfigured } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ticketUrl(): string {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://haulock.com').replace(/\/+$/, '');
  return `${site}/support`;
}

// List the authenticated user's support tickets, with the message count and
// the timestamp of the most recent message so the client can show "last
// reply 2h ago" without an extra round-trip per row.
export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: tickets, error } = await supabase
    .from('support_tickets')
    .select('id, subject, status, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Pull message counts + last message timestamp + last admin reply for each
  // ticket. RLS scopes us to the user's own tickets, so a single query is fine.
  const ids = (tickets || []).map((t: any) => t.id);
  let extras: Record<string, { messageCount: number; lastMessageAt: string | null; lastAdminReplyAt: string | null }> = {};
  if (ids.length > 0) {
    const { data: msgs } = await supabase
      .from('support_messages')
      .select('ticket_id, is_admin, created_at')
      .in('ticket_id', ids);
    for (const m of msgs || []) {
      const slot = extras[m.ticket_id] || { messageCount: 0, lastMessageAt: null, lastAdminReplyAt: null };
      slot.messageCount += 1;
      if (!slot.lastMessageAt || m.created_at > slot.lastMessageAt) slot.lastMessageAt = m.created_at;
      if (m.is_admin && (!slot.lastAdminReplyAt || m.created_at > slot.lastAdminReplyAt)) slot.lastAdminReplyAt = m.created_at;
      extras[m.ticket_id] = slot;
    }
  }

  const enriched = (tickets || []).map((t: any) => ({ ...t, ...(extras[t.id] || { messageCount: 0, lastMessageAt: null, lastAdminReplyAt: null }) }));
  return NextResponse.json({ tickets: enriched });
}

// Create a new ticket plus the first message. Atomic-ish — if the message
// insert fails after the ticket inserts, we leave the ticket but log the
// inconsistency. This is a low-volume support flow, not order-of-magnitude
// critical.
export async function POST(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => null) as { subject?: string; body?: string } | null;
  const subject = (body?.subject || '').toString().trim().slice(0, 200);
  const message = (body?.body || '').toString().trim().slice(0, 5000);
  if (!subject || !message) {
    return NextResponse.json({ error: 'Subject and message are required.' }, { status: 400 });
  }

  const { data: ticket, error: tErr } = await supabase
    .from('support_tickets')
    .insert({ user_id: user.id, subject })
    .select('id, subject, status, created_at, updated_at')
    .single();
  if (tErr || !ticket) return NextResponse.json({ error: tErr?.message || 'Could not open ticket.' }, { status: 500 });

  const { error: mErr } = await supabase
    .from('support_messages')
    .insert({ ticket_id: ticket.id, user_id: user.id, is_admin: false, body: message });
  if (mErr) {
    console.warn('[api/support POST] ticket inserted but first message failed:', mErr);
    return NextResponse.json({ error: mErr.message, ticketId: ticket.id }, { status: 500 });
  }

  // Fire-and-forget "we got your ticket" confirmation. Best-effort; we
  // never block the response on Resend availability.
  if (isResendConfigured() && user.email) {
    const meta = (user.user_metadata || {}) as any;
    const override = typeof meta.notification_email === 'string' ? meta.notification_email.trim() : '';
    const toAddress = override || user.email;
    const tpl = supportReceivedTemplate({
      subject,
      preview: message.slice(0, 600),
      recipientEmail: toAddress,
      ticketUrl: ticketUrl(),
    });
    sendEmail({ to: toAddress, subject: tpl.subject, html: tpl.html, kind: 'support_received' })
      .catch((err) => console.warn('[api/support POST] receipt email failed:', err?.message));
  }

  return NextResponse.json({ ticket });
}
