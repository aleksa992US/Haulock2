import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Surfaces Supabase database size + per-table breakdown so the operator
// can decide when to upgrade plans. Backed by the haulock_storage_stats()
// SQL function (defined in supabase/schema.sql) which uses Postgres'
// pg_database_size / pg_total_relation_size primitives.
export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const { data, error } = await svc.rpc('haulock_storage_stats');
  if (error) {
    return NextResponse.json(
      {
        error: error.message,
        hint: 'Did you run the haulock_storage_stats() function in supabase/schema.sql? Re-run the schema once in the Supabase SQL editor.',
      },
      { status: 500 },
    );
  }
  // Honest plan-limit reporting: read the actual provisioned disk size
  // from env (operator sets this to match what's allocated in the
  // Supabase dashboard). Default to 8 GB which matches Supabase's stock
  // Pro / Micro allocation, so the chart works out-of-the-box on most
  // setups without configuration.
  const diskGb = Number(process.env.SUPABASE_DISK_GB) || 8;
  // System / WAL overhead estimate. Supabase reserves ~0.9-1.0 GB on a
  // fresh Pro project for the WAL, replication slots, and system tables.
  // We surface this so the user's mental model matches what they see in
  // the Supabase dashboard instead of being silently surprised.
  const systemReserveGb = Number(process.env.SUPABASE_SYSTEM_RESERVE_GB) || 1;
  return NextResponse.json({
    ...data,
    plan: {
      disk_bytes: diskGb * 1024 * 1024 * 1024,
      disk_gb: diskGb,
      system_reserve_bytes: systemReserveGb * 1024 * 1024 * 1024,
      system_reserve_gb: systemReserveGb,
      // What's left for actual database growth, in bytes.
      effective_db_budget_bytes: Math.max(0, (diskGb - systemReserveGb) * 1024 * 1024 * 1024),
    },
  });
}
