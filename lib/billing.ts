import type Stripe from 'stripe';
import { planFromPriceId, type Billing, type PaidPlan } from './stripe';

// Stripe statuses where the customer still has paid access. past_due means
// the card failed and Stripe is retrying; access stays on until retries run
// out (then Stripe moves it to canceled or unpaid).
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export function isLiveSubscription(s: Stripe.Subscription): boolean {
  return LIVE_STATUSES.has(s.status);
}

export function subscriptionPlan(s: Stripe.Subscription): PaidPlan | null {
  const mapped = planFromPriceId(s.items?.data?.[0]?.price?.id);
  const p = mapped?.plan || s.metadata?.plan;
  return p === 'carrier' || p === 'team' || p === 'fleet' ? p : null;
}

export function subscriptionBilling(s: Stripe.Subscription): Billing | null {
  const mapped = planFromPriceId(s.items?.data?.[0]?.price?.id);
  if (mapped) return mapped.billing;
  const interval = s.items?.data?.[0]?.price?.recurring?.interval;
  return interval === 'year' ? 'annual' : interval === 'month' ? 'monthly' : null;
}

export function customerIdOf(s: Stripe.Subscription): string | null {
  const c: any = s.customer;
  return typeof c === 'string' ? c : c?.id || null;
}

// The subscription that decides a customer's plan: an active one beats a
// past_due one, and the newest wins among equals.
export function pickLiveSubscription(subs: Stripe.Subscription[]): Stripe.Subscription | null {
  const live = subs.filter(isLiveSubscription).sort((a, b) => b.created - a.created);
  return live.find((s) => s.status === 'active' || s.status === 'trialing') || live[0] || null;
}

// Every Haulock subscription on the Stripe account (which is shared with
// other products), newest first. Search filters by our metadata tag on
// Stripe's side; it can lag new subscriptions by up to a minute, which is
// fine for admin views. Falls back to listing everything if search fails.
export async function listHaulockSubscriptions(
  stripe: Stripe,
  expand: string[] = [],
  cap = 5000,
): Promise<{ subs: Stripe.Subscription[]; truncated: boolean }> {
  const collect = async (iter: AsyncIterable<Stripe.Subscription>) => {
    const subs: Stripe.Subscription[] = [];
    let truncated = false;
    for await (const s of iter) {
      if (s.metadata?.product !== 'haulock') continue;
      if (subs.length >= cap) { truncated = true; break; }
      subs.push(s);
    }
    return { subs: subs.sort((a, b) => b.created - a.created), truncated };
  };
  try {
    return await collect(stripe.subscriptions.search({ query: "metadata['product']:'haulock'", limit: 100, expand }) as any);
  } catch {
    return collect(stripe.subscriptions.list({ status: 'all', limit: 100, expand }) as any);
  }
}

// IDs of subscriptions that were really paid for (or are live). Checkouts
// that were started and then abandoned or replaced by a retry end up
// canceled without a single paid invoice, and must not count as customers
// or cancellations. Pass subscriptions with `latest_invoice` expanded to
// skip most of the per-subscription invoice lookups.
export async function paidSubscriptionIds(stripe: Stripe, subs: Stripe.Subscription[]): Promise<Set<string>> {
  const paid = new Set<string>();
  const unsure: Stripe.Subscription[] = [];
  for (const s of subs) {
    if (s.status === 'incomplete' || s.status === 'incomplete_expired') continue;
    const inv: any = s.latest_invoice;
    if (isLiveSubscription(s) || (inv && typeof inv === 'object' && inv.status === 'paid')) paid.add(s.id);
    else unsure.push(s);
  }
  for (let i = 0; i < unsure.length; i += 10) {
    await Promise.all(unsure.slice(i, i + 10).map(async (s) => {
      try {
        const r = await stripe.invoices.list({ subscription: s.id, status: 'paid', limit: 1 });
        if (r.data.length) paid.add(s.id);
      } catch { /* leave it out */ }
    }));
  }
  return paid;
}

export type BillingStatus = 'paying' | 'canceling' | 'past_due' | 'canceled' | 'never';

export type UserBilling = {
  status: BillingStatus;
  // Plan on the live subscription, or on the last one for canceled users.
  plan: PaidPlan | null;
  billing: Billing | null;
  amountCents: number | null;
  currency: string;
  subscriptionId: string | null;
  customerId: string | null;
  since: number | null;      // unix seconds the subscription started
  endsAt: number | null;     // canceling: when paid access stops
  canceledAt: number | null; // canceled: when paid access stopped
  // The plan Stripe says this user should have right now.
  expectedPlan: PaidPlan | 'free';
};

// One user's billing picture from their Haulock subscriptions. `paidIds`
// comes from paidSubscriptionIds, so abandoned checkouts read as 'never'.
export function summarizeBilling(subs: Stripe.Subscription[], paidIds: Set<string>): UserBilling {
  const real = subs.filter((s) => paidIds.has(s.id)).sort((a, b) => b.created - a.created);
  const live = pickLiveSubscription(real);
  const s = live || real[0] || null;
  const base: UserBilling = {
    status: 'never', plan: null, billing: null, amountCents: null, currency: 'USD',
    subscriptionId: null, customerId: null, since: null, endsAt: null, canceledAt: null,
    expectedPlan: 'free',
  };
  if (!s) return base;
  const price = s.items?.data?.[0]?.price;
  const any = s as any;
  const info: UserBilling = {
    ...base,
    plan: subscriptionPlan(s),
    billing: subscriptionBilling(s),
    amountCents: price?.unit_amount ?? null,
    currency: (price?.currency || 'usd').toUpperCase(),
    subscriptionId: s.id,
    customerId: customerIdOf(s),
    since: any.start_date ?? s.created,
  };
  if (!live) {
    return { ...info, status: 'canceled', canceledAt: any.ended_at ?? any.canceled_at ?? null };
  }
  const expectedPlan = info.plan || 'free';
  if (live.status === 'past_due') return { ...info, status: 'past_due', expectedPlan };
  if (live.cancel_at_period_end || any.cancel_at) {
    return { ...info, status: 'canceling', endsAt: any.cancel_at ?? any.current_period_end ?? null, expectedPlan };
  }
  return { ...info, status: 'paying', expectedPlan };
}
