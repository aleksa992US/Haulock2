import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { getStripe, planFromPriceId } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Returns the user's REAL subscription state as Stripe sees it, bypassing
// whatever stale value lives in user_metadata. Also syncs the metadata if
// it drifted (e.g. webhook fired to prod but this is local).
export async function GET() {
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me?.email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const svc = getServiceSupabase();

  // Resolve customer id: prefer the one in metadata; otherwise look up by email.
  let customerId: string | null = (me.user_metadata?.stripe_customer_id as string) || null;
  if (!customerId) {
    const match = await stripe.customers.list({ email: me.email, limit: 1 });
    customerId = match.data[0]?.id || null;
    if (customerId && svc) {
      await svc.auth.admin.updateUserById(me.id, {
        user_metadata: { ...(me.user_metadata || {}), stripe_customer_id: customerId },
      });
    }
  }

  if (!customerId) {
    return NextResponse.json({
      hasSubscription: false,
      customerId: null,
      plan: 'free',
      message: 'No Stripe customer record yet — subscribe to activate billing.',
    });
  }

  // Pull all non-canceled subs for this customer.
  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10, expand: ['data.latest_invoice'] });
  const active = subs.data.find((s) => s.status === 'active' || s.status === 'trialing' || s.status === 'past_due');

  if (!active) {
    return NextResponse.json({
      hasSubscription: false,
      customerId,
      plan: 'free',
      message: 'No active Stripe subscription.',
    });
  }

  const priceId = active.items.data[0]?.price?.id;
  const mapped = planFromPriceId(priceId);
  const amount = active.items.data[0]?.price?.unit_amount ?? null;
  const currency = (active.items.data[0]?.price?.currency || 'usd').toUpperCase();
  const interval = active.items.data[0]?.price?.recurring?.interval ?? null;
  const metaPlan = active.metadata?.plan;

  // Sync user_metadata to match reality.
  const resolvedPlan = mapped?.plan || metaPlan || 'free';
  if (svc && me.user_metadata?.plan !== resolvedPlan) {
    await svc.auth.admin.updateUserById(me.id, {
      user_metadata: {
        ...(me.user_metadata || {}),
        plan: resolvedPlan,
        plan_changed_at: new Date().toISOString(),
        stripe_customer_id: customerId,
      },
    });
  }

  const periodEnd = (active as any).current_period_end ?? null;
  const cancelAt = (active as any).cancel_at ?? null;
  const latestInvoice = active.latest_invoice as any;

  // Actual amount paid on the most recent invoice (post-discount, post-tax).
  // This is the truthful "you paid $X" value. `amount` above is the list price.
  const lastPaidAmount: number | null = latestInvoice?.amount_paid ?? latestInvoice?.amount_due ?? null;

  // Active coupon / discount info (if any). Stripe stores it on the subscription.
  const discount: any = (active as any).discount;
  const discountInfo = discount?.coupon
    ? {
        code: discount.promotion_code || null,
        name: discount.coupon.name || null,
        percentOff: discount.coupon.percent_off ?? null,
        amountOffCents: discount.coupon.amount_off ?? null,
        duration: discount.coupon.duration, // 'once' | 'repeating' | 'forever'
        durationInMonths: discount.coupon.duration_in_months ?? null,
      }
    : null;

  return NextResponse.json({
    hasSubscription: true,
    customerId,
    subscriptionId: active.id,
    status: active.status,
    plan: resolvedPlan,
    billing: mapped?.billing || (interval === 'year' ? 'annual' : 'monthly'),
    amount,                 // list price (pre-discount), in cents
    lastPaidAmount,         // what the customer actually paid on last invoice, in cents
    discount: discountInfo,
    currency,
    interval,
    cancelAtPeriodEnd: active.cancel_at_period_end || false,
    cancelAt,
    currentPeriodEnd: periodEnd,
    latestInvoiceStatus: latestInvoice?.status ?? null,
    latestInvoiceUrl: latestInvoice?.hosted_invoice_url ?? null,
  });
}
