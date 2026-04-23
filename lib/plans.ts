export type PlanId = 'free' | 'carrier' | 'fleet';

export type PlanLimits = {
  fmcsaLookups: number | null; // null = unlimited
  rateConScans: number | null;
  watchlist: number | null;
  users: number;
};

export type Plan = {
  id: PlanId;
  label: string;
  price: string;
  priceNum: number;
  desc: string;
  limits: PlanLimits;
  features: string[];
  popular?: boolean;
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    label: 'Free',
    price: '$0',
    priceNum: 0,
    desc: '5 lookups/month. Basic risk score.',
    limits: { fmcsaLookups: 5, rateConScans: 1, watchlist: 3, users: 1 },
    features: [
      '5 broker lookups / month',
      '1 rate con scan / month',
      'Up to 3 watchlist entries',
      'Basic risk score',
      'Community feed (read-only)',
    ],
  },
  carrier: {
    id: 'carrier',
    label: 'Carrier',
    price: '$49',
    priceNum: 49,
    desc: 'For owner-ops & small fleets.',
    popular: true,
    limits: { fmcsaLookups: null, rateConScans: 25, watchlist: 25, users: 1 },
    features: [
      'Unlimited broker lookups',
      '25 rate con scans / month',
      'Up to 25 watchlist entries',
      'Full risk reports',
      'Email & in-app alerts',
      '1 user',
    ],
  },
  fleet: {
    id: 'fleet',
    label: 'Fleet',
    price: '$149',
    priceNum: 149,
    desc: 'Growing carriers, 10–150 trucks.',
    limits: { fmcsaLookups: null, rateConScans: 250, watchlist: 250, users: 5 },
    features: [
      'Unlimited broker lookups',
      '250 rate con scans / month',
      'Up to 250 watchlist entries',
      'Everything in Carrier',
      'Bulk verify (CSV)',
      'API access',
      '5 users',
      'Priority support',
    ],
  },
};

export function getPlan(id?: string | null): Plan {
  const norm = (id || '').toLowerCase() as PlanId;
  return PLANS[norm] || PLANS.free;
}

export function monthStart(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function formatLimit(n: number | null): string {
  return n == null ? 'Unlimited' : n.toLocaleString();
}
