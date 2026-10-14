import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { getPlan, monthStart } from '@/lib/plans';
import { getStripe } from '@/lib/stripe';
import { lifetimeBySubscription, listHaulockSubscriptions, paidSubscriptionIds, summarizeBilling, type UserBilling } from '@/lib/billing';
import { groupSubscriptionsByUser } from '@/lib/billing-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Supabase returns at most 1000 rows per request, so page until a short page.
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const authUsers: any[] = [];
  for (let page = 1; ; page += 1) {
    const { data: authList, error: authErr } = await svc.auth.admin.listUsers({ perPage: 1000, page });
    if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 });
    const batch = authList?.users || [];
    authUsers.push(...batch);
    if (batch.length < 1000) break;
  }

  // Fetch admin set
  const { data: adminRows } = await svc.from('admins').select('email');
  const adminSet = new Set((adminRows || []).map((r: any) => String(r.email).toLowerCase()));

  const since = monthStart().toISOString();
  let lookups: any[], watchlist: any[], memberships: any[];
  try {
    [lookups, watchlist, memberships] = await Promise.all([
      fetchAll<any>((a, b) => svc.from('lookups').select('user_id, source, created_at').order('id').range(a, b)),
      fetchAll<any>((a, b) => svc.from('watchlist').select('user_id').order('id').range(a, b)),
      fetchAll<any>((a, b) => svc.from('team_members').select('user_id, role, teams ( plan, owner_user_id )').order('user_id').range(a, b)),
    ]);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Query failed' }, { status: 500 });
  }

  const lookupsByUser = new Map<string, { total: number; quickMonth: number; scanMonth: number; lastAt: string | null }>();
  for (const l of lookups) {
    const key = l.user_id;
    const entry = lookupsByUser.get(key) || { total: 0, quickMonth: 0, scanMonth: 0, lastAt: null };
    entry.total += 1;
    const created = l.created_at;
    if (!entry.lastAt || created > entry.lastAt) entry.lastAt = created;
    if (created >= since) {
      if (l.source === 'ratecon') entry.scanMonth += 1;
      else entry.quickMonth += 1;
    }
    lookupsByUser.set(key, entry);
  }
  const watchlistByUser = new Map<string, number>();
  for (const w of watchlist) {
    watchlistByUser.set(w.user_id, (watchlistByUser.get(w.user_id) || 0) + 1);
  }
  // Team members get their team's plan (see resolveTeamContext).
  const teamByUser = new Map<string, { role: 'owner' | 'member'; plan: string; ownerUserId: string }>();
  for (const m of memberships) {
    const t = Array.isArray(m.teams) ? m.teams[0] : m.teams;
    if (t) teamByUser.set(m.user_id, { role: m.role === 'owner' ? 'owner' : 'member', plan: t.plan, ownerUserId: t.owner_user_id });
  }

  // What each user actually pays for, straight from Stripe. Matched by the
  // user_id we tag on every subscription, else by their Stripe customer id.
  let billingByUser: Map<string, UserBilling> | null = null;
  let billingError: string | null = null;
  const stripe = getStripe();
  if (!stripe) {
    billingError = 'Stripe not configured';
  } else {
    try {
      const { subs } = await listHaulockSubscriptions(stripe, ['data.latest_invoice', 'data.customer']);
      const paidIds = await paidSubscriptionIds(stripe, subs);
      const { byUser: subsByUser } = groupSubscriptionsByUser(subs, authUsers.map((u) => ({
        id: u.id, email: u.email || null, stripeCustomerId: u.user_metadata?.stripe_customer_id || null,
      })));
      const lifetime = await lifetimeBySubscription(stripe, Array.from(paidIds));
      billingByUser = new Map();
      for (const [uid, list] of subsByUser) billingByUser.set(uid, summarizeBilling(list, paidIds, lifetime));
    } catch (e: any) {
      billingError = e?.message || 'Stripe error';
    }
  }
  const expectedPlanOf = (userId: string): string | null => {
    if (!billingByUser) return null;
    return billingByUser.get(userId)?.expectedPlan || 'free';
  };

  const users = authUsers.map((u: any) => {
    const meta = u.user_metadata || {};
    const l = lookupsByUser.get(u.id) || { total: 0, quickMonth: 0, scanMonth: 0, lastAt: null };
    const team = teamByUser.get(u.id) || null;
    const userIsAdmin = adminSet.has(String(u.email || '').toLowerCase());
    // The plan whose limits the app enforces for this user right now.
    const plan = getPlan(team ? team.plan : meta.plan);
    // The plan Stripe says they've paid for. Members inherit the owner's.
    const expected = team?.role === 'member' ? expectedPlanOf(team.ownerUserId) : expectedPlanOf(u.id);
    // An admin granted exactly this plan by hand, so it isn't "unpaid".
    const manual = plan.id !== 'free' && u.app_metadata?.manual_plan === plan.id;
    return {
      id: u.id,
      email: u.email,
      name: meta.full_name || meta.name || '',
      company: meta.company || '',
      mc: meta.mc || '',
      plan: plan.id,
      planLabel: plan.label,
      billing: billingByUser ? (billingByUser.get(u.id) || summarizeBilling([], new Set())) : null,
      expectedPlan: expected,
      manualPlan: manual,
      // Admins have unlimited access regardless of plan, so skip them.
      planMismatch: expected != null && !userIsAdmin && !manual && plan.id !== expected,
      team: team ? { role: team.role } : null,
      isAdmin: userIsAdmin,
      role: meta.role || null,
      affiliateCode: meta.affiliate_code || null,
      affiliateCommissionMode: meta.affiliate_commission_mode === 'per_plan' ? 'per_plan' : 'uniform',
      affiliateCommissionType: meta.affiliate_commission_type || null,
      affiliateCommissionValue: typeof meta.affiliate_commission_value === 'number' ? meta.affiliate_commission_value : null,
      affiliateCommissionByPlan: (meta.affiliate_commission_by_plan && typeof meta.affiliate_commission_by_plan === 'object') ? meta.affiliate_commission_by_plan : null,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at,
      confirmedAt: u.email_confirmed_at,
      usage: {
        lookupsTotal: l.total,
        lookupsThisMonth: l.quickMonth,
        scansThisMonth: l.scanMonth,
        watchlist: watchlistByUser.get(u.id) || 0,
        lastLookupAt: l.lastAt,
      },
      limits: plan.limits,
    };
  }).sort((a, b) => (b.lastSignInAt || b.createdAt || '').localeCompare(a.lastSignInAt || a.createdAt || ''));

  return NextResponse.json({ users, total: users.length, billingError });
}
