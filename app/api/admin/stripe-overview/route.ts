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
  // Expand latest_invoice so we can show actual charged amounts (post-discount),
  // and the customer object so we have names/emails for the table.
  const subs = await stripe.subscriptions.list({
    status: 'all',
    limit: 100,
    expand: ['data.customer', 'data.latest_invoice'],
  });

  // Filter Haulock-tagged subs, and drop `incomplete` rows from the UI — those are
  // abandoned checkout attempts (user closed the tab, refreshed, etc.) and they
  // clutter metrics. They auto-expire in Stripe after ~23h anyway.
  const haulockSubs = subs.data.filter((s) => s.metadata?.product === 'haulock');
  const completedSubs = haulockSubs.filter((s) => s.status !== 'incomplete' && s.status !== 'incomplete_expired');

  const now = Math.floor(Date.now() / 1000);
  const active = completedSubs.filter((s) => s.status === 'active' || s.status === 'trialing');
  const pastDue = completedSubs.filter((s) => s.status === 'past_due' || s.status === 'unpaid');
  const canceled = completedSubs.filter((s) => s.status === 'canceled');
  const last30d = completedSubs.filter((s) => s.created >= now - 30 * 24 * 60 * 60);
  const incomplete = haulockSubs.filter((s) => s.status === 'incomplete' || s.status === 'incomplete_expired');

  // MRR: for each active sub, the monthly recurring amount AFTER any discount
  // that applies on an ongoing basis. Stripe coupons with duration='once' only
  // discount the first invoice so they don't reduce MRR. Coupons with 'forever'
  // or 'repeating' do. This gives a realistic forward-looking MRR.
  const mrrCents = active.reduce((sum, s) => {
    const price = s.items.data[0]?.price;
    if (!price?.unit_amount) return sum;
    const interval = price.recurring?.interval;
    const list = interval === 'year' ? price.unit_amount / 12 : price.unit_amount;
    const discount: any = (s as any).discount;
    const coupon = discount?.coupon;
    let effective = list;
    if (coupon && (coupon.duration === 'forever' || coupon.duration === 'repeating')) {
      if (coupon.percent_off) effective = list * (1 - coupon.percent_off / 100);
      else if (coupon.amount_off) {
        const amtMonthly = interval === 'year' ? coupon.amount_off / 12 : coupon.amount_off;
        effective = Math.max(0, list - amtMonthly);
      }
    }
    return sum + effective;
  }, 0);

  // Breakdown by plan
  const planCounts: Record<string, number> = { carrier: 0, team: 0, fleet: 0 };
  for (const s of active) {
    const priceId = s.items.data[0]?.price?.id;
    const mapped = planFromPriceId(priceId);
    const p = mapped?.plan || s.metadata?.plan || null;
    if (p && planCounts[p] != null) planCounts[p] += 1;
  }

  // Recent activity feed — only completed subs (not incomplete abandoned ones).
  const recent = completedSubs.slice(0, 20).map((s) => {
    const priceId = s.items.data[0]?.price?.id;
    const mapped = planFromPriceId(priceId);
    const cust: any = s.customer;
    const priceAmount = s.items.data[0]?.price?.unit_amount ?? null;
    const inv: any = s.latest_invoice;
    // What the customer was actually charged (after discount). Falls back to
    // price.unit_amount for subs we don't have a completed invoice for.
    const paidAmount = typeof inv === 'object' && inv?.amount_paid ? inv.amount_paid
      : typeof inv === 'object' && inv?.amount_due ? inv.amount_due
      : null;
    return {
      id: s.id,
      status: s.status,
      plan: mapped?.plan || s.metadata?.plan || null,
      billing: mapped?.billing || null,
      list_amount: priceAmount,
      paid_amount: paidAmount,
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
      incomplete: incomplete.length,
      mrr_cents: Math.round(mrrCents),
      currency: active[0]?.items.data[0]?.price?.currency?.toUpperCase() || 'USD',
    },
    planBreakdown: planCounts,
    recent,
  });
}
