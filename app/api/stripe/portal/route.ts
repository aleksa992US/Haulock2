import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const customerId = me.user_metadata?.stripe_customer_id as string | undefined;
  if (!customerId) {
    return NextResponse.json({ error: 'No Stripe customer on file — subscribe first.' }, { status: 400 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://haulock.com';
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${siteUrl}/settings`,
  });

  return NextResponse.json({ url: session.url });
}
