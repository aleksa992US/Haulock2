import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { loadSalesLeads, staleCompanies } from '@/lib/sales';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin-only. Which companies in these recipients' emails need a fresh
// scan before sending (last result older than 7 days, or a recipient's own
// company that was never scanned).
export async function POST(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const b = await req.json().catch(() => null) as { userIds?: string[]; maxAgeDays?: number } | null;
  const ids = new Set((b?.userIds || []).map(String));
  if (ids.size === 0) return NextResponse.json({ companies: [] });
  const { leads } = await loadSalesLeads(svc);
  const chosen = leads.filter((l) => ids.has(l.id));
  const maxAgeDays = Math.max(1, Math.min(90, Number(b?.maxAgeDays ?? 7)));
  const companies = await staleCompanies(svc, chosen, maxAgeDays);
  return NextResponse.json({ companies, maxAgeDays });
}
