import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { buildCoiReport } from '@/lib/coi-check';
import { checkSimpleRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Re-check a saved COI against today's FMCSA data: same certificate reading
// (the PDF itself is never stored), fresh carrier record and insurance
// filings — e.g. a cancellation filed since the first check. Updates that
// history entry; doesn't use a COI credit (no new document read).
export async function POST(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  // Free of credits, but each run makes several FMCSA calls on our key.
  const rl = checkSimpleRateLimit({ bucket: 'coi-recheck', identity: user.id, max: 20, windowMs: 60 * 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'Too many re-checks — try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });

  const b = await req.json().catch(() => null) as { id?: string } | null;
  if (!b?.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  // RLS limits this to the user's own rows.
  const { data: row, error } = await supabase
    .from('lookups')
    .select('id, data, source')
    .eq('id', b.id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error || !row) return NextResponse.json({ error: 'COI check not found' }, { status: 404 });
  const saved: any = row.data || {};
  if (row.source !== 'coi' || !saved.extraction) {
    return NextResponse.json({ error: 'This history entry has no saved certificate reading. Upload the COI again.' }, { status: 422 });
  }

  let report: any;
  try {
    report = await buildCoiReport(saved.extraction, {
      filename: saved.filename,
      mc: saved.mc || null,
      dot: saved.dot || null,
      forensics: saved.forensics ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Re-check failed' }, { status: 502 });
  }
  report.recheckedAt = new Date().toISOString();

  await supabase.from('lookups').update({
    name: report.name,
    mc: report.mc || null,
    dot: report.dot || null,
    score: report.score,
    verdict: report.verdict === 'mismatch' ? 'high' : report.verdict === 'verify' ? 'medium' : 'low',
    data: report,
  }).eq('id', row.id).eq('user_id', user.id);

  return NextResponse.json(report);
}
