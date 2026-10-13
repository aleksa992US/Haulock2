import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { getPlan, monthStart } from '@/lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Auto-computed funnel segment. First match wins, in this order — the
// order is "who is closest to paying", so the hottest leads sort first.
export type SalesSegment =
  | 'paying'          // on a paid plan
  | 'checkout'        // started checkout (abandoned cart / exit-intent) but didn't pay
  | 'limit'           // used up the free lookups this month
  | 'unconfirmed'     // never confirmed their email
  | 'new'             // signed up ≤ 7 days ago, no lookups yet
  | 'active'          // free, ran a lookup in the last 30 days
  | 'never_used'      // signed up > 7 days ago, never ran a lookup
  | 'dormant';        // used it before, nothing in 30+ days

const DAY = 24 * 60 * 60 * 1000;

// Admin-only. Every non-admin user with the signals the Sales tab needs
// to decide who to contact and what to say, plus any manual pipeline
// stage / notes from the sales_leads table.
export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const { data: authList, error: authErr } = await svc.auth.admin.listUsers({ perPage: 1000, page: 1 });
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 });
  const authUsers = authList?.users || [];

  const [adminRows, lookupsAgg, cartRows, exitRows, leadRows] = await Promise.all([
    svc.from('admins').select('email'),
    svc.from('lookups').select('user_id, source, created_at'),
    svc.from('cart_recovery_sends').select('user_id, to_email, sent_at'),
    svc.from('exit_intent_events').select('user_id, user_email, plan, kind, created_at'),
    svc.from('sales_leads').select('user_id, stage, notes, follow_up_at, last_contacted_at, updated_at'),
  ]);
  const adminSet = new Set((adminRows.data || []).map((r: any) => String(r.email).toLowerCase()));
  // sales_leads is new — if the migration hasn't been applied yet the tab
  // still works, just without manual stages and notes.
  const pipelineReady = !leadRows.error;

  const since = monthStart().toISOString();
  const lookupsByUser = new Map<string, { total: number; month: number; lastAt: string | null }>();
  for (const l of lookupsAgg.data || []) {
    const e = lookupsByUser.get(l.user_id) || { total: 0, month: 0, lastAt: null };
    e.total += 1;
    if (!e.lastAt || l.created_at > e.lastAt) e.lastAt = l.created_at;
    if (l.created_at >= since && l.source !== 'ratecon') e.month += 1;
    lookupsByUser.set(l.user_id, e);
  }

  // Checkout intent, keyed by user id and by email (older rows may only
  // carry one of the two).
  const checkoutBy = new Map<string, { at: string; plan: string | null }>();
  const noteCheckout = (key: string | null | undefined, at: string, plan: string | null) => {
    if (!key) return;
    const k = String(key).toLowerCase();
    const prev = checkoutBy.get(k);
    if (!prev || at > prev.at) checkoutBy.set(k, { at, plan: plan || prev?.plan || null });
  };
  for (const r of cartRows.data || []) { noteCheckout(r.user_id, r.sent_at, null); noteCheckout(r.to_email, r.sent_at, null); }
  for (const r of exitRows.data || []) { noteCheckout(r.user_id, r.created_at, r.plan); noteCheckout(r.user_email, r.created_at, r.plan); }

  const leadsByUser = new Map<string, any>();
  for (const r of leadRows.data || []) leadsByUser.set(r.user_id, r);

  const now = Date.now();
  const leads = authUsers
    .filter((u: any) => !adminSet.has(String(u.email || '').toLowerCase()))
    .map((u: any) => {
      const meta = u.user_metadata || {};
      const plan = getPlan(meta.plan);
      const l = lookupsByUser.get(u.id) || { total: 0, month: 0, lastAt: null };
      const checkout = checkoutBy.get(u.id) || checkoutBy.get(String(u.email || '').toLowerCase()) || null;
      const ageDays = Math.floor((now - new Date(u.created_at).getTime()) / DAY);
      const lastActive = [l.lastAt, u.last_sign_in_at].filter(Boolean).sort().pop() || null;
      const freeLimit = plan.limits.fmcsaLookups;

      let segment: SalesSegment;
      if (plan.id !== 'free') segment = 'paying';
      else if (checkout) segment = 'checkout';
      else if (freeLimit != null && l.month >= freeLimit) segment = 'limit';
      else if (!u.email_confirmed_at) segment = 'unconfirmed';
      else if (l.total === 0 && ageDays <= 7) segment = 'new';
      else if (l.lastAt && now - new Date(l.lastAt).getTime() <= 30 * DAY) segment = 'active';
      else if (l.total === 0) segment = 'never_used';
      else segment = 'dormant';

      const lead = leadsByUser.get(u.id);
      return {
        id: u.id,
        email: u.email,
        name: meta.full_name || meta.name || '',
        company: meta.company || '',
        mc: meta.mc || '',
        role: meta.role || null,
        plan: plan.id,
        planLabel: plan.label,
        segment,
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at,
        lastActiveAt: lastActive,
        confirmed: Boolean(u.email_confirmed_at),
        lookupsTotal: l.total,
        lookupsThisMonth: l.month,
        freeLimit,
        checkoutAt: checkout?.at || null,
        checkoutPlan: checkout?.plan || null,
        stage: lead?.stage || 'new',
        notes: lead?.notes || '',
        followUpAt: lead?.follow_up_at || null,
        lastContactedAt: lead?.last_contacted_at || null,
      };
    })
    .sort((a: any, b: any) => (b.lastActiveAt || b.createdAt || '').localeCompare(a.lastActiveAt || a.createdAt || ''));

  return NextResponse.json({ leads, pipelineReady });
}
