// Seasonal sale campaigns. A campaign is live between `start` and `end` (UTC
// instants); while it is, the site shows its banner and sale prices, and
// checkout applies its Stripe promotion code by itself to the billing period
// the campaign is for.
//
// The discount itself lives in Stripe: a coupon (percent off; "repeating"
// for `months` months on a monthly campaign, "once" on an annual one; redeem
// by `end`) and a promotion code named `code` on it. Until that code exists,
// checkout falls back to full price, so nothing breaks if the site goes live
// first.
//
// NEXT_PUBLIC_PROMO_PREVIEW=<campaign id>[,<id>] shows campaigns outside their dates
// (for checking a preview deploy). Never set it in production.

import { PLANS, type PlanId } from './plans';

export type Campaign = {
  id: string;
  code: string;          // Stripe promotion code
  billing: 'monthly' | 'annual'; // the only billing period the code applies to
  percentOff: number;
  months?: number;       // monthly: the discount repeats for this many invoices
  start: string;         // ISO instant, inclusive
  end: string;           // ISO instant, exclusive
  name: string;          // "Black Friday"
  headline: string;      // banner line
  endsLabel: string;     // "ends Sunday"
};

export const CAMPAIGNS: Campaign[] = [
  {
    id: 'blackfriday',
    code: 'BLACKFRIDAY40',
    billing: 'monthly',
    percentOff: 40,
    months: 3,
    start: '2026-11-23T05:00:00Z', // Mon Nov 23, 00:00 ET (early start)
    end: '2026-11-30T05:00:00Z',   // Mon Nov 30, 00:00 ET (through Sunday)
    name: 'Black Friday',
    headline: '40% off your first 3 months',
    endsLabel: 'ends Sunday',
  },
  {
    id: 'cybermonday',
    code: 'CYBER50',
    billing: 'annual',
    percentOff: 50,
    start: '2026-11-23T05:00:00Z', // Mon Nov 23, 00:00 ET (alongside Black Friday)
    end: '2026-12-01T05:00:00Z',   // Tue Dec 1, 00:00 ET (through Cyber Monday)
    name: 'Cyber Monday',
    headline: 'A full year for the price of 6 months',
    endsLabel: 'ends Monday',
  },
];

// Which billing period each sale code is limited to. A "first 3 months"
// coupon on an annual invoice would take 40% off the whole year; a one-time
// 50% annual coupon on a monthly plan would be one cheap month.
export const CODE_BILLING = new Map(CAMPAIGNS.map((c) => [c.code.toUpperCase(), c.billing] as const));

// Every sale live now (they can overlap: a monthly one and an annual one),
// in CAMPAIGNS order.
export function liveCampaigns(now: number = Date.now()): Campaign[] {
  const preview = process.env.NEXT_PUBLIC_PROMO_PREVIEW;
  if (preview) {
    const ids = preview.split(',').map((s) => s.trim());
    const list = CAMPAIGNS.filter((x) => ids.includes(x.id));
    if (list.length) return list;
  }
  return CAMPAIGNS.filter((c) => now >= Date.parse(c.start) && now < Date.parse(c.end));
}

// The live sale for one billing period, if any.
export function campaignFor(billing: 'monthly' | 'annual', now: number = Date.now()): Campaign | null {
  return liveCampaigns(now).find((c) => c.billing === billing) || null;
}

const money = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return `$${Number.isInteger(r) ? r.toLocaleString('en-US') : r.toFixed(2)}`;
};

// The sale price for a plan, in the campaign's billing period ("$29.40" a
// month, or "$245" a year), or null for Free.
export function salePrice(planId: PlanId, c: Campaign): string | null {
  const p = PLANS[planId];
  if (!p || !p.priceNum) return null;
  const list = c.billing === 'annual' ? p.priceAnnualNum : p.priceNum;
  return money((list * (100 - c.percentOff)) / 100);
}

// Where the banner's button sends a signed-in user.
export const checkoutPath = (planId: PlanId, c: Campaign) => `/checkout/${planId}${c.billing === 'annual' ? '?billing=annual' : ''}`;

// The sale emails, sent once each by /api/cron/sale-emails (hourly) to Free
// users who get marketing email: in the hours after `at`, while the
// campaign is still live. `kind` keys the email_log row that stops a resend.
// An email without `at` is never sent by the schedule, only by hand
// (?stage=<stage>), once someone has signed off on it.
export type SaleEmail = { stage: 'early-launch' | 'bf-launch' | 'cm-launch' | 'cm-last'; campaign: string; at?: string; kind: 'sale_early' | 'sale_bf' | 'sale_cm' | 'sale_cm_last' };
export const SALE_EMAILS: SaleEmail[] = [
  { stage: 'early-launch', campaign: 'blackfriday', at: '2026-11-24T14:00:00Z', kind: 'sale_early' }, // Tue 9am ET: both offers + new checks
  { stage: 'bf-launch', campaign: 'blackfriday', at: '2026-11-27T14:00:00Z', kind: 'sale_bf' },      // Fri 9am ET
  { stage: 'cm-launch', campaign: 'cybermonday', at: '2026-11-30T14:00:00Z', kind: 'sale_cm' },      // Mon 9am ET
  { stage: 'cm-last', campaign: 'cybermonday', at: '2026-11-30T23:00:00Z', kind: 'sale_cm_last' },   // Mon 6pm ET
];
export const SALE_EMAIL_WINDOW_HOURS = 4;

// The email due now, if any (never one whose campaign has ended).
export function dueSaleEmail(now: number = Date.now()): SaleEmail | null {
  return SALE_EMAILS.find((e) => {
    if (!e.at) return false;
    const at = Date.parse(e.at);
    const c = CAMPAIGNS.find((x) => x.id === e.campaign);
    return c && now >= at && now < at + SALE_EMAIL_WINDOW_HOURS * 3600_000 && now < Date.parse(c.end);
  }) || null;
}
