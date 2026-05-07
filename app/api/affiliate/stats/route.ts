import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';
import { computeAffiliateEarnings, specFromMetadata, PAYOUT_MIN_CENTS, PAYOUT_WINDOW_DAYS } from '@/lib/affiliate-earnings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Affiliate dashboard data. Authed user must have role='affiliate' on their
// metadata. Returns lifetime earnings (live from Stripe), prior payouts
// (from our DB), and the available balance the affiliate can request.
export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const meta: any = me.user_metadata || {};
  if (meta.role !== 'affiliate') {
    return NextResponse.json({ error: 'Affiliate access only' }, { status: 403 });
  }
  const code: string = meta.affiliate_code || '';
  const spec = specFromMetadata(meta);

  // Read prior payout requests (own rows; RLS lets us use the user-scoped client).
  const { data: payoutsRaw } = await supabase
    .from('affiliate_payouts')
    .select('id, amount_cents, status, requested_at, paid_at, rejected_at, reject_reason, affiliate_code, redemptions_count')
    .order('requested_at', { ascending: false });
  const payouts = payoutsRaw || [];

  const paidCents = payouts.filter((p) => p.status === 'paid').reduce((s, p) => s + (p.amount_cents || 0), 0);
  const pendingCents = payouts.filter((p) => p.status === 'requested').reduce((s, p) => s + (p.amount_cents || 0), 0);

  if (!code) {
    return NextResponse.json({
      code: null,
      commission: spec,
      summary: {
        totalRedemptions: 0,
        totalEarningsCents: 0,
        monthEarningsCents: 0,
        paidCents,
        pendingCents,
        availableCents: 0,
        canRequest: false,
        minRequestCents: PAYOUT_MIN_CENTS,
        payoutWindowDays: PAYOUT_WINDOW_DAYS,
      },
      redemptions: [],
      payouts,
      message: 'No promo code assigned yet — contact the operator.',
    });
  }

  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });

  // Resolve the promo code → display details.
  let codeDetails: { code: string; active: boolean; percent_off: number | null; amount_off: number | null; duration: string | null } | null = null;
  try {
    const list: any = await stripe.promotionCodes.list({ code, limit: 1, expand: ['data.coupon'] });
    const promo: any = list.data[0];
    if (promo) {
      const coupon: any = promo.coupon || null;
      codeDetails = {
        code: promo.code,
        active: !!promo.active,
        percent_off: coupon?.percent_off ?? null,
        amount_off: coupon?.amount_off ?? null,
        duration: coupon?.duration || null,
      };
    }
  } catch { /* fall through */ }

  const earnings = await computeAffiliateEarnings(stripe, code, spec);
  const availableCents = Math.max(0, earnings.totalEarningsCents - paidCents - pendingCents);

  return NextResponse.json({
    code: codeDetails,
    commission: spec,
    summary: {
      totalRedemptions: earnings.totalRedemptions,
      totalEarningsCents: earnings.totalEarningsCents,
      monthEarningsCents: earnings.monthEarningsCents,
      paidCents,
      pendingCents,
      availableCents,
      canRequest: availableCents >= PAYOUT_MIN_CENTS && pendingCents === 0,
      minRequestCents: PAYOUT_MIN_CENTS,
      payoutWindowDays: PAYOUT_WINDOW_DAYS,
    },
    redemptions: earnings.redemptions,
    payouts,
  });
}
