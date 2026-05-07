import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { getStripe } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RECOVERY_PROMO = 'NEW20';

// Operator-facing stats for the cart-recovery system:
//   - exit-intent modal: shown / claimed / dismissed (30d + all-time)
//   - abandoned-cart emails: 1h / 7d sends (30d + all-time)
//   - NEW20 promo redemptions (live from Stripe)
// Admin-only.
export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Run all the count queries in parallel — each one is cheap, and we hit
  // both Supabase and Stripe so total wall-clock matters for admin UX.
  const [
    exitShownAll,
    exitShown30d,
    exitClaimedAll,
    exitClaimed30d,
    exitDismissedAll,
    exitDismissed30d,
    email1hAll,
    email1h30d,
    email7dAll,
    email7d30d,
    recoveryRowsAll,
    recoveryRows30d,
  ] = await Promise.all([
    svc.from('exit_intent_events').select('id', { count: 'exact', head: true }).eq('kind', 'shown'),
    svc.from('exit_intent_events').select('id', { count: 'exact', head: true }).eq('kind', 'shown').gte('created_at', since30d),
    svc.from('exit_intent_events').select('id', { count: 'exact', head: true }).eq('kind', 'claimed'),
    svc.from('exit_intent_events').select('id', { count: 'exact', head: true }).eq('kind', 'claimed').gte('created_at', since30d),
    svc.from('exit_intent_events').select('id', { count: 'exact', head: true }).eq('kind', 'dismissed'),
    svc.from('exit_intent_events').select('id', { count: 'exact', head: true }).eq('kind', 'dismissed').gte('created_at', since30d),
    svc.from('email_log').select('id', { count: 'exact', head: true }).eq('kind', 'abandoned_1h'),
    svc.from('email_log').select('id', { count: 'exact', head: true }).eq('kind', 'abandoned_1h').gte('sent_at', since30d),
    svc.from('email_log').select('id', { count: 'exact', head: true }).eq('kind', 'abandoned_7d'),
    svc.from('email_log').select('id', { count: 'exact', head: true }).eq('kind', 'abandoned_7d').gte('sent_at', since30d),
    svc.from('cart_recovery_sends').select('id', { count: 'exact', head: true }),
    svc.from('cart_recovery_sends').select('id', { count: 'exact', head: true }).gte('sent_at', since30d),
  ]);

  // All promo codes pulled live from Stripe. We list every promotion_code in
  // the account (paginated, up to ~300), include any that have been
  // redeemed at least once OR are still active, and use whichever counter
  // is higher between `promotion_code.times_redeemed` and
  // `coupon.times_redeemed` (older subscriptions used `subscription.create({ coupon })`
  // which only increments the coupon counter; the new-checkout flow uses
  // `discounts: [{ promotion_code }]` and increments both).
  type PromoStats = {
    id: string;          // Stripe promotion_code id — unique even when two codes share the same human label
    code: string;
    active: boolean;
    times_redeemed: number;
    max_redemptions: number | null;
    coupon_id: string | null;
    percent_off: number | null;
    amount_off: number | null;
    duration: string | null;
  };
  const promos: PromoStats[] = [];
  try {
    const stripe = getStripe();
    if (stripe) {
      let starting_after: string | undefined;
      for (let page = 0; page < 3; page++) {
        const list: any = await stripe.promotionCodes.list({
          limit: 100,
          expand: ['data.coupon'],
          ...(starting_after ? { starting_after } : {}),
        });
        for (const promo of list.data) {
          const coupon: any = promo.coupon || null;
          const promoCount = typeof promo.times_redeemed === 'number' ? promo.times_redeemed : 0;
          const couponCount = typeof coupon?.times_redeemed === 'number' ? coupon.times_redeemed : 0;
          const times_redeemed = Math.max(promoCount, couponCount);
          // Skip codes that are inactive AND have never been used — pure noise.
          if (times_redeemed === 0 && !promo.active) continue;
          promos.push({
            id: promo.id,
            code: promo.code,
            active: !!promo.active,
            times_redeemed,
            max_redemptions: promo.max_redemptions ?? coupon?.max_redemptions ?? null,
            coupon_id: coupon?.id || null,
            percent_off: coupon?.percent_off ?? null,
            amount_off: coupon?.amount_off ?? null,
            duration: coupon?.duration || null,
          });
        }
        if (!list.has_more) break;
        starting_after = list.data.at(-1)?.id;
      }
    }
  } catch {
    // Stripe outage shouldn't take down the admin page — leave the list empty.
  }
  // Sort: active first, then by redemption count desc.
  promos.sort((a, b) => Number(b.active) - Number(a.active) || b.times_redeemed - a.times_redeemed);

  return NextResponse.json({
    exitIntent: {
      shown: { all: exitShownAll.count || 0, last30d: exitShown30d.count || 0 },
      claimed: { all: exitClaimedAll.count || 0, last30d: exitClaimed30d.count || 0 },
      dismissed: { all: exitDismissedAll.count || 0, last30d: exitDismissed30d.count || 0 },
    },
    emails: {
      abandoned_1h: { all: email1hAll.count || 0, last30d: email1h30d.count || 0 },
      abandoned_7d: { all: email7dAll.count || 0, last30d: email7d30d.count || 0 },
      total_recovery_rows: { all: recoveryRowsAll.count || 0, last30d: recoveryRows30d.count || 0 },
    },
    promos,
    // The recovery code is still surfaced separately so the UI can show an
    // "inactive — recovery code disabled" warning if NEW20 specifically gets
    // turned off in Stripe.
    recoveryCode: RECOVERY_PROMO,
  });
}
