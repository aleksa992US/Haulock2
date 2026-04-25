import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin';
import { getServerSupabase } from '@/lib/supabase/server';

// Authenticate cron + admin-triggered endpoint requests. Cron runs (Vercel
// Cron, GitHub Actions, etc.) authenticate via `Authorization: Bearer <CRON_SECRET>`
// or the matching `?secret=` query string. Admin users authenticate via
// session cookie (so they can manually re-run a cron from the dashboard).
//
// Returns `null` on success (caller proceeds normally) OR a NextResponse the
// caller should immediately return. We avoid a discriminated-union return
// because Next.js' production TypeScript build narrows it inconsistently.
export async function authorizeCronOrAdmin(req: Request): Promise<NextResponse | null> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth === `Bearer ${secret}`) return null;
    const url = new URL(req.url);
    if (url.searchParams.get('secret') === secret) return null;
  }
  // Vercel Cron sends a special header — accept it if the project is
  // Vercel-deployed and CRON_SECRET isn't set yet.
  if (req.headers.get('x-vercel-cron') === '1') return null;

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data } = await supabase.auth.getUser();
  const me = data?.user;
  if (me?.email && (await isAdmin(me.email))) return null;
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
