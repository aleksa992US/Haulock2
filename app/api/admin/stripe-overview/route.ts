import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/admin';
import { getStripe, planFromPriceId } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Pull recent active subscriptions (all statuses) — the 100 newest.
  const subs = await stripe.subscriptions.list({
    status: 'all',
    limit: 100,
    expand: ['data.customer'],
  });

  const haulockSubs = subs.data.filter((s) => s.metadata?.product === 'haulock');

  const now = Math.floor(Date.now() / 1000);
  const active = haulockSubs.filter((s) => s.status === 'active' || s.status === 'trialing');
  const pastDue = haulockSubs.filter((s) => s.status === 'past_due' || s.status === 'unpaid');
  const canceled = haulockSubs.filter((s) => s.status === 'canceled');
  const last30d = haulockSubs.filter((s) => s.created >= now - 30 * 24 * 60 * 60);

  // Rough MRR: for each active sub, unit amount normalized to monthly, in cents.
  const mrrCents = active.reduce((sum, s) => {
    const price = s.items.data[0]?.price;
    if (!price?.unit_amount) return sum;
    const interval = price.recurring?.interval;
    const monthly = interval === 'year' ? price.unit_amount / 12 : price.unit_amount;
    return sum + monthly;
  }, 0);

  // Breakdown by plan
  const planCounts: Record<string, number> = { carrier: 0, team: 0, fleet: 0 };
  for (const s of active) {
    const priceId = s.items.data[0]?.price?.id;
    const mapped = planFromPriceId(priceId);
    const p = mapped?.plan || s.metadata?.plan || null;
    if (p && planCounts[p] != null) planCounts[p] += 1;
  }

  // Recent activity feed (newest first, keep customer email visible)
  const recent = haulockSubs.slice(0, 20).map((s) => {
    const priceId = s.items.data[0]?.price?.id;
    const mapped = planFromPriceId(priceId);
    const cust: any = s.customer;
    return {
      id: s.id,
      status: s.status,
      plan: mapped?.plan || s.metadata?.plan || null,
      billing: mapped?.billing || null,
      amount: s.items.data[0]?.price?.unit_amount ?? null,
      currency: (s.items.data[0]?.price?.currency || 'usd').toUpperCase(),
      customer_email: typeof cust === 'string' ? null : cust?.email ?? null,
      customer_name: typeof cust === 'string' ? null : cust?.name ?? null,
      cancel_at_period_end: s.cancel_at_period_end || false,
      created: s.created,
      current_period_end: (s as any).current_period_end ?? null,
      promo_code: s.metadata?.promo_code ?? null,
    };
  });

  return NextResponse.json({
    totals: {
      active: active.length,
      past_due: pastDue.length,
      canceled: canceled.length,
      new_last_30d: last30d.length,
      mrr_cents: Math.round(mrrCents),
      currency: active[0]?.items.data[0]?.price?.currency?.toUpperCase() || 'USD',
    },
    planBreakdown: planCounts,
    recent,
  });
}
