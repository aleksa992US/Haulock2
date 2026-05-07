import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { getStripe } from '@/lib/stripe';
import { computeAffiliateEarnings, specFromMetadata, type CommissionSpec } from '@/lib/affiliate-earnings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin overview of every affiliate: their lifetime earnings (live from
// Stripe), what's already been paid out, what's still requested, and what's
// available. One Stripe API search per affiliate; fine for the volumes we're
// dealing with and lets the admin tab work without any periodic sync job.
export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });

  // Pull every auth user, filter to the ones flagged as affiliates. Supabase
  // doesn't support metadata filtering server-side, but the volume here is
  // small (operator-curated set), so a list-and-filter is fine.
  const { data: usersList, error: usersErr } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersErr) return NextResponse.json({ error: usersErr.message }, { status: 500 });
  const affiliates = (usersList?.users || []).filter((u: any) => u?.user_metadata?.role === 'affiliate');

  // Pull every payout row in one shot, group by user. Cheaper than N queries.
  const { data: allPayouts } = await svc
    .from('affiliate_payouts')
    .select('user_id, amount_cents, status');
  const paidByUser = new Map<string, number>();
  const pendingByUser = new Map<string, number>();
  const requestedRowsByUser = new Map<string, number>();
  for (const p of (allPayouts || []) as any[]) {
    if (p.status === 'paid') paidByUser.set(p.user_id, (paidByUser.get(p.user_id) || 0) + (p.amount_cents || 0));
    else if (p.status === 'requested') {
      pendingByUser.set(p.user_id, (pendingByUser.get(p.user_id) || 0) + (p.amount_cents || 0));
      requestedRowsByUser.set(p.user_id, (requestedRowsByUser.get(p.user_id) || 0) + 1);
    }
  }

  // For each affiliate, compute lifetime earnings live from Stripe. We
  // intentionally do these sequentially to keep clear of Stripe rate limits;
  // with 10s of affiliates this stays fast.
  type Row = {
    id: string;
    email: string;
    name: string;
    code: string | null;
    commission: CommissionSpec | null;
    redemptions: number;
    lifetimeCents: number;
    paidCents: number;
    pendingCents: number;
    availableCents: number;
    pendingRequests: number;
    assignedAt: string | null;
  };
  const rows: Row[] = [];
  for (const u of affiliates as any[]) {
    const meta = u.user_metadata || {};
    const code: string = meta.affiliate_code || '';
    const spec = specFromMetadata(meta);
    let redemptions = 0;
    let lifetimeCents = 0;
    if (code) {
      const earnings = await computeAffiliateEarnings(stripe, code, spec);
      redemptions = earnings.totalRedemptions;
      lifetimeCents = earnings.totalEarningsCents;
    }
    const paidCents = paidByUser.get(u.id) || 0;
    const pendingCents = pendingByUser.get(u.id) || 0;
    rows.push({
      id: u.id,
      email: u.email,
      name: meta.full_name || meta.name || '',
      code: code || null,
      commission: code ? spec : null,
      redemptions,
      lifetimeCents,
      paidCents,
      pendingCents,
      availableCents: Math.max(0, lifetimeCents - paidCents - pendingCents),
      pendingRequests: requestedRowsByUser.get(u.id) || 0,
      assignedAt: meta.affiliate_assigned_at || null,
    });
  }

  rows.sort((a, b) => b.lifetimeCents - a.lifetimeCents);
  return NextResponse.json({ affiliates: rows, total: rows.length });
}

// Promote a user to affiliate, attach a Stripe coupon code, and configure
// their commission. Storing on user_metadata keeps the change set tiny — no
// new table, and the affiliate stats route can read straight from the user
// record.
//
// Body: { userId, code, commissionType: 'flat'|'percent', commissionValue }
// To remove affiliate status: { userId, action: 'unassign' }
export async function POST(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  type IncomingRate = { type?: 'flat' | 'percent'; value?: number };
  const body = await req.json().catch(() => null) as {
    userId?: string;
    action?: 'assign' | 'unassign';
    code?: string;
    // 'uniform' uses commissionType + commissionValue (or rate.{type,value});
    // 'per_plan' uses commissionByPlan: { carrier?, team?, fleet? }.
    commissionMode?: 'uniform' | 'per_plan';
    commissionType?: 'flat' | 'percent';
    commissionValue?: number;
    commissionByPlan?: Partial<Record<string, IncomingRate>>;
  } | null;

  if (!body || !body.userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  // Pull the user's current metadata so we merge instead of overwrite.
  const { data: target, error: fetchErr } = await svc.auth.admin.getUserById(body.userId);
  if (fetchErr || !target?.user) {
    return NextResponse.json({ error: fetchErr?.message || 'User not found' }, { status: 404 });
  }
  const meta: any = { ...(target.user.user_metadata || {}) };

  if (body.action === 'unassign') {
    delete meta.role;
    delete meta.affiliate_code;
    delete meta.affiliate_commission_mode;
    delete meta.affiliate_commission_type;
    delete meta.affiliate_commission_value;
    delete meta.affiliate_commission_by_plan;
    delete meta.affiliate_assigned_at;
    const { error } = await svc.auth.admin.updateUserById(body.userId, { user_metadata: meta });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, role: null });
  }

  // Assign / update — validate inputs.
  const code = (body.code || '').trim();
  if (!code) return NextResponse.json({ error: 'Pick a Stripe promo code to attach to this affiliate.' }, { status: 400 });

  const mode = body.commissionMode === 'per_plan' ? 'per_plan' : 'uniform';
  // Throws on invalid input so the calling block can return one 400 with a
  // helpful message instead of nesting discriminated-union narrows.
  const parseRate = (r: IncomingRate, label: string): { type: 'flat' | 'percent'; value: number } => {
    const type = r.type === 'percent' ? 'percent' : 'flat';
    const value = Number(r.value);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${label}: commission must be a positive number.`);
    if (type === 'percent' && value > 100) throw new Error(`${label}: percent cannot exceed 100%.`);
    return { type, value };
  };

  // Reset commission keys before re-writing — if the admin switches modes
  // we don't want stale fields from the previous mode hanging around.
  delete meta.affiliate_commission_type;
  delete meta.affiliate_commission_value;
  delete meta.affiliate_commission_by_plan;

  try {
    if (mode === 'uniform') {
      const rate = parseRate({ type: body.commissionType, value: body.commissionValue }, 'Commission');
      meta.affiliate_commission_type = rate.type;
      meta.affiliate_commission_value = rate.value;
    } else {
      const incoming = body.commissionByPlan || {};
      // 6 cells: 3 plans × monthly / annual. We accept legacy bare-plan keys
      // ('carrier', 'team', 'fleet') as a fallback so older clients keep
      // working — the runtime helper checks `${plan}-${billing}` first and
      // falls back to `${plan}` when looking up rates.
      const allowedKeys = [
        'carrier-monthly', 'carrier-annual',
        'team-monthly', 'team-annual',
        'fleet-monthly', 'fleet-annual',
        'carrier', 'team', 'fleet',
      ];
      const byPlan: Record<string, { type: 'flat' | 'percent'; value: number }> = {};
      for (const key of allowedKeys) {
        const r = incoming[key];
        if (!r) continue;
        if (r.value == null || r.value === 0) continue;
        const label = key.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
        byPlan[key] = parseRate(r, label);
      }
      if (Object.keys(byPlan).length === 0) {
        return NextResponse.json({ error: 'Set a commission for at least one plan.' }, { status: 400 });
      }
      meta.affiliate_commission_by_plan = byPlan;
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Invalid commission' }, { status: 400 });
  }

  meta.role = 'affiliate';
  meta.affiliate_code = code;
  meta.affiliate_commission_mode = mode;
  meta.affiliate_assigned_at = new Date().toISOString();

  const { error } = await svc.auth.admin.updateUserById(body.userId, { user_metadata: meta });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, role: 'affiliate' });
}
