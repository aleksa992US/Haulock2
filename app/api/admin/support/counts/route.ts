import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Lightweight admin endpoint: returns just the open-ticket count for the
// sidebar badge. The full ticket list lives at /api/admin/support, but the
// sidebar polls this on every page load so we keep it cheap — three head
// queries with `count: 'exact'`, no joins, no user-metadata lookups.
export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  // Non-admins get a 200 with zero counts so the sidebar never renders an
  // alarming "auth failed" badge for regular users. They simply won't see
  // the Admin link at all (gated upstream).
  if (!me?.email || !(await isAdmin(me.email))) {
    return NextResponse.json({ open: 0, working: 0, solved: 0, total: 0 });
  }

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const [openRes, workingRes, solvedRes] = await Promise.all([
    svc.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    svc.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'working'),
    svc.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'solved'),
  ]);

  const open = openRes.count ?? 0;
  const working = workingRes.count ?? 0;
  const solved = solvedRes.count ?? 0;
  return NextResponse.json({ open, working, solved, total: open + working + solved });
}
