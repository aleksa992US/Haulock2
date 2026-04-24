import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin, invalidateAdminCache } from '@/lib/admin';
import { PLANS } from '@/lib/plans';
import { getStripe } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const body = await req.json().catch(() => null) as { plan?: string; isAdmin?: boolean } | null;
  if (!body) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });

  // Update plan (stored in user_metadata)
  if (typeof body.plan === 'string') {
    if (!(body.plan in PLANS)) return NextResponse.json({ error: 'Unknown plan' }, { status: 400 });
    const { data: existing } = await svc.auth.admin.getUserById(params.id);
    const merged = { ...(existing.user?.user_metadata || {}), plan: body.plan };
    const { error } = await svc.auth.admin.updateUserById(params.id, { user_metadata: merged });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Toggle admin (by email, in admins table)
  if (typeof body.isAdmin === 'boolean') {
    const { data: target } = await svc.auth.admin.getUserById(params.id);
    const email = target.user?.email;
    if (!email) return NextResponse.json({ error: 'Target user has no email' }, { status: 400 });
    if (body.isAdmin) {
      const { error } = await svc.from('admins').upsert({ email: email.toLowerCase(), added_by: me.id }, { onConflict: 'email' });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      if (email.toLowerCase() === (me.email || '').toLowerCase()) {
        return NextResponse.json({ error: "You can't remove yourself as admin" }, { status: 400 });
      }
      const { error } = await svc.from('admins').delete().eq('email', email.toLowerCase());
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    invalidateAdminCache();
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (params.id === me.id) {
    return NextResponse.json({ error: "You can't delete yourself from the admin panel." }, { status: 400 });
  }

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  // Cancel any active Stripe subscriptions for this user before deleting their
  // login — otherwise Stripe would keep charging their card after the account
  // is gone, and the webhook wouldn't be able to find them to downgrade.
  const cancelledSubs: string[] = [];
  const stripe = getStripe();
  if (stripe) {
    try {
      const { data: target } = await svc.auth.admin.getUserById(params.id);
      const meta = target.user?.user_metadata || {};
      const email = target.user?.email;
      let customerId: string | null = (meta.stripe_customer_id as string) || null;
      if (!customerId && email) {
        const found = await stripe.customers.list({ email, limit: 1 });
        customerId = found.data[0]?.id || null;
      }
      if (customerId) {
        const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
        for (const s of subs.data) {
          if (s.status === 'active' || s.status === 'trialing' || s.status === 'past_due' || s.status === 'unpaid') {
            try {
              await stripe.subscriptions.cancel(s.id);
              cancelledSubs.push(s.id);
            } catch { /* keep going */ }
          }
        }
      }
    } catch (err) {
      console.warn('[admin delete] Stripe cleanup failed:', err);
    }
  }

  // Best-effort scrub of rows owned by this user (cascading FKs usually handle
  // this, but we do it explicitly in case any table is missing ON DELETE CASCADE).
  try {
    await svc.from('lookups').delete().eq('user_id', params.id);
    await svc.from('watchlist').delete().eq('user_id', params.id);
    await svc.from('fraud_reports').delete().eq('user_id', params.id);
    await svc.from('team_members').delete().eq('user_id', params.id);
    await svc.from('teams').delete().eq('owner_id', params.id);
    await svc.from('api_keys').delete().eq('user_id', params.id);
  } catch { /* non-fatal */ }

  const { error } = await svc.auth.admin.deleteUser(params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, cancelledSubscriptions: cancelledSubs });
}
