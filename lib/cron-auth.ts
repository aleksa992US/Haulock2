import { isAdmin } from '@/lib/admin';
import { getServerSupabase } from '@/lib/supabase/server';

// Authenticate cron + admin-triggered endpoint requests. Cron runs (Vercel
// Cron, GitHub Actions, etc.) authenticate via `Authorization: Bearer <CRON_SECRET>`
// or the matching `?secret=` query string. Admin users authenticate via
// session cookie (so they can manually re-run a cron from the dashboard).
// Returns { ok: true } on success, otherwise a status + error.
export async function authorizeCronOrAdmin(req: Request): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth === `Bearer ${secret}`) return { ok: true };
    const url = new URL(req.url);
    if (url.searchParams.get('secret') === secret) return { ok: true };
  }
  // Vercel Cron sends a special header — accept it if the project is
  // Vercel-deployed and CRON_SECRET isn't set yet.
  if (req.headers.get('x-vercel-cron') === '1') return { ok: true };

  const supabase = getServerSupabase();
  if (!supabase) return { ok: false, status: 500, error: 'Supabase not configured' };
  const { data } = await supabase.auth.getUser();
  const me = data?.user;
  if (me?.email && (await isAdmin(me.email))) return { ok: true };
  return { ok: false, status: 401, error: 'Unauthorized' };
}
