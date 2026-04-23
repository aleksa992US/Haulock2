import { getServiceSupabase } from './supabase/service';

export type RateCheckResult = {
  ok: boolean;
  retryAfter: number;
  count: number;
  limit: number;
};

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
  const retryAfter = Math.ceil(windowMs / 1000);
  if (!svc) return { ok: true, retryAfter, count: 0, limit: perMinute };

  const since = new Date(Date.now() - windowMs).toISOString();
  const { count } = await svc
    .from('lookups')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since);

  const used = count ?? 0;
  return { ok: used < perMinute, retryAfter, count: used, limit: perMinute };
}
