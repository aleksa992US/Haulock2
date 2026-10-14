import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { resolveTeamContext } from '@/lib/teams';
import { isDocAiConfigured } from '@/lib/google-docai';
import { isAnthropicConfigured } from '@/lib/anthropic';
import { ocrForScan, PipelineError } from '@/lib/rate-con-pipeline';
import { runCoiCheckFromText } from '@/lib/coi-check';
import { countMonthlyLookups } from '@/lib/usage';
import { isAdmin } from '@/lib/admin';
import { PLANS, enforcedPlanId } from '@/lib/plans';
import { COI_CHECK_ON } from '@/lib/features';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST multipart/form-data: file (COI PDF/PNG/JPG), optional mc / dot of the
// carrier the broker is checking. Returns a CoiReport and saves it to history
// as source='coi'.
export async function POST(req: Request) {
  if (!isDocAiConfigured()) return NextResponse.json({ error: 'Google Document AI is not configured' }, { status: 500 });
  if (!isAnthropicConfigured()) return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 });

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  // Not launched yet: admins only (lib/features.ts).
  if (!COI_CHECK_ON && !(await isAdmin(user.email))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const ctx = await resolveTeamContext(user.id, enforcedPlanId(user));
  const plan = ctx.effectivePlan;
  const cap = plan.limits.coiChecks;
  if (cap === 0 && !(await isAdmin(user.email))) {
    return NextResponse.json({
      error: `COI checks are included on paid plans. The Carrier plan includes ${PLANS.carrier.limits.coiChecks} a month.`,
      code: 'not_in_plan', plan: plan.id, limit: 0, used: 0,
    }, { status: 402 });
  }
  if (cap != null && !(await isAdmin(user.email))) {
    const used = await countMonthlyLookups(user.id, ctx, 'coi');
    if (used >= cap) {
      return NextResponse.json({
        error: `Your ${ctx.team ? 'team' : 'account'} has used all ${cap} COI checks on the ${plan.label} plan this month.`,
        code: 'limit_reached', plan: plan.id, limit: cap, used,
      }, { status: 402 });
    }
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
  const mime = file.type || 'application/pdf';
  if (!['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'].includes(mime)) {
    return NextResponse.json({ error: `Unsupported file type: ${mime}` }, { status: 400 });
  }
  const mc = String(form.get('mc') || '').trim() || null;
  const dot = String(form.get('dot') || '').trim() || null;
  const bytes = Buffer.from(await file.arrayBuffer());

  let report;
  try {
    const ocrText = await ocrForScan(bytes, mime);
    report = await runCoiCheckFromText({ ocrText, bytes, mime, filename: file.name, mc, dot });
  } catch (e: any) {
    if (e instanceof PipelineError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  try {
    await (getServiceSupabase() || supabase).from('lookups').insert({
      user_id: user.id,
      query: report.mc ? `COI · MC-${report.mc}` : `COI · ${report.extraction.insured_name || file.name}`,
      name: report.name,
      mc: report.mc || null,
      dot: report.dot || null,
      score: report.score,
      verdict: report.verdict === 'mismatch' ? 'high' : report.verdict === 'verify' ? 'medium' : 'low',
      source: 'coi',
      data: report,
    });
  } catch { /* history is best-effort */ }

  return NextResponse.json(report);
}
