import { getServiceSupabase } from './supabase/service';

// Sync env-only check. Used for bootstrap + hot-path where we can't await.
export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}

// In-memory cache of admins table. Refreshed every 30s.
let dbAdminsCache: { at: number; set: Set<string> } | null = null;
const DB_ADMINS_TTL_MS = 30_000;

async function getDbAdmins(): Promise<Set<string>> {
  const now = Date.now();
  if (dbAdminsCache && now - dbAdminsCache.at < DB_ADMINS_TTL_MS) return dbAdminsCache.set;
  const supa = getServiceSupabase();
  if (!supa) return new Set();
  const { data } = await supa.from('admins').select('email');
  const set = new Set((data || []).map((r: any) => String(r.email).toLowerCase()));
  dbAdminsCache = { at: now, set };
  return set;
}

export function invalidateAdminCache() {
  dbAdminsCache = null;
}

// Async check: env OR admins table.
export async function isAdmin(email?: string | null): Promise<boolean> {
  if (!email) return false;
  if (isAdminEmail(email)) return true;
  const set = await getDbAdmins();
  return set.has(email.toLowerCase());
}
