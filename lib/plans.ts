import { COI_CHECK_ON } from './features';

export type PlanId = 'free' | 'carrier' | 'team' | 'fleet';

export type PlanLimits = {
  fmcsaLookups: number | null; // null = unlimited
  rateConScans: number | null;
  // AI insurance-certificate (COI) checks against FMCSA filings.
  coiChecks: number | null;
  pdfForensics: number | null;
  // Load planner: new loads planned per month (re-planning the same pickup →
  // delivery within 24 hours doesn't count again).
  loadPlans: number | null;
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

// COI lines appear on the pricing cards only once the feature launches.
const coi = (line: string): string[] => (COI_CHECK_ON ? [line] : []);

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    label: 'Free',
    price: '$0',
    priceNum: 0,
    priceAnnual: '$0',
    priceAnnualNum: 0,
    desc: 'Try it. 3 lookups/month.',
    limits: { fmcsaLookups: 3, rateConScans: 0, coiChecks: 0, pdfForensics: 3, loadPlans: 10, watchlist: 1, users: 1 },
    features: [
      '3 broker / carrier lookups / month',
      '3 PDF tamper detections / month',
      '10 load plans / month (empty miles, fuel, profit)',
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
    limits: { fmcsaLookups: null, rateConScans: 15, coiChecks: 25, pdfForensics: null, loadPlans: null, watchlist: 25, users: 1 },
    features: [
      'Unlimited broker / carrier lookups',
      '15 rate con scans / month',
      ...coi('25 COI checks / month'),
      'Unlimited PDF tamper detection',
      'Unlimited load planner: truck routes, empty miles, fuel & profit',
      'Up to 25 watchlist entries',
      'Full risk reports',
      'Email & in-app alerts',
      'Daily monitoring of your own FMCSA record, inspections & crashes',
      'See how often your company is checked (counts, never who)',
      'API access',
      '1 user · 1 computer + 1 phone',
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
    limits: { fmcsaLookups: null, rateConScans: 75, coiChecks: 150, pdfForensics: null, loadPlans: null, watchlist: 100, users: 3 },
    features: [
      'Everything in Carrier',
      '75 rate con scans / month',
      ...coi('150 COI checks / month'),
      'Unlimited PDF tamper detection',
      'Up to 100 watchlist entries',
      '3 users (shared quota), each on 1 computer + 1 phone',
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
    limits: { fmcsaLookups: null, rateConScans: 500, coiChecks: null, pdfForensics: null, loadPlans: null, watchlist: null, users: 10 },
    features: [
      'Everything in Team',
      '500 rate con scans / month',
      ...coi('Unlimited COI checks'),
      'Unlimited PDF tamper detection',
      'Unlimited watchlist entries',
      '10 users, each on 1 computer + 1 phone',
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
