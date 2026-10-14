import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { companyKey, summarizeFlags } from '@/lib/sales';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin-only. The composer re-runs /api/verify (force=1, the same full scan
// users see) for each stale company, then posts the report here. We keep
// only what a sales email shows: score, verdict and the serious flags.
export async function POST(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const b = await req.json().catch(() => null) as { key?: string; report?: any } | null;
  const report = b?.report;
  if (!b?.key || !report) return NextResponse.json({ error: 'key and report are required' }, { status: 400 });
  // The scan must be of the company we asked about — FMCSA can resolve a
  // number to a different record, and we'd rather keep the old result.
  const key = companyKey(report.mc, report.dot);
  const altKey = companyKey(null, report.dot);
  if (key !== b.key && altKey !== b.key) {
    return NextResponse.json({ error: `Scan returned a different company (${key || 'unknown'})`, mismatch: true }, { status: 409 });
  }
  if (typeof report.score !== 'number') return NextResponse.json({ error: 'Report has no score' }, { status: 400 });

  const { top } = summarizeFlags(report.flags);
  const row = {
    key: b.key,
    name: report.name ? String(report.name).slice(0, 200) : null,
    mc: report.mc ? String(report.mc) : null,
    dot: report.dot ? String(report.dot) : null,
    score: Math.round(report.score),
    verdict: report.verdict === 'high' || report.verdict === 'medium' ? report.verdict : 'low',
    flags: top,
    scanned_at: new Date().toISOString(),
    scanned_by: me.email,
  };
  const { error } = await svc.from('sales_rescans').upsert(row, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, rescan: row });
}
