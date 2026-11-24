// Creates the Stripe coupons and promotion codes for the sales in lib/promo.ts:
//   BLACKFRIDAY40  40% off, repeats for 3 monthly invoices, redeem by Nov 30 00:00 ET
//   CYBER50        50% off once (the first annual invoice), redeem by Dec 1 00:00 ET
// Both are limited to Haulock's own plan products (the account also bills
// other products) and to first-time customers. Safe to run again: a code
// that already exists is left alone.
//
// Usage: node scripts/stripe-sale-codes.mjs [--dry-run]
// Reads STRIPE_SECRET_KEY and STRIPE_PRICE_<PLAN>_<BILLING> from the
// environment or .env.local.
import fs from 'node:fs';
import Stripe from 'stripe';

const env = { ...process.env };
if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
if (!env.STRIPE_SECRET_KEY) {
  console.error('STRIPE_SECRET_KEY is not set (environment or .env.local).');
  process.exit(1);
}
const dry = process.argv.includes('--dry-run');
const stripe = new Stripe(env.STRIPE_SECRET_KEY);
const live = /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY);

const SALES = [
  { code: 'BLACKFRIDAY40', name: 'Black Friday: 40% off 3 months', percent_off: 40, duration: 'repeating', duration_in_months: 3, billing: 'MONTHLY', redeemBy: '2026-11-30T05:00:00Z' },
  { code: 'CYBER50', name: 'Cyber Monday: 50% off a year', percent_off: 50, duration: 'once', billing: 'ANNUAL', redeemBy: '2026-12-01T05:00:00Z' },
];

// The products behind Haulock's plan prices for one billing period.
async function productsFor(billing) {
  const ids = ['CARRIER', 'TEAM', 'FLEET'].map((p) => env[`STRIPE_PRICE_${p}_${billing}`]).filter(Boolean);
  if (ids.length === 0) throw new Error(`No STRIPE_PRICE_*_${billing} variables found.`);
  const products = new Set();
  for (const id of ids) {
    const price = await stripe.prices.retrieve(id);
    products.add(typeof price.product === 'string' ? price.product : price.product.id);
  }
  return [...products];
}

console.log(`Stripe ${live ? 'LIVE' : 'TEST'} mode${dry ? ' (dry run)' : ''}`);
for (const s of SALES) {
  const existing = await stripe.promotionCodes.list({ code: s.code, limit: 1 });
  if (existing.data[0]) {
    const c = existing.data[0].coupon;
    console.log(`${s.code}: already exists (${existing.data[0].active ? 'active' : 'inactive'}, ${c.percent_off}% ${c.duration}) — left alone`);
    continue;
  }
  const products = await productsFor(s.billing);
  const redeem_by = Math.floor(Date.parse(s.redeemBy) / 1000);
  console.log(`${s.code}: ${s.percent_off}% ${s.duration}${s.duration_in_months ? ` x${s.duration_in_months}` : ''}, products ${products.join(', ')}, redeem by ${s.redeemBy}`);
  if (dry) continue;
  const coupon = await stripe.coupons.create({
    name: s.name,
    percent_off: s.percent_off,
    duration: s.duration,
    ...(s.duration_in_months ? { duration_in_months: s.duration_in_months } : {}),
    redeem_by,
    applies_to: { products },
    metadata: { product: 'haulock', sale: s.code },
  });
  const promo = await stripe.promotionCodes.create({
    coupon: coupon.id,
    code: s.code,
    expires_at: redeem_by,
    restrictions: { first_time_transaction: true },
    metadata: { product: 'haulock', sale: s.code },
  });
  console.log(`  created coupon ${coupon.id}, promotion code ${promo.id}`);
}
