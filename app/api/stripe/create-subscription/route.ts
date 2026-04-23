import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { getStripe, priceIdFor, HAULOCK_TAG, type Billing, type PaidPlan } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isPaidPlan(x: any): x is PaidPlan {
  return x === 'carrier' || x === 'team' || x === 'fleet';
}

function isBilling(x: any): x is Billing {
  return x === 'monthly' || x === 'annual';
}

export async function POST(req: Request) {
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: 'Stripe is not configured on the server.' }, { status: 500 });

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me?.email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => null) as { plan?: string; billing?: string; promoCode?: string } | null;
  if (!body || !isPaidPlan(body.plan) || !isBilling(body.billing)) {
    return NextResponse.json({ error: 'Missing or invalid plan/billing' }, { status: 400 });
  }
  const promoCodeRaw = typeof body.promoCode === 'string' ? body.promoCode.trim() : '';

  // Resolve promotion code → coupon ID if provided. Validate it's active.
  let couponId: string | null = null;
  if (promoCodeRaw) {
    try {
      const list = await stripe.promotionCodes.list({ code: promoCodeRaw, active: true, limit: 1 });
      const promo: any = list.data[0];
      if (!promo) {
        return NextResponse.json({ error: `Promo code "${promoCodeRaw}" is not valid or has expired.` }, { status: 400 });
      }
      couponId = typeof promo.coupon === 'string' ? promo.coupon : promo.coupon?.id || null;
      if (!couponId) {
        return NextResponse.json({ error: `Promo code "${promoCodeRaw}" has no coupon attached.` }, { status: 400 });
      }
    } catch (err: any) {
      return NextResponse.json({ error: `Could not validate promo code: ${err?.message || 'unknown error'}` }, { status: 400 });
    }
  }

  const price = priceIdFor(body.plan, body.billing);
  if (!price) {
    return NextResponse.json({
      error: `No Stripe Price ID configured for ${body.plan}/${body.billing}. Set STRIPE_PRICE_${body.plan.toUpperCase()}_${body.billing.toUpperCase()} in your env.`,
    }, { status: 500 });
  }

  // Reuse an existing Stripe customer id stored on the user, or create one.
  const svc = getServiceSupabase();
  let customerId: string | null = (me.user_metadata?.stripe_customer_id as string) || null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: me.email,
      name: me.user_metadata?.full_name || me.user_metadata?.name || undefined,
      metadata: { ...HAULOCK_TAG, user_id: me.id },
    });
    customerId = customer.id;
    if (svc) {
      await svc.auth.admin.updateUserById(me.id, {
        user_metadata: { ...(me.user_metadata || {}), stripe_customer_id: customerId },
      });
    }
  }

  // Create a subscription in "default_incomplete" state and expand the initial
  // invoice's PaymentIntent so we can hand its client_secret to the Payment Element.
  const subscription = await stripe.subscriptions.create({
    customer: customerId!,
    items: [{ price }],
    ...(couponId ? { coupon: couponId } : {}),
    payment_behavior: 'default_incomplete',
    payment_settings: {
      save_default_payment_method: 'on_subscription',
      payment_method_types: ['card'],
    },
    expand: ['latest_invoice.payment_intent'],
    metadata: {
      ...HAULOCK_TAG,
      user_id: me.id,
      plan: body.plan,
      billing: body.billing,
      ...(promoCodeRaw ? { promo_code: promoCodeRaw } : {}),
    },
    description: `Haulock ${body.plan} (${body.billing})`,
  });

  const invoice = subscription.latest_invoice as any;
  const pi = invoice?.payment_intent;

  // Pull the invoice's actual totals so the client can show real numbers
  // (subtotal, discount, tax, total due) — not just the plan's list price.
  const totals = {
    currency: (invoice?.currency || 'usd').toUpperCase(),
    subtotal: invoice?.subtotal ?? null,       // pre-discount, in cents
    discount: invoice?.total_discount_amounts?.reduce((s: number, d: any) => s + (d.amount || 0), 0) ?? 0,
    tax: invoice?.tax ?? 0,
    total: invoice?.total ?? null,             // final amount charged, in cents
    amountDue: invoice?.amount_due ?? null,
  };

  // 100%-off coupon path: invoice is $0, no PaymentIntent created, subscription
  // is already active. Skip straight past the Payment Element.
  if (!pi && (subscription.status === 'active' || subscription.status === 'trialing')) {
    return NextResponse.json({
      subscriptionId: subscription.id,
      plan: body.plan,
      billing: body.billing,
      noPaymentNeeded: true,
      customerId,
      totals,
    });
  }

  if (!pi?.client_secret) {
    return NextResponse.json({ error: 'Stripe did not return a client secret — try again.' }, { status: 500 });
  }

  // Brand the card statement with HAULOCK — independent of the legal entity name on the Stripe account.
  try {
    await stripe.paymentIntents.update(pi.id, {
      statement_descriptor_suffix: 'HAULOCK',
      metadata: { ...HAULOCK_TAG, user_id: me.id, plan: body.plan, billing: body.billing },
    });
  } catch { /* non-fatal */ }

  return NextResponse.json({
    subscriptionId: subscription.id,
    clientSecret: pi.client_secret,
    customerId,
    plan: body.plan,
    billing: body.billing,
    totals,
  });
}
