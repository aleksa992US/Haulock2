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

// ---------------------------------------------------------------------------
// Generic in-memory sliding-window limiter
// ---------------------------------------------------------------------------
//
// For endpoints that don't write to `lookups` (newsletter signup, support
// tickets, fraud reports). Keyed by `<endpoint>:<identity>` where identity is
// the user id when authenticated, otherwise the request IP.
//
// In-memory means: each serverless function instance has its own counter.
// That's fine for spam protection — an attacker would need to reach many
// cold instances to bypass it, and even then they'd still hit Vercel's
// global concurrency limits and Resend's per-second cap. For a global
// Redis-backed limiter, swap this implementation for Upstash / Vercel KV
// later without changing the call sites.

const buckets = new Map<string, number[]>();

export type SimpleRateLimitOpts = {
  // Endpoint name — keeps each rate-limited route's bucket isolated.
  bucket: string;
  // Stable identifier for this caller (user id, hashed IP, etc.).
  identity: string;
  // Max requests permitted in the window.
  max: number;
  // Window length in ms.
  windowMs: number;
};

export function checkSimpleRateLimit(opts: SimpleRateLimitOpts): RateCheckResult {
  const now = Date.now();
  const key = `${opts.bucket}:${opts.identity}`;
  const cutoff = now - opts.windowMs;
  const arr = (buckets.get(key) || []).filter((ts) => ts > cutoff);
  // Trim very old buckets occasionally to prevent unbounded growth across
  // 1000s of IPs hitting the limiter once. Cheap heuristic: every ~50 calls,
  // sweep buckets that are entirely outside any active window.
  if (Math.random() < 0.02) {
    for (const [k, v] of buckets.entries()) {
      if (v.length === 0 || v[v.length - 1] < cutoff - opts.windowMs) buckets.delete(k);
    }
  }
  const limit = opts.max;
  const count = arr.length;
  if (count >= limit) {
    const oldest = arr[0] ?? now;
    const retryAfter = Math.max(1, Math.ceil((oldest + opts.windowMs - now) / 1000));
    return { ok: false, retryAfter, count, limit };
  }
  arr.push(now);
  buckets.set(key, arr);
  return { ok: true, retryAfter: Math.ceil(opts.windowMs / 1000), count: count + 1, limit };
}

// Pull a "best-effort" identity from the request: prefer the authenticated
// user id, otherwise the first non-private IP from x-forwarded-for, otherwise
// the connecting IP, otherwise a stable "unknown" bucket. Hashed lightly so
// raw IPs never end up in logs that include rate-limit keys.
export function identityFromRequest(req: Request, userId?: string | null): string {
  if (userId) return `u:${userId}`;
  const fwd = (req.headers.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ip = fwd[0] || req.headers.get('x-real-ip') || 'unknown';
  // 8-char hash so we don't store raw IPs in the in-memory map.
  let h = 0;
  for (let i = 0; i < ip.length; i++) h = ((h << 5) - h + ip.charCodeAt(i)) | 0;
  return `ip:${(h >>> 0).toString(16).padStart(8, '0')}`;
}
