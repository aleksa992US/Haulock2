import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { getStripe, planFromPriceId } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Returns the target user's active Stripe subscription state, for the admin
// confirm-delete dialog. Admin-only.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const svc = getServiceSupabase();
  const stripe = getStripe();
  if (!svc || !stripe) return NextResponse.json({ hasActiveSub: false });

  const { data: target } = await svc.auth.admin.getUserById(params.id);
  const meta = target.user?.user_metadata || {};
  const email = target.user?.email;

  let customerId: string | null = (meta.stripe_customer_id as string) || null;
  if (!customerId && email) {
    const found = await stripe.customers.list({ email, limit: 1 });
    customerId = found.data[0]?.id || null;
  }

  if (!customerId) {
    return NextResponse.json({ hasActiveSub: false, customerId: null });
  }

  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
    expand: ['data.latest_invoice'],
  });

  const active = subs.data.find((s) => s.status === 'active' || s.status === 'trialing' || s.status === 'past_due' || s.status === 'unpaid');
  if (!active) {
    return NextResponse.json({ hasActiveSub: false, customerId });
  }

  const price = active.items.data[0]?.price;
  const mapped = planFromPriceId(price?.id);
  const latestInvoice: any = active.latest_invoice;

  return NextResponse.json({
    hasActiveSub: true,
    customerId,
    subscriptionId: active.id,
    status: active.status,
    plan: mapped?.plan || active.metadata?.plan || null,
    billing: mapped?.billing || (price?.recurring?.interval === 'year' ? 'annual' : 'monthly'),
    amount: price?.unit_amount ?? null,
    lastPaidAmount: latestInvoice?.amount_paid ?? null,
    currency: (price?.currency || 'usd').toUpperCase(),
    currentPeriodEnd: (active as any).current_period_end ?? null,
  });
}
