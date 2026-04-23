import Stripe from 'stripe';
import type { PlanId } from './plans';

let cached: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  cached = new Stripe(key, { apiVersion: '2025-01-27.acacia' as any });
  return cached;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export type Billing = 'monthly' | 'annual';
export type PaidPlan = Exclude<PlanId, 'free'>;

// Resolve a Price ID for (plan, billing) from env vars.
export function priceIdFor(plan: PaidPlan, billing: Billing): string | null {
  const key = `STRIPE_PRICE_${plan.toUpperCase()}_${billing.toUpperCase()}`;
  return process.env[key] || null;
}

// Reverse lookup: given a Price ID that a webhook delivered, return our (plan, billing).
export function planFromPriceId(priceId: string | null | undefined): { plan: PaidPlan; billing: Billing } | null {
  if (!priceId) return null;
  const plans: PaidPlan[] = ['carrier', 'team', 'fleet'];
  const billings: Billing[] = ['monthly', 'annual'];
  for (const p of plans) {
    for (const b of billings) {
      if (priceIdFor(p, b) === priceId) return { plan: p, billing: b };
    }
  }
  return null;
}

// Common metadata we tag on every Haulock Stripe object so the webhook
// can ignore events that belong to other businesses on the same account.
export const HAULOCK_TAG = { product: 'haulock' } as const;
