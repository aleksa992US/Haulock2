import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { checkSimpleRateLimit } from '@/lib/rate-limit';
import { currentVerification } from '@/lib/company-profile';
import { RESPONSE_MAX } from '@/lib/reports';
import { logReportEvent, refreshCompanyPage } from '@/lib/reports-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Actions on one report:
//   { action: 'withdraw' }                 → the reporter takes it down
//   { action: 'resolve' }                  → the reporter marks it settled (stays on record, stops counting)
//   { action: 'respond', body, disputes }  → the reported company's public reply (verified owner only)
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Reports aren’t set up on this server yet.' }, { status: 503 });

  const id = String(params.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { action?: string; body?: string; disputes?: boolean } | null;
  const { data: report } = await svc
    .from('company_reports')
    .select('id, reporter_user_id, status, subject_type, subject_mc, subject_dot, subject_name, resolved_at')
    .eq('id', id)
    .maybeSingle();
  if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 });

  if (b?.action === 'withdraw' || b?.action === 'resolve') {
    if (report.reporter_user_id !== user.id) return NextResponse.json({ error: 'Only the person who filed this report can change it.' }, { status: 403 });
    if (b.action === 'withdraw') {
      if (report.status !== 'pending' && report.status !== 'published') return NextResponse.json({ error: 'This report is already closed.' }, { status: 400 });
      const { error } = await svc.from('company_reports').update({ status: 'withdrawn' }).eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await logReportEvent(svc, id, user.email, 'withdrawn');
      refreshCompanyPage(report);
      return NextResponse.json({ ok: true, status: 'withdrawn' });
    }
    if (report.status !== 'published') return NextResponse.json({ error: 'Only a published report can be marked resolved.' }, { status: 400 });
    const resolvedAt = report.resolved_at || new Date().toISOString();
    const { error } = await svc.from('company_reports').update({ resolved_at: resolvedAt }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logReportEvent(svc, id, user.email, 'resolved');
    refreshCompanyPage(report);
    return NextResponse.json({ ok: true, resolvedAt });
  }

  if (b?.action === 'respond') {
    if (report.status !== 'published') return NextResponse.json({ error: 'You can reply once the report is published.' }, { status: 400 });
    // Only someone who proved the reported company is theirs.
    const v = currentVerification(user);
    const owns = Boolean(v && ((report.subject_dot && v.dot === report.subject_dot) || (report.subject_mc && v.mc === report.subject_mc)));
    if (!owns) {
      return NextResponse.json({
        error: report.subject_type === 'shipper'
          ? 'To reply for a shipper, write to contact@haulock.com from your company email and we’ll post your reply.'
          : `To reply, verify that ${report.subject_name} is your company (free): Settings → Profile, then “Verify my company”.`,
        code: 'not_verified',
      }, { status: 403 });
    }
    const rl = checkSimpleRateLimit({ bucket: 'report-respond', identity: user.id, max: 20, windowMs: 24 * 60 * 60_000 });
    if (!rl.ok) return NextResponse.json({ error: 'Too many replies today. Try again tomorrow.' }, { status: 429 });
    const body = String(b.body || '').trim();
    if (body.length < 20) return NextResponse.json({ error: 'Write at least a sentence: what happened from your side.' }, { status: 400 });
    if (body.length > RESPONSE_MAX) return NextResponse.json({ error: `Keep the reply under ${RESPONSE_MAX} characters.` }, { status: 400 });
    const now = new Date().toISOString();
    const { error } = await svc.from('company_report_responses').upsert({
      report_id: id,
      responder_user_id: user.id,
      responder_name: report.subject_name,
      body,
      disputes: Boolean(b.disputes),
      updated_at: now,
    }, { onConflict: 'report_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logReportEvent(svc, id, user.email, 'responded', b.disputes ? 'disputes the report' : null);
    return NextResponse.json({ ok: true, response: { name: report.subject_name, body, disputes: Boolean(b.disputes), at: now } });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
