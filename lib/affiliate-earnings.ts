// Affiliate earnings — single source of truth for the money math.
// Used by /api/affiliate/stats (one affiliate's view) and
// /api/admin/affiliates (operator's roll-up across all affiliates).
//
// Data flow:
//   1. We read every Stripe subscription tagged `metadata.promo_code = <CODE>`.
//      That metadata is set in /api/stripe/create-subscription on every
//      checkout that uses a promo, so search-by-code is reliable.
//   2. For each subscription we compute commission per the affiliate's
//      configured rule (flat $ per signup OR % of `latest_invoice.amount_paid`,
//      which is already net of the customer's discount).
//   3. The DB layer (affiliate_payouts) tracks how much we've already
//      promised or paid out, so the caller can compute available balance.

import type Stripe from 'stripe';

export type CommissionType = 'flat' | 'percent';

// A single rate is just a type (flat dollars or percent of paid) and a value.
export type CommissionRate = { type: CommissionType; value: number };

// The full commission spec supports two modes:
//   - 'uniform': one rate applied to every redemption regardless of plan
//   - 'per_plan': different rates per <plan>-<billing> key (e.g. carrier-monthly,
//                 carrier-annual, team-monthly, team-annual, fleet-monthly,
//                 fleet-annual). Plans not listed earn $0.
//
// Backward-compat: if `byPlan['carrier-monthly']` is missing but `byPlan['carrier']`
// exists, we fall back to the bare-plan rate. This means older configs that
// pre-date the billing dimension still pay correctly.
//
// Store on user_metadata as separate keys to keep migrations zero-risk:
//   affiliate_commission_mode:    'uniform' | 'per_plan'
//   affiliate_commission_type:    flat|percent  (used when mode==='uniform')
//   affiliate_commission_value:   number        (used when mode==='uniform')
//   affiliate_commission_by_plan: { 'carrier-monthly'?, 'carrier-annual'?, ... }
export type CommissionSpec =
  | { mode: 'uniform'; rate: CommissionRate }
  | { mode: 'per_plan'; byPlan: Partial<Record<string, CommissionRate>> };

export const PLAN_BILLING_KEYS = [
  'carrier-monthly', 'carrier-annual',
  'team-monthly', 'team-annual',
  'fleet-monthly', 'fleet-annual',
] as const;

export function rateForPlan(spec: CommissionSpec, plan: string | null, billing: string | null): CommissionRate | null {
  if (spec.mode === 'uniform') return spec.rate;
  if (!plan) return null;
  // Prefer the most specific key, fall back to bare plan name for legacy configs.
  const billingKey = billing ? `${plan}-${billing}` : null;
  if (billingKey && spec.byPlan[billingKey]) return spec.byPlan[billingKey] || null;
  return spec.byPlan[plan] ?? null;
}

export function commissionFor(spec: CommissionSpec, plan: string | null, billing: string | null, amountPaidCents: number): number {
  const rate = rateForPlan(spec, plan, billing);
  if (!rate) return 0;
  if (rate.type === 'flat') return Math.round(rate.value * 100);
  return Math.round(amountPaidCents * (rate.value / 100));
}

// Build a CommissionSpec from raw user_metadata. Backward-compatible: if
// affiliate_commission_mode is missing we treat it as 'uniform' and use the
// legacy type+value fields.
export function specFromMetadata(meta: any): CommissionSpec {
  const mode = meta?.affiliate_commission_mode === 'per_plan' ? 'per_plan' : 'uniform';
  if (mode === 'per_plan') {
    const raw = meta?.affiliate_commission_by_plan || {};
    const byPlan: Partial<Record<string, CommissionRate>> = {};
    for (const k of Object.keys(raw)) {
      const r = raw[k];
      if (r && (r.type === 'flat' || r.type === 'percent') && Number.isFinite(Number(r.value)) && Number(r.value) > 0) {
        byPlan[k] = { type: r.type, value: Number(r.value) };
      }
    }
    return { mode: 'per_plan', byPlan };
  }
  const type: CommissionType = meta?.affiliate_commission_type === 'percent' ? 'percent' : 'flat';
  const value = Number(meta?.affiliate_commission_value) || 0;
  return { mode: 'uniform', rate: { type, value } };
}

export type Redemption = {
  id: string;
  customerFirstName: string;
  plan: string | null;
  billing: string | null;     // 'monthly' | 'annual' from subscription metadata
  createdAt: string;          // ISO
  status: string;
  amountPaidCents: number;    // what the customer actually paid (post-discount), latest invoice
  earningsCents: number;      // commission this affiliate earned on this redemption
};

export type EarningsResult = {
  redemptions: Redemption[];
  totalRedemptions: number;
  totalEarningsCents: number;
  monthEarningsCents: number;
};

export async function computeAffiliateEarnings(
  stripe: Stripe,
  code: string,
  spec: CommissionSpec,
): Promise<EarningsResult> {
  const redemptions: Redemption[] = [];
  if (!code) return { redemptions, totalRedemptions: 0, totalEarningsCents: 0, monthEarningsCents: 0 };

  const safeCode = code.replace(/'/g, "\\'");

  try {
    let page: any = await stripe.subscriptions.search({
      query: `metadata['promo_code']:'${safeCode}'`,
      limit: 100,
      expand: ['data.customer', 'data.latest_invoice', 'data.items.data.price'],
    });
    while (true) {
      for (const sub of page.data) {
        const customer: any = sub.customer || null;
        const fullName: string = customer?.name || customer?.email || 'Customer';
        // First name only for privacy; if all we have is an email, take the local-part.
        const firstName = (() => {
          const raw = String(fullName).trim();
          if (raw.includes('@')) return raw.split('@')[0];
          return raw.split(/\s+/)[0];
        })();
        const inv: any = sub.latest_invoice || null;
        const amountPaidCents: number = typeof inv?.amount_paid === 'number' ? inv.amount_paid : 0;
        const planMeta: string | null = sub.metadata?.plan
          || sub.items?.data?.[0]?.price?.lookup_key
          || sub.items?.data?.[0]?.price?.nickname
          || null;
        const billingMeta: string | null = sub.metadata?.billing || null;
        const earningsCents = commissionFor(spec, planMeta, billingMeta, amountPaidCents);
        redemptions.push({
          id: sub.id,
          customerFirstName: firstName,
          plan: planMeta,
          billing: billingMeta,
          createdAt: new Date(sub.created * 1000).toISOString(),
          status: sub.status,
          amountPaidCents,
          earningsCents,
        });
      }
      if (!page.has_more) break;
      page = await stripe.subscriptions.search({
        query: `metadata['promo_code']:'${safeCode}'`,
        limit: 100,
        page: page.next_page,
        expand: ['data.customer', 'data.latest_invoice', 'data.items.data.price'],
      });
    }
  } catch (err: any) {
    console.error('[affiliate-earnings] Stripe search failed', err?.message);
    // Fall through with whatever we collected so far.
  }

  redemptions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const now = new Date();
  const monthStartIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const totalEarningsCents = redemptions.reduce((s, r) => s + r.earningsCents, 0);
  const monthEarningsCents = redemptions
    .filter((r) => r.createdAt >= monthStartIso)
    .reduce((s, r) => s + r.earningsCents, 0);

  return {
    redemptions,
    totalRedemptions: redemptions.length,
    totalEarningsCents,
    monthEarningsCents,
  };
}

// Minimum payout request: $100 in cents.
export const PAYOUT_MIN_CENTS = 10_000;
// Promised payout window after request → expected pay date in the UI.
export const PAYOUT_WINDOW_DAYS = 30;
