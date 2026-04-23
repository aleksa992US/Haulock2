import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { getPlan, monthStart } from '@/lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  // Page through all auth users (up to 1000 for MVP)
  const { data: authList, error: authErr } = await svc.auth.admin.listUsers({ perPage: 1000, page: 1 });
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 });
  const authUsers = authList?.users || [];

  // Fetch admin set
  const { data: adminRows } = await svc.from('admins').select('email');
  const adminSet = new Set((adminRows || []).map((r: any) => String(r.email).toLowerCase()));

  // Aggregate usage per user. One query per aggregation for simplicity.
  const since = monthStart().toISOString();
  const [lookupsAgg, watchlistAgg, fraudAgg] = await Promise.all([
    svc.from('lookups').select('user_id, source, created_at'),
    svc.from('watchlist').select('user_id'),
    svc.from('fraud_reports').select('reporter_user_id'),
  ]);
  const lookupsByUser = new Map<string, { total: number; quickMonth: number; scanMonth: number; lastAt: string | null }>();
  for (const l of lookupsAgg.data || []) {
    const key = l.user_id;
    const entry = lookupsByUser.get(key) || { total: 0, quickMonth: 0, scanMonth: 0, lastAt: null };
    entry.total += 1;
    const created = l.created_at;
    if (!entry.lastAt || created > entry.lastAt) entry.lastAt = created;
    if (created >= since) {
      if (l.source === 'ratecon') entry.scanMonth += 1;
      else entry.quickMonth += 1;
    }
    lookupsByUser.set(key, entry);
  }
  const watchlistByUser = new Map<string, number>();
  for (const w of watchlistAgg.data || []) {
    watchlistByUser.set(w.user_id, (watchlistByUser.get(w.user_id) || 0) + 1);
  }
  const fraudByUser = new Map<string, number>();
  for (const f of fraudAgg.data || []) {
    fraudByUser.set(f.reporter_user_id, (fraudByUser.get(f.reporter_user_id) || 0) + 1);
  }

  const users = authUsers.map((u: any) => {
    const meta = u.user_metadata || {};
    const l = lookupsByUser.get(u.id) || { total: 0, quickMonth: 0, scanMonth: 0, lastAt: null };
    const plan = getPlan(meta.plan);
    return {
      id: u.id,
      email: u.email,
      name: meta.full_name || meta.name || '',
      company: meta.company || '',
      mc: meta.mc || '',
      plan: plan.id,
      planLabel: plan.label,
      isAdmin: adminSet.has(String(u.email || '').toLowerCase()),
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at,
      confirmedAt: u.email_confirmed_at,
      usage: {
        lookupsTotal: l.total,
        lookupsThisMonth: l.quickMonth,
        scansThisMonth: l.scanMonth,
        watchlist: watchlistByUser.get(u.id) || 0,
        fraudReports: fraudByUser.get(u.id) || 0,
        lastLookupAt: l.lastAt,
      },
      limits: plan.limits,
    };
  }).sort((a, b) => (b.lastSignInAt || b.createdAt || '').localeCompare(a.lastSignInAt || a.createdAt || ''));

  return NextResponse.json({ users, total: users.length });
}
