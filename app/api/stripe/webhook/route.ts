import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe, planFromPriceId } from '@/lib/stripe';
import { getServiceSupabase } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Webhooks need the raw body for signature verification — don't cache or parse.

async function setUserPlan(userId: string, plan: string) {
  const svc = getServiceSupabase();
  if (!svc) return;
  const { data } = await svc.auth.admin.getUserById(userId);
  const prev = data?.user?.user_metadata || {};
  await svc.auth.admin.updateUserById(userId, {
    user_metadata: { ...prev, plan, plan_changed_at: new Date().toISOString() },
  });
}

function haulockMeta(obj: any): { isHaulock: boolean; userId?: string; plan?: string } {
  const m = obj?.metadata || {};
  return {
    isHaulock: m.product === 'haulock',
    userId: m.user_id,
    plan: m.plan,
  };
}

export async function POST(req: Request) {
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });

  const sig = req.headers.get('stripe-signature') || '';
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err: any) {
    console.error('[stripe webhook] signature verification failed:', err?.message);
    return NextResponse.json({ error: `Webhook signature verification failed: ${err?.message}` }, { status: 400 });
  }

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const meta = haulockMeta(sub);
      if (!meta.isHaulock || !meta.userId) break;

      // Derive plan: prefer the Price ID mapping (authoritative), fall back to metadata.
      const priceId = sub.items.data[0]?.price?.id;
      const mapped = planFromPriceId(priceId);
      const nextPlan = mapped?.plan || meta.plan || 'free';

      // Activate only when the subscription is fully active.
      if (sub.status === 'active' || sub.status === 'trialing') {
        await setUserPlan(meta.userId, nextPlan);
      } else if (sub.status === 'canceled' || sub.status === 'unpaid' || sub.status === 'incomplete_expired') {
        await setUserPlan(meta.userId, 'free');
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const meta = haulockMeta(sub);
      if (!meta.isHaulock || !meta.userId) break;
      await setUserPlan(meta.userId, 'free');
      break;
    }

    case 'invoice.payment_succeeded': {
      // First successful payment on a default_incomplete subscription transitions it to active.
      const invoice = event.data.object as Stripe.Invoice;
      const meta = haulockMeta(invoice);
      if (!meta.isHaulock || !meta.userId) break;
      if (invoice.billing_reason === 'subscription_create') {
        // Stripe SDK v22 changed InvoiceLineItem — the price id can live on
        // `line.price.id` (older shape) or `line.pricing.price_details.price`
        // (newer shape). Read both defensively.
        const line: any = invoice.lines?.data?.[0];
        const priceId: string | undefined =
          line?.price?.id || line?.pricing?.price_details?.price;
        const mapped = planFromPriceId(priceId);
        const nextPlan = mapped?.plan || meta.plan || 'free';
        await setUserPlan(meta.userId, nextPlan);
      }
      break;
    }

    case 'invoice.payment_failed': {
      // Leave the plan where it is; Stripe will retry. Could send an email here later.
      break;
    }

    default:
      // Ignore everything else — keeps noise down.
      break;
  }

  return NextResponse.json({ received: true });
}
