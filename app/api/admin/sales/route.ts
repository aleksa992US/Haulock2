import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { loadSalesLeads } from '@/lib/sales';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin-only. Every non-admin user with the signals the Sales tab needs
// to decide who to contact and what to say, plus any manual pipeline
// stage / notes from the sales_leads table.
export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  try {
    const { leads, pipelineReady } = await loadSalesLeads(svc);
    return NextResponse.json({ leads, pipelineReady, adminEmail: me.email });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load leads' }, { status: 500 });
  }
}
