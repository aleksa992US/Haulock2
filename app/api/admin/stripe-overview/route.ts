import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getServerSupabase } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/admin';
import { getStripe, planFromPriceId } from '@/lib/stripe';
import { cancelReasonOf, listHaulockSubscriptions, paidSubscriptionIds } from '@/lib/billing';
import { currentPlansFor } from '@/lib/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Every Haulock subscription, all statuses. The Stripe account is shared
  // with other products, so taking only the newest 100 of everything could
  // miss Haulock subscriptions. Expand latest_invoice so we can show actual
  // charged amounts (post-discount), and the customer object so we have
  // names/emails for the table.
  let haulockSubs: Stripe.Subscription[];
  let paidIds: Set<string>;
  try {
    ({ subs: haulockSubs } = await listHaulockSubscriptions(stripe, ['data.customer', 'data.latest_invoice']));
    paidIds = await paidSubscriptionIds(stripe, haulockSubs);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Stripe error' }, { status: 502 });
  }

  // Only subscriptions that were actually paid for count. Abandoned checkout
  // attempts (closed tab, retried with another promo code) stay incomplete or
  // get canceled before any invoice is paid; counting them inflated Canceled,
  // New, and Ever paid.
  const completedSubs = haulockSubs.filter((s) => paidIds.has(s.id));

  const now = Math.floor(Date.now() / 1000);
  const active = completedSubs.filter((s) => s.status === 'active' || s.status === 'trialing');
  const pastDue = completedSubs.filter((s) => s.status === 'past_due' || s.status === 'unpaid');
  const canceled = completedSubs.filter((s) => s.status === 'canceled');
  const last30d = completedSubs.filter((s) => s.created >= now - 30 * 24 * 60 * 60);
  const incomplete = haulockSubs.filter((s) => !paidIds.has(s.id));

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

  // Billing-cycle breakdown for active subs. "monthly" = pays every month,
  // "annual" = paid up front for the year. Useful to spot what split actually
  // converts so we know which to push harder.
  const billingCounts = { monthly: 0, annual: 0 };
  for (const s of active) {
    const interval = s.items.data[0]?.price?.recurring?.interval;
    if (interval === 'year') billingCounts.annual += 1;
    else if (interval === 'month') billingCounts.monthly += 1;
  }

  // Total unique customers who have ever bought a Haulock sub (regardless of
  // current status). The "lifetime customers" number, not just current actives.
  const everPaidIds = new Set<string>();
  for (const s of completedSubs) {
    const cid = typeof s.customer === 'string' ? s.customer : (s.customer as any)?.id;
    if (cid) everPaidIds.add(cid);
  }

  // Monthly growth — bucket completed subs by created month for the last 12
  // months. New = subs created that month; canceled = subs whose canceled_at
  // falls in that month. Net = new - canceled.
  const nowDate = new Date();
  const monthlyGrowth: { month: string; label: string; new: number; canceled: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1);
    const startTs = Math.floor(d.getTime() / 1000);
    const endTs = Math.floor(new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() / 1000);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'short' });
    let newCount = 0;
    let cancelCount = 0;
    for (const s of completedSubs) {
      if (s.created >= startTs && s.created < endTs) newCount += 1;
      const cAt = (s as any).canceled_at as number | null | undefined;
      if (cAt && cAt >= startTs && cAt < endTs) cancelCount += 1;
    }
    monthlyGrowth.push({ month: monthKey, label, new: newCount, canceled: cancelCount });
  }

  // Recent activity feed — only completed subs (not incomplete abandoned ones).
  const recentSubs = completedSubs.slice(0, 20);

  // Lifetime spend per customer = sum of every paid invoice we have on file.
  // Done in parallel since Stripe's rate limit is generous and we cap at 20.
  const customerIds = Array.from(new Set(
    recentSubs
      .map((s) => (typeof s.customer === 'string' ? s.customer : (s.customer as any)?.id))
      .filter(Boolean) as string[]
  ));
  // Pull charges (not invoices) since charges carry the refund data directly.
  // Gross paid = sum of successful charges. Refunded = sum of amount_refunded
  // across all charges. Net = paid - refunded.
  const lifetimeByCustomer: Record<string, { paid: number; refunded: number }> = {};
  // The plan each person is on in the app today, so canceled rows can show
  // they're back on Free.
  const planNowPromise = currentPlansFor(Array.from(new Set(
    recentSubs.map((s) => s.metadata?.user_id).filter(Boolean) as string[]
  ))).catch(() => new Map<string, string>());
  await Promise.all(customerIds.map(async (cid) => {
    try {
      const charges = await stripe.charges.list({ customer: cid, limit: 100 });
      let paid = 0;
      let refunded = 0;
      for (const c of charges.data) {
        if (c.paid && c.status === 'succeeded') paid += c.amount || 0;
        refunded += c.amount_refunded || 0;
      }
      lifetimeByCustomer[cid] = { paid, refunded };
    } catch {
      lifetimeByCustomer[cid] = { paid: 0, refunded: 0 };
    }
  }));
  const planNow = await planNowPromise;

  const recent = recentSubs.map((s) => {
    const priceId = s.items.data[0]?.price?.id;
    const mapped = planFromPriceId(priceId);
    const cust: any = s.customer;
    const customerId = typeof cust === 'string' ? cust : cust?.id || null;
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
      lifetime_spent: customerId ? (lifetimeByCustomer[customerId]?.paid || 0) : 0,
      lifetime_refunded: customerId ? (lifetimeByCustomer[customerId]?.refunded || 0) : 0,
      currency: (s.items.data[0]?.price?.currency || 'usd').toUpperCase(),
      customer_email: typeof cust === 'string' ? null : cust?.email ?? null,
      customer_name: typeof cust === 'string' ? null : cust?.name ?? null,
      cancel_at_period_end: s.cancel_at_period_end || false,
      created: s.created,
      start_date: (s as any).start_date ?? s.created,
      current_period_end: (s as any).current_period_end ?? null,
      canceled_at: (s as any).canceled_at ?? null,
      ended_at: (s as any).ended_at ?? null,
      cancel_reason: cancelReasonOf(s),
      // null when the user was deleted or the subscription has no user tag.
      plan_now: s.metadata?.user_id ? planNow.get(s.metadata.user_id) ?? null : null,
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
      ever_paid_customers: everPaidIds.size,
    },
    planBreakdown: planCounts,
    billingBreakdown: billingCounts,
    monthlyGrowth,
    recent,
  });
}
