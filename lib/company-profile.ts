import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { fetchCensusContact, dotForMc } from './fmcsa-census';

// "Your company" for a signed-in user: which MC/DOT they say is theirs,
// whether FMCSA's own record backs that up, and — for verified owners —
// how often other Haulock users have checked that company. Never who.

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com', 'comcast.net', 'att.net', 'sbcglobal.net', 'verizon.net',
  'protonmail.com', 'proton.me', 'mail.com', 'gmx.com', 'zoho.com', 'yandex.com',
]);

export type CompanyVerification = { mc: string | null; dot: string | null; by: 'email' | 'domain' | 'code'; at: string };

export function ownIds(user: User): { mc: string | null; dot: string | null } {
  const meta: any = user.user_metadata || {};
  const mc = String(meta.mc || '').replace(/\D/g, '').replace(/^0+/, '') || null;
  const dot = String(meta.dot || '').replace(/\D/g, '').replace(/^0+/, '') || null;
  return { mc, dot };
}

// Verification lives in app_metadata, which only the server can write, and
// only counts for the MC/DOT it was made for.
export function currentVerification(user: User): CompanyVerification | null {
  const v: any = (user.app_metadata || {}).company_verification;
  if (!v) return null;
  const { mc, dot } = ownIds(user);
  if ((mc && v.mc === mc) || (dot && v.dot === dot)) return v as CompanyVerification;
  return null;
}

// "dispatch@starbg.us" → "d••••••h@starbg.us" — enough to recognise, not to harvest.
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '';
  const head = local.slice(0, 1);
  const tail = local.length > 2 ? local.slice(-1) : '';
  return `${head}${'•'.repeat(Math.max(2, local.length - head.length - tail.length))}${tail}@${domain}`;
}

export async function resolveOwnDot(mc: string | null, dot: string | null): Promise<string | null> {
  return dot || (mc ? await dotForMc(mc) : null);
}

// Match the login email against the email on the company's MCS-150 filing:
// the exact address, or the same company domain (never a free-mail domain).
export async function verifyCompanyOwnership(user: User): Promise<
  | { ok: true; verification: CompanyVerification }
  | { ok: false; reason: 'no_company' | 'no_fmcsa_email' | 'no_match' | 'lookup_failed'; emailOnFile?: string }
> {
  const { mc, dot } = ownIds(user);
  if (!mc && !dot) return { ok: false, reason: 'no_company' };
  const usdot = await resolveOwnDot(mc, dot);
  if (!usdot) return { ok: false, reason: 'lookup_failed' };
  const census = await fetchCensusContact(usdot);
  if (!census) return { ok: false, reason: 'lookup_failed' };
  if (!census.email) return { ok: false, reason: 'no_fmcsa_email' };
  const login = String(user.email || '').trim().toLowerCase();
  const onFile = census.email.toLowerCase();
  const loginDomain = login.split('@')[1] || '';
  const fileDomain = onFile.split('@')[1] || '';
  let by: 'email' | 'domain' | null = null;
  if (login && login === onFile) by = 'email';
  else if (loginDomain && loginDomain === fileDomain && !FREE_EMAIL_DOMAINS.has(loginDomain)) by = 'domain';
  if (!by) return { ok: false, reason: 'no_match', emailOnFile: maskEmail(onFile) };
  return { ok: true, verification: { mc, dot: usdot, by, at: new Date().toISOString() } };
}

export type CheckStats = {
  last7: number;
  last30: number;
  distinctAccounts30: number;
  weeks: { weekStart: string; count: number }[]; // oldest → newest, 12 weeks
  lastCheckedDaysAgo: number | null;
  byKind30: { lookups: number; rateCons: number; cois: number };
};

// How often OTHER Haulock accounts checked this company: quick lookups,
// rate con scans naming it, and COI checks. Counts only — never user ids,
// names or exact times. The user's own account and teammates are excluded.
export async function companyCheckStats(svc: SupabaseClient, ids: { mc: string | null; dot: string | null }, excludeUserIds: string[]): Promise<CheckStats> {
  const since = new Date(Date.now() - 84 * 86400000);
  const ors = [ids.mc ? `mc.eq.${ids.mc}` : null, ids.dot ? `dot.eq.${ids.dot}` : null].filter(Boolean).join(',');
  const { data } = await svc
    .from('lookups')
    .select('user_id, source, created_at')
    .or(ors)
    .in('source', ['quick', 'ratecon', 'coi'])
    .gte('created_at', since.toISOString())
    .limit(5000);
  const rows = (data || []).filter((r: any) => !excludeUserIds.includes(r.user_id));
  const now = Date.now();
  const d7 = now - 7 * 86400000;
  const d30 = now - 30 * 86400000;
  // Monday-start weeks, oldest first.
  const monday = (t: number) => { const d = new Date(t); const day = (d.getUTCDay() + 6) % 7; d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - day); return d.getTime(); };
  const thisWeek = monday(now);
  const weeks = Array.from({ length: 12 }, (_, i) => ({ weekStart: new Date(thisWeek - (11 - i) * 7 * 86400000).toISOString().slice(0, 10), count: 0 }));
  let last7 = 0, last30 = 0, newest = 0;
  const accounts30 = new Set<string>();
  const byKind30 = { lookups: 0, rateCons: 0, cois: 0 };
  for (const r of rows as any[]) {
    const t = new Date(r.created_at).getTime();
    if (t > newest) newest = t;
    if (t >= d7) last7++;
    if (t >= d30) {
      last30++;
      accounts30.add(r.user_id);
      if (r.source === 'ratecon') byKind30.rateCons++; else if (r.source === 'coi') byKind30.cois++; else byKind30.lookups++;
    }
    const idx = 11 - Math.floor((thisWeek - monday(t)) / (7 * 86400000));
    if (idx >= 0 && idx < 12) weeks[idx].count++;
  }
  return {
    last7, last30, distinctAccounts30: accounts30.size, weeks,
    lastCheckedDaysAgo: newest ? Math.floor((now - newest) / 86400000) : null,
    byKind30,
  };
}

// Toast feed: how many checks by OTHER accounts landed in (since, until].
// `until` trails real time (see NOTIFY_DELAY_MS) and results are grouped, so
// a toast can't be matched to one searcher by its timing.
export const NOTIFY_DELAY_MS = 15 * 60 * 1000;

export async function companyChecksSince(
  svc: SupabaseClient,
  ids: { mc: string | null; dot: string | null },
  excludeUserIds: string[],
  sinceIso: string,
  untilIso: string,
): Promise<number> {
  const ors = [ids.mc ? `mc.eq.${ids.mc}` : null, ids.dot ? `dot.eq.${ids.dot}` : null].filter(Boolean).join(',');
  if (!ors) return 0;
  const { data } = await svc
    .from('lookups')
    .select('user_id')
    .or(ors)
    .in('source', ['quick', 'ratecon', 'coi'])
    .gt('created_at', sinceIso)
    .lte('created_at', untilIso)
    .limit(1000);
  return (data || []).filter((r: any) => !excludeUserIds.includes(r.user_id)).length;
}


// ─── Verification by emailed code ─────────────────────────────────────────
// For owners who don't sign in with a company-domain email: a 6-digit code
// goes to the email on the company's FMCSA filing. Only its HMAC is stored,
// in app_metadata (server-only), with an expiry, an attempt limit and a send
// limit.

const CODE_TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 3;

function codeSecret(): string {
  return process.env.COMPANY_VERIFY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'haulock-company-verify';
}
function hashCode(userId: string, code: string): string {
  return createHmac('sha256', codeSecret()).update(`${userId}:${code}`).digest('hex');
}

export type PendingCodeVerification = {
  mc: string | null; dot: string | null; codeHash: string; expiresAt: string; attempts: number; sentTo: string; sends: string[];
};

export async function createVerificationCode(user: User): Promise<
  | { ok: true; code: string; email: string; companyName: string; pending: PendingCodeVerification }
  | { ok: false; reason: 'no_company' | 'no_fmcsa_email' | 'lookup_failed' | 'too_many'; error: string }
> {
  const { mc, dot } = ownIds(user);
  if (!mc && !dot) return { ok: false, reason: 'no_company', error: 'Set your MC or DOT in Settings → Profile first.' };
  const usdot = await resolveOwnDot(mc, dot);
  const census = usdot ? await fetchCensusContact(usdot) : null;
  if (!census) return { ok: false, reason: 'lookup_failed', error: 'We couldn’t reach FMCSA’s records right now. Try again in a minute.' };
  if (!census.email) return { ok: false, reason: 'no_fmcsa_email', error: 'Your company’s FMCSA filing has no email address. Contact support to verify another way.' };
  const prev: any = (user.app_metadata || {}).company_verification_pending;
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const sends: string[] = (Array.isArray(prev?.sends) ? prev.sends : []).filter((t: string) => Date.parse(t) > hourAgo);
  if (sends.length >= MAX_SENDS_PER_HOUR) return { ok: false, reason: 'too_many', error: 'We’ve sent 3 codes in the last hour. Check that inbox (and spam), or try again later.' };
  const code = String(randomInt(100000, 1000000));
  const pending: PendingCodeVerification = {
    mc, dot: usdot, codeHash: hashCode(user.id, code), expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    attempts: 0, sentTo: maskEmail(census.email), sends: [...sends, new Date().toISOString()],
  };
  return { ok: true, code, email: census.email, companyName: census.legalName || (mc ? `MC-${mc}` : `DOT-${usdot}`), pending };
}

export function checkVerificationCode(user: User, code: string): { ok: true; verification: CompanyVerification } | { ok: false; error: string; pending?: PendingCodeVerification | null } {
  const pending: PendingCodeVerification | undefined = (user.app_metadata || {}).company_verification_pending;
  const { mc, dot } = ownIds(user);
  if (!pending || !((mc && pending.mc === mc) || (dot && pending.dot === dot))) return { ok: false, error: 'No code was sent for this company. Send a new one.' };
  if (Date.parse(pending.expiresAt) < Date.now()) return { ok: false, error: 'That code has expired. Send a new one.', pending: null };
  if (pending.attempts >= MAX_ATTEMPTS) return { ok: false, error: 'Too many wrong codes. Send a new one.', pending: null };
  const given = hashCode(user.id, String(code || '').replace(/\D/g, ''));
  const a = Buffer.from(given, 'hex');
  const b = Buffer.from(pending.codeHash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: `That code isn’t right. ${MAX_ATTEMPTS - pending.attempts - 1} tr${MAX_ATTEMPTS - pending.attempts - 1 === 1 ? 'y' : 'ies'} left.`, pending: { ...pending, attempts: pending.attempts + 1 } };
  }
  return { ok: true, verification: { mc: pending.mc, dot: pending.dot, by: 'code', at: new Date().toISOString() } };
}
