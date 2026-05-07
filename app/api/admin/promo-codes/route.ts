import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/admin';
import { getStripe } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Returns the list of active Stripe promotion codes so the admin can pick
// one to assign to an affiliate. Active-only to keep the dropdown short and
// to prevent attaching an affiliate to a code that won't actually work at
// checkout.
export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ codes: [] });

  type Row = {
    id: string;
    code: string;
    active: boolean;
    times_redeemed: number;
    percent_off: number | null;
    amount_off: number | null;
    duration: string | null;
  };
  const codes: Row[] = [];
  try {
    let starting_after: string | undefined;
    for (let page = 0; page < 3; page++) {
      const list: any = await stripe.promotionCodes.list({
        limit: 100,
        active: true,
        expand: ['data.coupon'],
        ...(starting_after ? { starting_after } : {}),
      });
      for (const promo of list.data) {
        const coupon: any = promo.coupon || null;
        const promoCount = typeof promo.times_redeemed === 'number' ? promo.times_redeemed : 0;
        const couponCount = typeof coupon?.times_redeemed === 'number' ? coupon.times_redeemed : 0;
        codes.push({
          id: promo.id,
          code: promo.code,
          active: !!promo.active,
          times_redeemed: Math.max(promoCount, couponCount),
          percent_off: coupon?.percent_off ?? null,
          amount_off: coupon?.amount_off ?? null,
          duration: coupon?.duration || null,
        });
      }
      if (!list.has_more) break;
      starting_after = list.data.at(-1)?.id;
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Stripe error' }, { status: 502 });
  }

  codes.sort((a, b) => a.code.localeCompare(b.code));
  return NextResponse.json({ codes });
}
