import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { pickLiveSubscription, subscriptionPlan } from '@/lib/billing';
import { applyUserPlan } from '@/lib/teams';
import { getServiceSupabase } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Webhooks need the raw body for signature verification — don't cache or parse.

function haulockMeta(obj: any): { isHaulock: boolean; userId?: string; plan?: string } {
  const m = obj?.metadata || {};
  return {
    isHaulock: m.product === 'haulock',
    userId: m.user_id,
    plan: m.plan,
  };
}

// Re-derive the user's plan from ALL of the customer's Haulock subscriptions
// instead of trusting the one event. Events can arrive out of order, and a
// customer can have an abandoned or canceled subscription next to a live one
// (deleting the old one must not drop them to free). No live subscription
// means free.
async function syncPlanFromStripe(stripe: Stripe, userId: string, customer: string | Stripe.Customer | Stripe.DeletedCustomer | null) {
  const customerId = typeof customer === 'string' ? customer : customer?.id;
  if (!customerId) return;
  // The account may have been deleted while the subscription lives on.
  // Answer 200 so Stripe doesn't retry (and eventually disable the
  // endpoint); the admin Users page shows these subscriptions.
  const svc = getServiceSupabase();
  if (svc) {
    const { data, error } = await svc.auth.admin.getUserById(userId);
    if (error && (error as any).status !== 404) throw error;
    if (!data?.user) {
      console.warn(`[stripe webhook] user ${userId} no longer exists; plan not changed (customer ${customerId})`);
      return;
    }
  }
  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
  const live = pickLiveSubscription(subs.data.filter((s) => s.metadata?.product === 'haulock'));
  const plan = (live && (subscriptionPlan(live) || haulockMeta(live).plan)) || 'free';
  await applyUserPlan(userId, plan);
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

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const meta = haulockMeta(sub);
        if (!meta.isHaulock || !meta.userId) break;
        // Unpaid checkout attempts never granted a plan, so they can't change one.
        if (sub.status === 'incomplete' || sub.status === 'incomplete_expired') break;
        await syncPlanFromStripe(stripe, meta.userId, sub.customer);
        break;
      }

      case 'invoice.payment_succeeded': {
        // First successful payment on a default_incomplete subscription transitions it to active.
        const invoice = event.data.object as Stripe.Invoice;
        // Subscription invoices don't carry the subscription's metadata on
        // `metadata`; Stripe copies it to subscription_details (moved under
        // `parent` in newer API versions).
        const inv: any = invoice;
        const meta = haulockMeta({
          metadata: inv.subscription_details?.metadata || inv.parent?.subscription_details?.metadata || inv.metadata,
        });
        if (!meta.isHaulock || !meta.userId) break;
        if (invoice.billing_reason === 'subscription_create') {
          await syncPlanFromStripe(stripe, meta.userId, invoice.customer);
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
  } catch (err: any) {
    // A 500 makes Stripe retry the event, so a failed plan write isn't lost.
    console.error(`[stripe webhook] ${event.type} failed:`, err?.message);
    return NextResponse.json({ error: 'Plan sync failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
