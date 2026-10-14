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
  dot: string;
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

// PostgREST returns at most 1,000 rows per request, so a plain select
// silently drops the rest. Pages through by a unique column until done.
async function selectAll(build: () => any, orderBy: string): Promise<{ data: any[]; error: any }> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().order(orderBy, { ascending: true }).range(from, from + 999);
    if (error) return { data: out, error };
    out.push(...(data || []));
    if (!data || data.length < 1000) return { data: out, error: null };
  }
}

export async function loadSalesLeads(svc: SupabaseClient): Promise<{ leads: SalesLead[]; pipelineReady: boolean }> {
  const authUsers: any[] = [];
  for (let page = 1; ; page += 1) {
    const { data: authList, error: authErr } = await svc.auth.admin.listUsers({ perPage: 1000, page });
    if (authErr) throw new Error(authErr.message);
    const batch = authList?.users || [];
    authUsers.push(...batch);
    if (batch.length < 1000) break;
  }

  const [adminRows, lookupsAgg, cartRows, exitRows, leadRows, salesLog, teamRows] = await Promise.all([
    svc.from('admins').select('email'),
    selectAll(() => svc.from('lookups').select('id, user_id, source, created_at'), 'id'),
    selectAll(() => svc.from('cart_recovery_sends').select('id, user_id, to_email, sent_at'), 'id'),
    // May not exist in every environment — a missing table just yields no rows.
    selectAll(() => svc.from('exit_intent_events').select('id, user_id, user_email, plan, kind, created_at'), 'id'),
    selectAll(() => svc.from('sales_leads').select('user_id, stage, notes, follow_up_at, last_contacted_at'), 'user_id'),
    selectAll(() => svc.from('email_log').select('id, to_email, sent_at').eq('kind', 'sales'), 'id'),
    // Team members get the team's plan; without it, members of paying teams
    // showed up as Free leads.
    selectAll(() => svc.from('team_members').select('user_id, teams ( plan )'), 'user_id'),
  ]);
  const teamPlanByUser = new Map<string, string>();
  for (const m of teamRows.data || []) {
    const t = Array.isArray(m.teams) ? m.teams[0] : m.teams;
    if (t?.plan) teamPlanByUser.set(m.user_id, t.plan);
  }
  const adminSet = new Set((adminRows.data || []).map((r: any) => String(r.email).toLowerCase()));
  // sales_leads may be missing if the migration hasn't run — the tab still
  // works, just without manual stages and notes.
  const pipelineReady = !leadRows.error;

  // `month` mirrors the free-plan limit (only 'quick' lookups count, same
  // as /api/usage). `total` / `lastAt` are any real use of the product —
  // every source except 'auto', the background score of the user's own
  // company.
  const since = monthStart().toISOString();
  const lookupsByUser = new Map<string, { total: number; month: number; lastAt: string | null }>();
  for (const l of lookupsAgg.data || []) {
    if (l.source === 'auto') continue;
    const e = lookupsByUser.get(l.user_id) || { total: 0, month: 0, lastAt: null };
    e.total += 1;
    if (!e.lastAt || l.created_at > e.lastAt) e.lastAt = l.created_at;
    if (l.created_at >= since && l.source === 'quick') e.month += 1;
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
      const plan = getPlan(teamPlanByUser.get(u.id) || meta.plan);
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
        dot: meta.dot || '',
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
// Only ever the RECIPIENT'S OWN company lookups (quick lookups and rate con
// scans — not PDF forensics, COI checks or the background score of their own
// company), in a private email to them. Lookups the user hid are never
// included. If the admin re-scanned a company before sending, the fresher
// score from sales_rescans replaces the stored one.

const EMAIL_LOOKUP_SOURCES = ['quick', 'ratecon'];

export type EmailLookup = {
  key: string | null;         // "mc:123" / "dot:123" — null for name-only rows (can't re-scan)
  query: string | null;       // what /api/verify takes to re-scan it
  name: string;
  idLabel: string;            // "MC 123456" / "DOT 123456" / ""
  verdict: 'low' | 'medium' | 'high';
  score: number;
  topFlag: string | null;     // most severe warning sign, if any
  flagCount: number;          // critical + warning signs
  at: string;                 // when the user checked it
  recheckedAt: string | null; // when the admin re-scanned it, if newer
  // 'own' = the user has no lookups, so this is a free scan of their own
  // company (from their profile MC/DOT), shown "on us".
  sample?: 'own';
};

// Most severe critical/warning sign first, then the count of them.
export function summarizeFlags(flags: any[]): { topFlag: string | null; flagCount: number; top: { sev: string; title: string; pts: number }[] } {
  const serious = (Array.isArray(flags) ? flags : []).filter((f) => f?.sev === 'critical' || f?.sev === 'warning');
  serious.sort((a, b) => (a.sev === b.sev ? (b.pts || 0) - (a.pts || 0) : a.sev === 'critical' ? -1 : 1));
  return {
    topFlag: serious[0]?.title ? String(serious[0].title) : null,
    flagCount: serious.length,
    top: serious.slice(0, 5).map((f) => ({ sev: String(f.sev), title: String(f.title || ''), pts: Number(f.pts) || 0 })),
  };
}

export function companyKey(mc: unknown, dot: unknown): string | null {
  const m = String(mc ?? '').replace(/\D/g, '');
  const d = String(dot ?? '').replace(/\D/g, '');
  return m ? `mc:${m}` : d ? `dot:${d}` : null;
}

export async function loadRecentLookups(svc: SupabaseClient, userIds: string[], perUser = 3): Promise<Map<string, EmailLookup[]>> {
  const out = new Map<string, EmailLookup[]>();
  if (userIds.length === 0) return out;
  // Pull a generous recent window per batch, then dedupe per user in JS.
  // Dedupe BEFORE anything else so the latest check of a company wins.
  const { data } = await svc
    .from('lookups')
    .select('user_id, name, mc, dot, score, verdict, data, created_at')
    .in('user_id', userIds)
    .in('source', EMAIL_LOOKUP_SOURCES)
    .is('hidden_at', null)
    .order('created_at', { ascending: false })
    .limit(Math.min(5000, userIds.length * 25));
  const seen = new Map<string, Set<string>>();
  for (const r of (data || []) as any[]) {
    const list = out.get(r.user_id) || [];
    if (list.length >= perUser) continue;
    const key = companyKey(r.mc, r.dot);
    const dedupe = key || String(r.name || '').toLowerCase();
    const s = seen.get(r.user_id) || new Set<string>();
    if (!dedupe || s.has(dedupe)) continue;
    s.add(dedupe); seen.set(r.user_id, s);
    const { topFlag, flagCount } = summarizeFlags(r.data?.flags);
    const mc = String(r.mc ?? '').replace(/\D/g, '');
    const dot = String(r.dot ?? '').replace(/\D/g, '');
    list.push({
      key,
      query: mc ? `MC-${mc}` : dot ? `DOT-${dot}` : null,
      name: r.name || r.data?.name || 'Unknown company',
      idLabel: mc ? `MC ${mc}` : dot ? `DOT ${dot}` : '',
      verdict: r.verdict === 'high' || r.verdict === 'medium' ? r.verdict : 'low',
      score: typeof r.score === 'number' ? r.score : 0,
      topFlag,
      flagCount,
      at: r.created_at,
      recheckedAt: null,
    });
    out.set(r.user_id, list);
  }

  // Overlay fresher admin re-scans. Missing table → just the stored results.
  const keys = Array.from(new Set(Array.from(out.values()).flat().map((l) => l.key).filter(Boolean))) as string[];
  if (keys.length) {
    const { data: fresh } = await svc.from('sales_rescans').select('key, name, score, verdict, flags, scanned_at').in('key', keys);
    const byKey = new Map((fresh || []).map((f: any) => [f.key, f]));
    for (const list of Array.from(out.values())) {
      for (const l of list) {
        const f: any = l.key ? byKey.get(l.key) : null;
        if (!f || f.scanned_at <= l.at) continue;
        const { topFlag, flagCount } = summarizeFlags(f.flags);
        l.verdict = f.verdict === 'high' || f.verdict === 'medium' ? f.verdict : 'low';
        l.score = typeof f.score === 'number' ? f.score : l.score;
        l.topFlag = topFlag;
        l.flagCount = flagCount;
        l.recheckedAt = f.scanned_at;
        if (f.name) l.name = f.name;
      }
    }
  }
  return out;
}

export type LeadIdentity = { id: string; mc?: string | null; dot?: string | null; company?: string | null };

// What a sales email shows for each recipient: their own recent company
// lookups, or — when they have none — a free scan of their OWN company
// (profile MC/DOT): the newest of an admin re-scan or the background
// own-company score. No data at all → empty, and the email falls back to
// the labelled example.
export async function loadEmailLookups(svc: SupabaseClient, leads: LeadIdentity[]): Promise<Map<string, EmailLookup[]>> {
  const out = await loadRecentLookups(svc, leads.map((l) => l.id));
  const needOwn = leads.filter((l) => !(out.get(l.id)?.length) && companyKey(l.mc, l.dot));
  if (needOwn.length === 0) return out;
  const keys = needOwn.map((l) => companyKey(l.mc, l.dot)!);
  const [fresh, autos] = await Promise.all([
    svc.from('sales_rescans').select('key, name, score, verdict, flags, scanned_at').in('key', keys),
    svc.from('lookups').select('user_id, name, score, verdict, data, created_at')
      .in('user_id', needOwn.map((l) => l.id)).eq('source', 'auto')
      .order('created_at', { ascending: false }).limit(needOwn.length * 5),
  ]);
  const rescanByKey = new Map((fresh.data || []).map((f: any) => [f.key, f]));
  const autoByUser = new Map<string, any>();
  for (const a of (autos.data || []) as any[]) if (!autoByUser.has(a.user_id)) autoByUser.set(a.user_id, a);
  for (const lead of needOwn) {
    const key = companyKey(lead.mc, lead.dot)!;
    const r: any = rescanByKey.get(key);
    const a: any = autoByUser.get(lead.id);
    const pick = r && (!a || r.scanned_at > a.created_at)
      ? { name: r.name, score: r.score, verdict: r.verdict, flags: r.flags, at: r.scanned_at }
      : a ? { name: a.name || a.data?.name, score: a.score, verdict: a.verdict, flags: a.data?.flags, at: a.created_at } : null;
    if (!pick) continue;
    const { topFlag, flagCount } = summarizeFlags(pick.flags);
    const mc = String(lead.mc ?? '').replace(/\D/g, '');
    const dot = String(lead.dot ?? '').replace(/\D/g, '');
    out.set(lead.id, [{
      key,
      query: mc ? `MC-${mc}` : `DOT-${dot}`,
      name: pick.name || lead.company || 'Your company',
      idLabel: mc ? `MC ${mc}` : `DOT ${dot}`,
      verdict: pick.verdict === 'high' || pick.verdict === 'medium' ? pick.verdict : 'low',
      score: typeof pick.score === 'number' ? pick.score : 0,
      topFlag,
      flagCount,
      at: pick.at,
      recheckedAt: null,
      sample: 'own',
    }]);
  }
  return out;
}

// Companies in these recipients' emails whose newest result (their own
// check, an admin re-scan, or the own-company score) is older than
// maxAgeDays, or that have never been scanned (a recipient's own company
// with no score yet). The composer re-scans these before sending.
export async function staleCompanies(svc: SupabaseClient, leads: LeadIdentity[], maxAgeDays = 7): Promise<{ key: string; query: string; name: string; lastCheckedAt: string | null }[]> {
  const byUser = await loadEmailLookups(svc, leads);
  const cutoff = new Date(Date.now() - maxAgeDays * DAY).toISOString();
  const out = new Map<string, { key: string; query: string; name: string; lastCheckedAt: string | null }>();
  for (const lead of leads) {
    const list = byUser.get(lead.id) || [];
    if (list.length === 0) {
      // Own company never scanned — the "on us" scan has to run first.
      const key = companyKey(lead.mc, lead.dot);
      if (!key || out.has(key)) continue;
      const mc = String(lead.mc ?? '').replace(/\D/g, '');
      const dot = String(lead.dot ?? '').replace(/\D/g, '');
      out.set(key, { key, query: mc ? `MC-${mc}` : `DOT-${dot}`, name: lead.company || (mc ? `MC ${mc}` : `DOT ${dot}`), lastCheckedAt: null });
      continue;
    }
    for (const l of list) {
      if (!l.key || !l.query) continue;
      const newest = l.recheckedAt && l.recheckedAt > l.at ? l.recheckedAt : l.at;
      const prev = out.get(l.key);
      const lastCheckedAt = prev?.lastCheckedAt && prev.lastCheckedAt > newest ? prev.lastCheckedAt : newest;
      out.set(l.key, { key: l.key, query: l.query, name: l.name, lastCheckedAt });
    }
  }
  return Array.from(out.values()).filter((c) => !c.lastCheckedAt || c.lastCheckedAt < cutoff);
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
