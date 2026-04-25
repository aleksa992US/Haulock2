import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { sendEmail, supportAdminReplyTemplate, supportWorkingTemplate, supportSolvedTemplate, isResendConfigured } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = new Set(['open', 'working', 'solved']);

function ticketUrl(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getEmailSiteUrl } = require('@/lib/email');
  return `${getEmailSiteUrl()}/support`;
}

// Look up the ticket owner's preferred email + name. Pulled from the auth
// admin API so we respect notification_email if the user set one in
// Settings → Notifications.
async function getTicketRecipient(svc: any, userId: string): Promise<{ email: string | null; name: string | null }> {
  try {
    const { data } = await svc.auth.admin.getUserById(userId);
    const u = data?.user;
    if (!u?.email) return { email: null, name: null };
    const meta = (u.user_metadata || {}) as any;
    const override = typeof meta.notification_email === 'string' ? meta.notification_email.trim() : '';
    return {
      email: override || u.email,
      name: (meta.full_name || meta.name || null) as string | null,
    };
  } catch (err) {
    console.warn('[admin/support] getUserById failed:', err);
    return { email: null, name: null };
  }
}

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
    .select('id, user_id, subject, status')
    .eq('id', params.id)
    .single();
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

  const { data: inserted, error } = await svc.from('support_messages')
    .insert({ ticket_id: params.id, user_id: auth.me.id, is_admin: true, body: message })
    .select('id, body, is_admin, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const newStatus = ticket.status === 'open' ? 'working' : ticket.status;
  const statusFlipped = ticket.status === 'open' && newStatus === 'working';
  await svc.from('support_tickets')
    .update({ updated_at: new Date().toISOString(), status: newStatus })
    .eq('id', params.id);

  // Notify the ticket owner of the admin reply. Best-effort.
  if (isResendConfigured()) {
    const recipient = await getTicketRecipient(svc, ticket.user_id);
    if (recipient.email) {
      const tpl = supportAdminReplyTemplate({
        subject: ticket.subject,
        reply: message,
        recipientEmail: recipient.email,
        ticketUrl: ticketUrl(),
        statusFlipped,
      });
      sendEmail({ to: recipient.email, subject: tpl.subject, html: tpl.html, kind: 'support_reply' })
        .catch((err) => console.warn('[admin/support reply] email failed:', err?.message));
    }
  }

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

  // Read the current state so we only email when the status actually flips.
  // Re-pinging "working" → "working" should not spam the user.
  const { data: ticket } = await svc.from('support_tickets')
    .select('id, user_id, subject, status')
    .eq('id', params.id)
    .single();
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  const prevStatus = ticket.status;

  const { error } = await svc.from('support_tickets')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Only notify on a real transition. open → working and any → solved
  // are the two changes worth an email. working → open (reopened) is
  // typically driven by user replies which already get their own email
  // path; we skip notifying on that case.
  if (isResendConfigured() && prevStatus !== status) {
    const recipient = await getTicketRecipient(svc, ticket.user_id);
    if (recipient.email) {
      if (status === 'working' && prevStatus === 'open') {
        const tpl = supportWorkingTemplate({
          subject: ticket.subject,
          recipientEmail: recipient.email,
          ticketUrl: ticketUrl(),
        });
        sendEmail({ to: recipient.email, subject: tpl.subject, html: tpl.html, kind: 'support_working' })
          .catch((err) => console.warn('[admin/support PATCH] working email failed:', err?.message));
      } else if (status === 'solved') {
        const tpl = supportSolvedTemplate({
          subject: ticket.subject,
          recipientEmail: recipient.email,
          ticketUrl: ticketUrl(),
        });
        sendEmail({ to: recipient.email, subject: tpl.subject, html: tpl.html, kind: 'support_solved' })
          .catch((err) => console.warn('[admin/support PATCH] solved email failed:', err?.message));
      }
    }
  }

  return NextResponse.json({ ok: true, status });
}
