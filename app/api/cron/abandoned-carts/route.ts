import { NextResponse } from 'next/server';
import { authorizeCronOrAdmin } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/service';
import { getStripe, planFromPriceId, type Billing, type PaidPlan } from '@/lib/stripe';
import { PLANS } from '@/lib/plans';
import {
  sendEmail,
  abandonedCart1hTemplate,
  abandonedCart7dTemplate,
  isResendConfigured,
  getEmailSiteUrl,
} from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Hourly recovery cron for abandoned checkout sessions.
//
// Source of truth: Stripe `subscriptions.list({ status: 'incomplete' })` —
// every checkout we start creates a subscription in `default_incomplete`
// state until the Payment Element confirms. Anything still incomplete
// after 1h or 7d is an abandoned cart.
//
// Two stages, each sent at most once per subscription via a unique constraint
// on (stripe_subscription_id, kind) in `cart_recovery_sends`:
//   - 'abandoned_1h': sent once between 1h and 25h after creation.
//   - 'abandoned_7d': sent once between 7d and 8d after creation, last call.
//
// We don't email if the customer already has another active Haulock
// subscription — they finished checkout with a different attempt.

const RECOVERY_PROMO = 'NEW20';

// Stripe auto-cancels `incomplete` subs to `incomplete_expired` after ~23h.
// We need to scan both buckets so the 7-day mail still finds the row.
const STAGES = [
  { kind: 'abandoned_1h' as const, minAgeSec: 60 * 60, maxAgeSec: 25 * 60 * 60 },
  { kind: 'abandoned_7d' as const, minAgeSec: 7 * 24 * 60 * 60, maxAgeSec: 8 * 24 * 60 * 60 },
];

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  const denied = await authorizeCronOrAdmin(req);
  if (denied) return denied;

  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === '1';
  const siteUrl = getEmailSiteUrl();
  const now = Math.floor(Date.now() / 1000);

  // Pull both buckets — Stripe filters by status, not by age, so we page
  // through and apply age windows in JS.
  const incompleteList = await stripe.subscriptions.list({
    status: 'incomplete',
    limit: 100,
    expand: ['data.customer', 'data.items.data.price'],
  });
  const expiredList = await stripe.subscriptions.list({
    status: 'incomplete_expired',
    limit: 100,
    expand: ['data.customer', 'data.items.data.price'],
  });
  const candidates = [...incompleteList.data, ...expiredList.data]
    .filter((s) => s.metadata?.product === 'haulock');

  let processed = 0;
  let sent = 0;
  let skipped = 0;
  const results: any[] = [];

  for (const sub of candidates) {
    processed += 1;
    const ageSec = now - sub.created;
    const stage = STAGES.find((s) => ageSec >= s.minAgeSec && ageSec <= s.maxAgeSec);
    if (!stage) { skipped += 1; continue; }

    const customer = sub.customer as any;
    const email: string | null = (typeof customer === 'object' && customer && !customer.deleted)
      ? (customer.email || null)
      : null;
    if (!email) { skipped += 1; results.push({ id: sub.id, status: 'no-email' }); continue; }

    // Don't email if the customer already has another active Haulock
    // subscription — they got there by a different route.
    const customerId = typeof sub.customer === 'string' ? sub.customer : customer?.id;
    if (customerId) {
      const others = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 5 });
      const hasActiveHaulock = others.data.some((o) => o.metadata?.product === 'haulock');
      if (hasActiveHaulock) { skipped += 1; results.push({ id: sub.id, status: 'already-subscribed' }); continue; }
    }

    // Resolve plan + price label from the subscription's item.
    const priceId = sub.items?.data?.[0]?.price?.id || null;
    const mapped = planFromPriceId(priceId);
    const planId: PaidPlan | null = mapped?.plan || (sub.metadata?.plan as PaidPlan) || null;
    const billing: Billing = mapped?.billing || ((sub.metadata?.billing as Billing) || 'monthly');
    if (!planId || !PLANS[planId]) { skipped += 1; continue; }
    const plan = PLANS[planId];
    const planLabel = plan.label;
    const priceLabel = billing === 'annual' ? `${plan.priceAnnual}/yr` : `${plan.price}/mo`;
    const resumeUrl = `${siteUrl}/checkout/${planId}?billing=${billing}&promoCode=${RECOVERY_PROMO}`;
    const recipientName = (typeof customer === 'object' && customer && !customer.deleted)
      ? (customer.name || undefined)
      : undefined;

    // Insert dedupe row first — if it conflicts on the unique index, this
    // sub already got this stage and we move on. Doing the insert before
    // the send means a crash mid-send only causes a missed email, never a
    // duplicate one. Service role bypasses RLS.
    if (!dryRun) {
      const { error: insertErr } = await svc.from('cart_recovery_sends').insert({
        stripe_subscription_id: sub.id,
        stripe_customer_id: customerId || null,
        user_id: sub.metadata?.user_id || null,
        to_email: email.toLowerCase(),
        kind: stage.kind,
      });
      if (insertErr) {
        // Unique-constraint violation = already sent this stage. Skip silently.
        if ((insertErr as any).code === '23505' || /duplicate key/i.test(insertErr.message || '')) {
          skipped += 1;
          continue;
        }
        results.push({ id: sub.id, status: 'log-error', message: insertErr.message });
        continue;
      }
    }

    if (!isResendConfigured()) {
      results.push({ id: sub.id, status: 'resend-not-configured', stage: stage.kind });
      continue;
    }

    try {
      const { subject, html } = stage.kind === 'abandoned_1h'
        ? abandonedCart1hTemplate({
            planLabel, priceLabel, recipientEmail: email, recipientName, resumeUrl, promoCode: RECOVERY_PROMO,
          })
        : abandonedCart7dTemplate({
            planLabel, priceLabel, recipientEmail: email, recipientName, resumeUrl, promoCode: RECOVERY_PROMO,
          });
      if (!dryRun) {
        await sendEmail({ to: email, subject, html, kind: stage.kind });
      }
      sent += 1;
      results.push({ id: sub.id, email, stage: stage.kind, planLabel, billing, dryRun });
    } catch (err: any) {
      results.push({ id: sub.id, status: 'send-error', message: err?.message });
    }

    // Polite spacing for Resend.
    await new Promise((r) => setTimeout(r, 300));
  }

  return NextResponse.json({ ok: true, processed, sent, skipped, dryRun, sample: results.slice(0, 20) });
}
