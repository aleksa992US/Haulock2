// Read-only check of the sale promotion codes in Stripe (lib/promo.ts):
// is each code there, active, live, on the right coupon, limited to the right
// products and first-time customers, and expiring at the right time?
//
// Usage: node scripts/stripe-check-sale-codes.mjs
// Reads STRIPE_SECRET_KEY (a restricted key with Read on Coupons, Promotion
// codes, Products and Prices is enough) and, if set, STRIPE_PRICE_<PLAN>_<BILLING>
// from the environment or .env.local. Changes nothing.
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
const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2025-01-27.acacia' }); // same as lib/stripe.ts

const EXPECT = [
  { code: 'BLACKFRIDAY40', percent_off: 40, duration: 'repeating', months: 3, billing: 'MONTHLY', notBefore: '2026-11-30T05:00:00Z', label: 'Black Friday' },
  { code: 'CYBER50', percent_off: 50, duration: 'once', billing: 'ANNUAL', notBefore: '2026-12-01T05:00:00Z', label: 'Cyber Monday' },
];
const fmt = (sec) => (sec ? new Date(sec * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + ' ET' : 'none');

async function productsFor(billing) {
  const ids = ['CARRIER', 'TEAM', 'FLEET'].map((p) => env[`STRIPE_PRICE_${p}_${billing}`]).filter(Boolean);
  const out = new Set();
  for (const id of ids) {
    const price = await stripe.prices.retrieve(id);
    out.add(typeof price.product === 'string' ? price.product : price.product.id);
  }
  return out;
}

let problems = 0;
const ok = (good, text) => { if (!good) problems += 1; console.log(`  ${good ? '✓' : '✗'} ${text}`); };

for (const e of EXPECT) {
  console.log(`\n${e.code} (${e.label})`);
  const list = await stripe.promotionCodes.list({ code: e.code, limit: 10, expand: ['data.coupon.applies_to'] });
  if (!list.data.length) { ok(false, 'promotion code not found (check spelling and live mode)'); continue; }
  if (list.data.length > 1) console.log(`  ! ${list.data.length} promotion codes with this name; checking the active one`);
  const pc = list.data.find((x) => x.active) || list.data[0];
  const c = pc.coupon;
  ok(pc.livemode, pc.livemode ? 'live mode' : 'TEST mode, not live');
  ok(pc.active && c.valid, `active${!c.valid ? ' (but coupon is not valid)' : ''}`);
  ok(c.percent_off === e.percent_off, `${c.percent_off ?? `$${(c.amount_off || 0) / 100}`}% off (want ${e.percent_off}%)`);
  ok(c.duration === e.duration && (e.months ? c.duration_in_months === e.months : true),
    `duration ${c.duration}${c.duration_in_months ? ` × ${c.duration_in_months} months` : ''} (want ${e.duration}${e.months ? ` × ${e.months} months` : ''})`);
  // Anyone not paying now gets the sale (checkout already turns away active subscribers).
  ok(!pc.restrictions?.first_time_transaction, pc.restrictions?.first_time_transaction ? 'limited to first-time customers (should be off: free users who paid before are blocked)' : 'open to past customers too');
  const want = Date.parse(e.notBefore) / 1000;
  const ends = [pc.expires_at, c.redeem_by].filter(Boolean);
  ok(ends.every((t) => t >= want), `code expires ${fmt(pc.expires_at)}, coupon redeem by ${fmt(c.redeem_by)} (must not be before ${fmt(want)})`);
  const prodIds = c.applies_to?.products || [];
  if (!prodIds.length) ok(false, 'applies to ALL products (should be limited to Haulock plans)');
  else {
    const names = [];
    for (const id of prodIds) names.push((await stripe.products.retrieve(id)).name);
    console.log(`  · limited to: ${names.join(', ')}`);
    const need = await productsFor(e.billing);
    if (need.size) {
      const missing = [...need].filter((id) => !prodIds.includes(id));
      ok(missing.length === 0, missing.length ? `missing Haulock ${e.billing.toLowerCase()} product(s): ${missing.join(', ')}` : `covers every Haulock ${e.billing.toLowerCase()} plan`);
    }
  }
  if (pc.max_redemptions || c.max_redemptions) console.log(`  · redemption cap: ${pc.max_redemptions || c.max_redemptions}`);
  console.log(`  · redeemed so far: ${pc.times_redeemed}`);
}
console.log(problems ? `\n${problems} problem(s) found.` : '\nAll good.');
process.exit(problems ? 1 : 0);
