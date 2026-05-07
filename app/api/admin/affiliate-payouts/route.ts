import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { sendEmail, payoutSentTemplate, isResendConfigured, getEmailSiteUrl } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// List every payout request across all affiliates. We attach the
// affiliate's email + display name from auth metadata so the admin tab
// can render rows without a second client-side fetch.
export async function GET(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const url = new URL(req.url);
  const status = url.searchParams.get('status'); // optional: requested|paid|rejected

  let query = svc
    .from('affiliate_payouts')
    .select('id, user_id, amount_cents, status, requested_at, paid_at, rejected_at, reject_reason, admin_notes, affiliate_code, redemptions_count')
    .order('requested_at', { ascending: false })
    .limit(500);
  if (status === 'requested' || status === 'paid' || status === 'rejected') {
    query = query.eq('status', status);
  }

  const { data: payouts, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Hydrate affiliate display info. Listing all users once and looking up
  // per-row keeps this O(N) instead of O(N) Stripe / auth round-trips.
  const { data: usersList } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const userMap = new Map<string, { email: string; name: string }>();
  for (const u of (usersList?.users || []) as any[]) {
    userMap.set(u.id, { email: u.email || '', name: u.user_metadata?.full_name || u.user_metadata?.name || '' });
  }

  const rows = (payouts || []).map((p) => ({
    ...p,
    user: userMap.get(p.user_id) || { email: 'unknown', name: '' },
  }));

  return NextResponse.json({ payouts: rows });
}

// Mark a payout as paid OR rejected.
//   { id, action: 'pay', notes? }
//   { id, action: 'reject', reason? }
export async function PATCH(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const body = await req.json().catch(() => null) as {
    id?: string;
    action?: 'pay' | 'reject';
    notes?: string;
    reason?: string;
  } | null;
  if (!body || !body.id || !body.action) {
    return NextResponse.json({ error: 'Missing id or action' }, { status: 400 });
  }

  // Pull the row first so we can check status + grab the affiliate's user_id
  // for the confirmation email.
  const { data: existing, error: fetchErr } = await svc
    .from('affiliate_payouts')
    .select('id, user_id, amount_cents, status, affiliate_code')
    .eq('id', body.id)
    .single();
  if (fetchErr || !existing) {
    return NextResponse.json({ error: fetchErr?.message || 'Payout not found' }, { status: 404 });
  }
  if (existing.status !== 'requested') {
    return NextResponse.json({ error: `Payout is already ${existing.status} — cannot change.` }, { status: 409 });
  }

  const now = new Date().toISOString();
  const update: any = body.action === 'pay'
    ? { status: 'paid', paid_at: now, admin_notes: body.notes || null }
    : { status: 'rejected', rejected_at: now, reject_reason: body.reason || null };

  const { data: updated, error: updateErr } = await svc
    .from('affiliate_payouts')
    .update(update)
    .eq('id', body.id)
    .select()
    .single();
  if (updateErr || !updated) {
    return NextResponse.json({ error: updateErr?.message || 'Update failed' }, { status: 500 });
  }

  // Notify the affiliate when paid. (Reject is rare — operator usually
  // explains in person before flipping; skipping email there for now.)
  if (body.action === 'pay' && isResendConfigured()) {
    try {
      const { data: affiliate } = await svc.auth.admin.getUserById(existing.user_id);
      const email = affiliate?.user?.email;
      const meta: any = affiliate?.user?.user_metadata || {};
      if (email) {
        const tpl = payoutSentTemplate({
          affiliateName: meta.full_name || meta.name || email,
          amountCents: existing.amount_cents,
          code: existing.affiliate_code || '',
          paidAt: now,
          recipientEmail: email,
          siteUrl: getEmailSiteUrl(),
          notes: body.notes,
        });
        await sendEmail({
          to: email,
          subject: tpl.subject,
          html: tpl.html,
          kind: 'other',
        });
      }
    } catch (err: any) {
      console.warn('[admin/affiliate-payouts] notify email failed', err?.message);
    }
  }

  return NextResponse.json({ ok: true, payout: updated });
}
