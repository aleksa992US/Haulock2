import { getServiceSupabase } from './supabase/service';

export type RateCheckResult = { ok: true } | { ok: false; retryAfter: number; count: number; limit: number };

const DEFAULT_PER_MINUTE = 30;

// Sliding-window-ish rate limit: counts the user's lookup rows inserted in the
// past `windowMs` milliseconds. Since both the web UI and the public API insert
// into `lookups` on every successful FMCSA-hitting call, this naturally caps
// "real" calls without a separate events table.
export async function checkUserRateLimit(
  userId: string,
  perMinute: number = DEFAULT_PER_MINUTE,
  windowMs: number = 60_000,
): Promise<RateCheckResult> {
  const svc = getServiceSupabase();
  if (!svc) return { ok: true };

  const since = new Date(Date.now() - windowMs).toISOString();
  const { count } = await svc
    .from('lookups')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since);

  const used = count ?? 0;
  if (used >= perMinute) {
    return { ok: false, retryAfter: Math.ceil(windowMs / 1000), count: used, limit: perMinute };
  }
  return { ok: true };
}
