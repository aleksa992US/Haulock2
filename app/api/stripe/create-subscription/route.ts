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

  const body = await req.json().catch(() => null) as { plan?: string; billing?: string } | null;
  if (!body || !isPaidPlan(body.plan) || !isBilling(body.billing)) {
    return NextResponse.json({ error: 'Missing or invalid plan/billing' }, { status: 400 });
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
    payment_behavior: 'default_incomplete',
    payment_settings: {
      save_default_payment_method: 'on_subscription',
      payment_method_types: ['card'],
    },
    expand: ['latest_invoice.payment_intent'],
    metadata: { ...HAULOCK_TAG, user_id: me.id, plan: body.plan, billing: body.billing },
    description: `Haulock ${body.plan} (${body.billing})`,
  });

  const invoice = subscription.latest_invoice as any;
  const pi = invoice?.payment_intent;
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
  });
}
