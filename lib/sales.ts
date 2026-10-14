import type { SupabaseClient } from '@supabase/supabase-js';
import { getPlan, monthStart } from './plans';

// Shared by the admin Sales API routes: who every user is in the funnel,
// what their own recent lookups were, and how merge tags resolve for them.

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

export type SalesLead = {
  id: string;
  email: string;
  name: string;
  company: string;
  mc: string;
  role: string | null;
  plan: string;
  planLabel: string;
  segment: SalesSegment;
  createdAt: string;
  lastSignInAt: string | null;
  lastActiveAt: string | null;
  confirmed: boolean;
  lookupsTotal: number;
  lookupsThisMonth: number;
  freeLimit: number | null;
  checkoutAt: string | null;
  checkoutPlan: string | null;
  stage: string;
  notes: string;
  followUpAt: string | null;
  lastContactedAt: string | null;
  lastEmailedAt: string | null;
  unsubscribed: boolean;
};

const DAY = 24 * 60 * 60 * 1000;

export async function loadSalesLeads(svc: SupabaseClient): Promise<{ leads: SalesLead[]; pipelineReady: boolean }> {
  const { data: authList, error: authErr } = await svc.auth.admin.listUsers({ perPage: 1000, page: 1 });
  if (authErr) throw new Error(authErr.message);
  const authUsers = authList?.users || [];

  const [adminRows, lookupsAgg, cartRows, exitRows, leadRows, salesLog] = await Promise.all([
    svc.from('admins').select('email'),
    svc.from('lookups').select('user_id, source, created_at'),
    svc.from('cart_recovery_sends').select('user_id, to_email, sent_at'),
    // May not exist in every environment — a missing table just yields no rows.
    svc.from('exit_intent_events').select('user_id, user_email, plan, kind, created_at'),
    svc.from('sales_leads').select('user_id, stage, notes, follow_up_at, last_contacted_at'),
    svc.from('email_log').select('to_email, sent_at').eq('kind', 'sales'),
  ]);
  const adminSet = new Set((adminRows.data || []).map((r: any) => String(r.email).toLowerCase()));
  // sales_leads may be missing if the migration hasn't run — the tab still
  // works, just without manual stages and notes.
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

  const lastSalesEmail = new Map<string, string>();
  for (const r of salesLog.data || []) {
    const k = String(r.to_email || '').toLowerCase();
    if (k && (!lastSalesEmail.has(k) || r.sent_at > lastSalesEmail.get(k)!)) lastSalesEmail.set(k, r.sent_at);
  }

  const now = Date.now();
  const leads: SalesLead[] = authUsers
    .filter((u: any) => u.email && !adminSet.has(String(u.email).toLowerCase()))
    .map((u: any) => {
      const meta = u.user_metadata || {};
      const plan = getPlan(meta.plan);
      const email = String(u.email).toLowerCase();
      const l = lookupsByUser.get(u.id) || { total: 0, month: 0, lastAt: null };
      const checkout = checkoutBy.get(u.id) || checkoutBy.get(email) || null;
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
        lastSignInAt: u.last_sign_in_at || null,
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
        lastEmailedAt: lastSalesEmail.get(email) || null,
        // The account-level opt-out. Resend's own unsubscribe list is
        // checked separately at send time.
        unsubscribed: meta.notify_fraud_trends === false,
      };
    })
    .sort((a, b) => (b.lastActiveAt || b.createdAt || '').localeCompare(a.lastActiveAt || a.createdAt || ''));

  return { leads, pipelineReady };
}

// ─── Recent lookups shown inside a sales email ────────────────────────────
// Only ever the RECIPIENT'S OWN lookups, in a private email to them. Lookups
// the user hid from their history are never included.

export type EmailLookup = {
  name: string;
  idLabel: string;            // "MC 123456" / "DOT 123456" / ""
  verdict: 'low' | 'medium' | 'high';
  score: number;
  topFlag: string | null;     // most severe warning sign, if any
  flagCount: number;          // critical + warning signs
  at: string;
};

export async function loadRecentLookups(svc: SupabaseClient, userIds: string[], perUser = 3): Promise<Map<string, EmailLookup[]>> {
  const out = new Map<string, EmailLookup[]>();
  if (userIds.length === 0) return out;
  // Pull a generous recent window per batch, then dedupe per user in JS.
  // Dedupe BEFORE anything else so the latest check of a company wins.
  const { data } = await svc
    .from('lookups')
    .select('user_id, name, mc, dot, score, verdict, data, created_at')
    .in('user_id', userIds)
    .is('hidden_at', null)
    .order('created_at', { ascending: false })
    .limit(Math.min(5000, userIds.length * 25));
  const seen = new Map<string, Set<string>>();
  for (const r of (data || []) as any[]) {
    const list = out.get(r.user_id) || [];
    if (list.length >= perUser) continue;
    const key = String(r.mc || r.dot || r.name || '').toLowerCase();
    const s = seen.get(r.user_id) || new Set<string>();
    if (!key || s.has(key)) continue;
    s.add(key); seen.set(r.user_id, s);
    const flags: any[] = Array.isArray(r.data?.flags) ? r.data.flags : [];
    const serious = flags.filter((f) => f?.sev === 'critical' || f?.sev === 'warning');
    serious.sort((a, b) => (a.sev === b.sev ? (b.pts || 0) - (a.pts || 0) : a.sev === 'critical' ? -1 : 1));
    const verdict = r.verdict === 'high' || r.verdict === 'medium' ? r.verdict : 'low';
    list.push({
      name: r.name || r.data?.name || 'Unknown company',
      idLabel: r.mc ? `MC ${r.mc}` : r.dot ? `DOT ${r.dot}` : '',
      verdict,
      score: typeof r.score === 'number' ? r.score : 0,
      topFlag: serious[0]?.title ? String(serious[0].title) : null,
      flagCount: serious.length,
      at: r.created_at,
    });
    out.set(r.user_id, list);
  }
  return out;
}

// ─── Merge tags ───────────────────────────────────────────────────────────

export const MERGE_TAGS = ['first_name', 'name', 'company', 'mc', 'plan', 'lookups_this_month', 'lookups_total', 'free_limit'] as const;

export function mergeVars(lead: Pick<SalesLead, 'name' | 'email' | 'company' | 'mc' | 'planLabel' | 'lookupsThisMonth' | 'lookupsTotal' | 'freeLimit'>): Record<string, string> {
  const first = (lead.name || '').trim().split(/\s+/)[0] || '';
  return {
    first_name: first || 'there',
    name: lead.name || first || 'there',
    company: lead.company || 'your company',
    mc: lead.mc || '',
    plan: lead.planLabel || 'Free',
    lookups_this_month: String(lead.lookupsThisMonth ?? 0),
    lookups_total: String(lead.lookupsTotal ?? 0),
    free_limit: lead.freeLimit == null ? 'unlimited' : String(lead.freeLimit),
  };
}

export function applyMergeTags(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => (k.toLowerCase() in vars ? vars[k.toLowerCase()] : m));
}
