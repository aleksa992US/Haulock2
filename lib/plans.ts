export type PlanId = 'free' | 'carrier' | 'team' | 'fleet';

export type PlanLimits = {
  fmcsaLookups: number | null; // null = unlimited
  rateConScans: number | null;
  pdfForensics: number | null;
  watchlist: number | null;
  users: number;
};

export type Plan = {
  id: PlanId;
  label: string;
  price: string;          // display monthly
  priceNum: number;       // monthly, in dollars
  priceAnnual: string;    // display annual total
  priceAnnualNum: number; // annual, in dollars
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
    priceAnnual: '$0',
    priceAnnualNum: 0,
    desc: 'Try it. 3 lookups/month.',
    limits: { fmcsaLookups: 3, rateConScans: 0, pdfForensics: 3, watchlist: 1, users: 1 },
    features: [
      '3 broker / carrier lookups / month',
      '3 PDF tamper detections / month',
      '1 watchlist entry',
      'Basic risk score',
      'Web reputation scan across 50+ trusted sources',
      'No rate con scans (upgrade for AI extraction)',
    ],
  },
  carrier: {
    id: 'carrier',
    label: 'Carrier',
    price: '$49',
    priceNum: 49,
    priceAnnual: '$490',
    priceAnnualNum: 490,
    desc: 'For owner-ops & 1-truck shops.',
    popular: true,
    limits: { fmcsaLookups: null, rateConScans: 15, pdfForensics: null, watchlist: 25, users: 1 },
    features: [
      'Unlimited broker / carrier lookups',
      '15 rate con scans / month',
      'Unlimited PDF tamper detection',
      'Up to 25 watchlist entries',
      'Full risk reports',
      'Email & in-app alerts',
      'API access',
      '1 user',
    ],
  },
  team: {
    id: 'team',
    label: 'Team',
    price: '$99',
    priceNum: 99,
    priceAnnual: '$990',
    priceAnnualNum: 990,
    desc: 'Small fleets & dispatch shops (2–9 trucks).',
    limits: { fmcsaLookups: null, rateConScans: 75, pdfForensics: null, watchlist: 100, users: 3 },
    features: [
      'Everything in Carrier',
      '75 rate con scans / month',
      'Unlimited PDF tamper detection',
      'Up to 100 watchlist entries',
      '3 users (shared quota)',
      'Priority email alerts',
      'Watchlist change-history reports',
    ],
  },
  fleet: {
    id: 'fleet',
    label: 'Fleet',
    price: '$249',
    priceNum: 249,
    priceAnnual: '$2,490',
    priceAnnualNum: 2490,
    desc: 'Growing carriers & brokerages (10+ trucks).',
    limits: { fmcsaLookups: null, rateConScans: 500, pdfForensics: null, watchlist: null, users: 10 },
    features: [
      'Everything in Team',
      '500 rate con scans / month',
      'Unlimited PDF tamper detection',
      'Unlimited watchlist entries',
      '10 users',
      'Bulk verify (CSV)',
      'Priority support',
      'Quarterly fraud trend report',
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
