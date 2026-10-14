import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/admin';
import { getStripe } from '@/lib/stripe';
import { addInvoice, emptyTotals, summarizeRevenue, type RevenueTotals } from '@/lib/revenue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Admin-only. Money actually collected for Haulock subscriptions, by month
// and all-time: paid invoices (the Stripe account is shared with other
// products, so only invoices for Haulock prices / subscriptions count),
// minus refunds, and minus Stripe's fees for net. Cached for 10 minutes.

const CACHE_MS = 10 * 60 * 1000;
let cache: { at: number; body: any } | null = null;

export async function GET(req: Request) {
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const fresh = new URL(req.url).searchParams.get('fresh') === '1';
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return NextResponse.json({ ...cache.body, cached: true });

  const allTime = emptyTotals();
  const byMonth = new Map<string, RevenueTotals>();
  let scanned = 0;
  let truncated = false;
  try {
    // Auto-paginates every paid invoice; capped so a huge shared account
    // can't hang the admin page.
    for await (const inv of stripe.invoices.list({ status: 'paid', limit: 100, expand: ['data.charge.balance_transaction'] }) as any) {
      scanned += 1;
      if (scanned > 5000) { truncated = true; break; }
      addInvoice(byMonth, allTime, inv);
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Stripe error' }, { status: 502 });
  }
  const body = { ...summarizeRevenue(byMonth, allTime), truncated, computedAt: new Date().toISOString() };
  cache = { at: Date.now(), body };
  return NextResponse.json(body);
}
