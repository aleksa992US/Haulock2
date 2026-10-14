import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { resolveTeamContext } from '@/lib/teams';
import { countMonthlyLookups } from '@/lib/usage';
import { isDocAiConfigured } from '@/lib/google-docai';
import { isAnthropicConfigured } from '@/lib/anthropic';
import { analyzeRateConText, ocrForScan, PipelineError } from '@/lib/rate-con-pipeline';
import { isAdmin } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: Request) {
  if (!isDocAiConfigured()) return NextResponse.json({ error: 'Google Document AI is not configured' }, { status: 500 });
  if (!isAnthropicConfigured()) return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 });

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  // Enforce plan limit (admins bypass; team plan + team-wide usage)
  const ctx = await resolveTeamContext(user.id, user.user_metadata?.plan);
  const plan = ctx.effectivePlan;
  const cap = plan.limits.rateConScans;
  if (cap != null && !(await isAdmin(user.email))) {
    // Service-role count: RLS hides teammates' rows from the user's
    // client, which gave every team member the full team quota.
    const count = await countMonthlyLookups(user.id, ctx, 'ratecon');
    if ((count ?? 0) >= cap) {
      return NextResponse.json({
        error: `Your ${ctx.team ? 'team' : 'account'} has used all ${cap} rate con scans on the ${plan.label} plan this month.`,
        code: 'limit_reached', plan: plan.id, limit: cap, used: count ?? 0,
      }, { status: 402 });
    }
  }

  // Read the uploaded PDF
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  const MAX_BYTES = 10 * 1024 * 1024;
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
  const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
  const mime = file.type || 'application/pdf';
  if (!allowed.includes(mime)) return NextResponse.json({ error: `Unsupported file type: ${mime}` }, { status: 400 });

  const arrayBuffer = await file.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);

  // 1) OCR, 2) Claude extraction, 3–5) FMCSA + domain checks and flags.
  let scan;
  try {
    const ocrText = await ocrForScan(bytes, mime);
    scan = await analyzeRateConText(ocrText);
  } catch (e: any) {
    if (e instanceof PipelineError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { report: merged, lookupQuery, extraction } = scan;

  // 6) Save to history
  const row = {
    user_id: user.id,
    // Whatever we actually used to look the broker up — MC/DOT from the PDF
    // when present, otherwise the first name candidate we tried (the full
    // extracted broker_name). Keeps history-row search useful.
    query: lookupQuery,
    name: merged.name,
    mc: merged.mc || null,
    dot: merged.dot || null,
    score: merged.score,
    verdict: merged.verdict,
    email_query: extraction.broker_email || null,
    source: 'ratecon' as const,
    data: merged,
  };
  try { await supabase.from('lookups').insert(row); } catch {}

  return NextResponse.json(merged);
}
