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

// Cancels, right away, every live Haulock subscription on the customer (by
// id) and on any customer with this email. Run before deleting an account,
// so a deleted account can't keep being charged. Only touches subscriptions
// tagged product=haulock (the Stripe account is shared). Throws if Stripe
// fails, so the caller can stop instead of deleting.
export async function cancelLiveHaulockSubscriptions(
  stripe: Stripe,
  opts: { customerId?: string | null; email?: string | null },
): Promise<string[]> {
  const customerIds = new Set<string>(opts.customerId ? [opts.customerId] : []);
  if (opts.email) {
    const found = await stripe.customers.list({ email: opts.email, limit: 10 });
    for (const c of found.data) customerIds.add(c.id);
  }
  const canceled: string[] = [];
  for (const cid of Array.from(customerIds)) {
    const subs = await stripe.subscriptions.list({ customer: cid, status: 'all', limit: 100 });
    for (const s of subs.data) {
      if (s.metadata?.product !== 'haulock') continue;
      if (!['active', 'trialing', 'past_due', 'unpaid'].includes(s.status)) continue;
      await stripe.subscriptions.cancel(s.id);
      canceled.push(s.id);
    }
  }
  return canceled;
}

export type Lifetime = { paid: number; refunded: number };

// Money each subscription has collected, in cents: paid invoices, and what
// was refunded on their charges (same rules as the Revenue card in
// lib/revenue.ts). One invoice listing per subscription, ten at a time.
export async function lifetimeBySubscription(stripe: Stripe, subIds: string[]): Promise<Map<string, Lifetime>> {
  const out = new Map<string, Lifetime>();
  for (let i = 0; i < subIds.length; i += 10) {
    await Promise.all(subIds.slice(i, i + 10).map(async (id) => {
      const t: Lifetime = { paid: 0, refunded: 0 };
      for await (const inv of stripe.invoices.list({ subscription: id, status: 'paid', limit: 100, expand: ['data.charge'] }) as any) {
        const amount = Number(inv.amount_paid) || 0;
        if (amount <= 0) continue;
        const charge: any = inv.charge && typeof inv.charge === 'object' ? inv.charge : null;
        t.paid += amount;
        t.refunded += Math.min(amount, Number(charge?.amount_refunded) || 0);
      }
      out.set(id, t);
    }));
  }
  return out;
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
  since: number | null;             // unix seconds this subscription started
  firstSubscribedAt: number | null; // their first paid subscription ever
  canceledAt: number | null;        // when they (or Stripe) canceled
  endsAt: number | null;            // canceling: when paid access stops
  periodEnd: number | null;         // live: when the current paid period ends
  endedAt: number | null;           // canceled: when paid access stopped
  cancelReason: string | null;      // from Stripe's cancellation details
  lifetimePaidCents: number;        // every paid Haulock invoice, all their subscriptions
  lifetimeRefundedCents: number;
  // The plan Stripe says this user should have right now.
  expectedPlan: PaidPlan | 'free';
};

// Labels for the answers Stripe's customer portal collects on cancel.
const CANCEL_FEEDBACK: Record<string, string> = {
  too_expensive: 'Too expensive',
  missing_features: 'Missing features',
  switched_service: 'Switched to another service',
  unused: 'Not using it enough',
  customer_service: 'Customer service',
  too_complex: 'Too complicated',
  low_quality: 'Quality issues',
  other: 'Other',
};

export function cancelReasonOf(s: Stripe.Subscription): string | null {
  const d: any = (s as any).cancellation_details;
  if (!d) return null;
  const parts: string[] = [];
  if (d.reason === 'payment_failed') parts.push('Payment failed');
  else if (d.reason === 'payment_disputed') parts.push('Payment disputed');
  if (d.feedback) parts.push(CANCEL_FEEDBACK[d.feedback] || d.feedback);
  if (d.comment) parts.push(`“${String(d.comment).trim()}”`);
  return parts.length ? parts.join(' · ') : null;
}

// One user's billing picture from their Haulock subscriptions. `paidIds`
// comes from paidSubscriptionIds, so abandoned checkouts read as 'never';
// `lifetime` from lifetimeBySubscription.
export function summarizeBilling(subs: Stripe.Subscription[], paidIds: Set<string>, lifetime?: Map<string, Lifetime>): UserBilling {
  const real = subs.filter((s) => paidIds.has(s.id)).sort((a, b) => b.created - a.created);
  const live = pickLiveSubscription(real);
  const s = live || real[0] || null;
  const base: UserBilling = {
    status: 'never', plan: null, billing: null, amountCents: null, currency: 'USD',
    subscriptionId: null, customerId: null, since: null, firstSubscribedAt: null,
    canceledAt: null, endsAt: null, periodEnd: null, endedAt: null, cancelReason: null,
    lifetimePaidCents: real.reduce((n, x) => n + (lifetime?.get(x.id)?.paid || 0), 0),
    lifetimeRefundedCents: real.reduce((n, x) => n + (lifetime?.get(x.id)?.refunded || 0), 0),
    expectedPlan: 'free',
  };
  if (!s) return base;
  const price = s.items?.data?.[0]?.price;
  const any = s as any;
  const startOf = (x: Stripe.Subscription) => (x as any).start_date ?? x.created;
  const info: UserBilling = {
    ...base,
    plan: subscriptionPlan(s),
    billing: subscriptionBilling(s),
    amountCents: price?.unit_amount ?? null,
    currency: (price?.currency || 'usd').toUpperCase(),
    subscriptionId: s.id,
    customerId: customerIdOf(s),
    since: startOf(s),
    firstSubscribedAt: Math.min(...real.map(startOf)),
  };
  if (!live) {
    return {
      ...info,
      status: 'canceled',
      canceledAt: any.canceled_at ?? any.ended_at ?? null,
      endedAt: any.ended_at ?? any.canceled_at ?? null,
      cancelReason: cancelReasonOf(s),
    };
  }
  const expectedPlan = info.plan || 'free';
  info.periodEnd = any.current_period_end ?? null;
  if (live.status === 'past_due') return { ...info, status: 'past_due', expectedPlan };
  if (live.cancel_at_period_end || any.cancel_at) {
    return {
      ...info,
      status: 'canceling',
      canceledAt: any.canceled_at ?? null,
      endsAt: any.cancel_at ?? any.current_period_end ?? null,
      cancelReason: cancelReasonOf(live),
      expectedPlan,
    };
  }
  return { ...info, status: 'paying', expectedPlan };
}
