import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { getStripe } from '@/lib/stripe';
import { applyUserPlan } from '@/lib/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIVE = ['active', 'trialing', 'past_due', 'unpaid'];

// Admin-only: cancel one Haulock subscription, either now or at the end of
// the period the customer already paid for. Works for subscriptions whose
// account was deleted, too. Refunds stay a manual step in Stripe.
//
// POST { when: 'now' | 'period_end', userId? }
//   userId: the account to move to Free on 'now' (the Users tab passes the
//   row's user; otherwise the subscription's own user_id tag is used).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!/^sub_[A-Za-z0-9]+$/.test(params.id)) return NextResponse.json({ error: 'Invalid subscription id' }, { status: 400 });
  const body = await req.json().catch(() => null) as { when?: string; userId?: string } | null;
  const when = body?.when === 'now' || body?.when === 'period_end' ? body.when : null;
  if (!when) return NextResponse.json({ error: "Choose 'now' or 'period_end'" }, { status: 400 });

  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });

  let sub;
  try {
    sub = await stripe.subscriptions.retrieve(params.id);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Subscription not found' }, { status: 404 });
  }
  // The Stripe account is shared with other products: only touch Haulock's.
  if (sub.metadata?.product !== 'haulock') return NextResponse.json({ error: 'Not a Haulock subscription' }, { status: 400 });
  if (!LIVE.includes(sub.status)) return NextResponse.json({ error: `Subscription is already ${sub.status}` }, { status: 409 });

  let updated;
  try {
    updated = when === 'now'
      ? await stripe.subscriptions.cancel(sub.id)
      : await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Stripe error' }, { status: 502 });
  }

  // Don't wait for Stripe's webhook: a subscription canceled now means Free
  // now. (At period end, the plan changes when the period actually ends.)
  let movedToFree: string | null = null;
  if (when === 'now') {
    const userId = typeof body?.userId === 'string' && body.userId ? body.userId : sub.metadata?.user_id;
    const svc = getServiceSupabase();
    if (userId && svc) {
      const { data } = await svc.auth.admin.getUserById(userId);
      if (data?.user) {
        await applyUserPlan(userId, 'free');
        movedToFree = data.user.email || userId;
      }
    }
  }

  const u: any = updated;
  return NextResponse.json({
    ok: true,
    status: u.status,
    cancelAtPeriodEnd: Boolean(u.cancel_at_period_end),
    endsAt: u.cancel_at ?? u.current_period_end ?? null,
    movedToFree,
  });
}
