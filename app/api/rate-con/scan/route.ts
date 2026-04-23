import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { monthStart } from '@/lib/plans';
import { resolveTeamContext } from '@/lib/teams';
import { getServiceSupabase as getServiceSupabaseForLimits } from '@/lib/supabase/service';
import { ocrDocument, isDocAiConfigured } from '@/lib/google-docai';
import { analyzeRateCon, isAnthropicConfigured } from '@/lib/anthropic';
import { parseQuery, lookupCarrier, type CarrierReport } from '@/lib/fmcsa';
import { scoreCarrier } from '@/lib/risk';
import { checkAddress } from '@/lib/places';
import { checkDomain } from '@/lib/domain';
import { isAdmin } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
    let countableIds: string[] = [user.id];
    if (ctx.team) {
      const svc2 = getServiceSupabaseForLimits();
      if (svc2) {
        const { data: members } = await svc2.from('team_members').select('user_id').eq('team_id', ctx.team.id);
        countableIds = (members || []).map((m: any) => m.user_id);
      }
    }
    const since = monthStart().toISOString();
    const { count } = await supabase
      .from('lookups')
      .select('id', { count: 'exact', head: true })
      .in('user_id', countableIds)
      .eq('source', 'ratecon')
      .gte('created_at', since);
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

  // 1) OCR via Google Document AI
  let ocrText: string;
  try {
    const ocr = await ocrDocument(bytes, mime);
    ocrText = ocr.text;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'OCR failed' }, { status: 502 });
  }
  if (!ocrText || ocrText.trim().length < 50) {
    return NextResponse.json({ error: 'Could not extract text from the document. Try a clearer scan.' }, { status: 422 });
  }

  // 2) Claude extraction + stylistic scoring
  let extraction;
  try {
    extraction = await analyzeRateCon(ocrText);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Claude extraction failed' }, { status: 502 });
  }

  // 3) FMCSA lookup on extracted MC or DOT
  let carrier: CarrierReport | null = null;
  const lookupQuery = extraction.broker_mc || extraction.broker_dot || extraction.broker_name;
  if (lookupQuery) {
    const parsed = parseQuery(lookupQuery);
    if (parsed) {
      carrier = await lookupCarrier(parsed);
      if (carrier?.address) {
        const addressCheck = await checkAddress(carrier.address, carrier.name);
        if (addressCheck.configured) carrier.addressCheck = addressCheck;
      }
    }
  }
  if (!carrier) {
    carrier = {
      name: extraction.broker_name || 'Unknown broker',
      mc: extraction.broker_mc ?? undefined,
      dot: extraction.broker_dot ?? undefined,
      phone: extraction.broker_phone ?? undefined,
      source: 'mock' as const,
      fetchedAt: new Date().toISOString(),
      score: 0,
      verdict: 'low' as const,
      flags: [],
    };
  }

  // 4) Domain check on extracted email
  let domainCheck: any = undefined;
  if (extraction.broker_email) {
    try { domainCheck = await checkDomain(extraction.broker_email); } catch {}
  }

  // 5) Inject Claude stylistic flag into carrier flags
  if (extraction.fraud_score >= 61) {
    carrier.flags.push({
      sev: 'critical',
      title: `AI flagged rate con stylistically (score ${extraction.fraud_score}/100)`,
      desc: `Our model sees multiple fraud-pattern signals in this document's language and formatting.`,
      pts: 30,
      details: 'Claude analyzed the extracted text for urgency language, grammar oddities, mismatched formatting, and suspicious payment terms — patterns that are hard to encode as rules but reliable when combined.',
      metrics: [{ label: 'AI fraud score', value: `${extraction.fraud_score}/100` }],
      recommendation: 'Treat as highly suspicious. Verify the broker through an independent channel before any commitment.',
    });
  } else if (extraction.fraud_score >= 31) {
    carrier.flags.push({
      sev: 'warning',
      title: `AI noticed stylistic oddities (score ${extraction.fraud_score}/100)`,
      desc: 'Some fraud-pattern signals detected, not conclusive on their own.',
      pts: 10,
      details: 'Moderate signals — could be a rushed or poorly formatted legit rate con, or an early-stage scam. Worth a closer read.',
      metrics: [{ label: 'AI fraud score', value: `${extraction.fraud_score}/100` }],
    });
  }
  if (extraction.fraud_reasons?.length) {
    carrier.flags.push({
      sev: extraction.fraud_score >= 61 ? 'warning' : 'info',
      title: 'AI-detected fraud signals',
      desc: extraction.fraud_reasons.slice(0, 6).join(' · '),
      pts: 0,
      details: extraction.fraud_reasons.join('\n• '),
    });
  }

  const scored = scoreCarrier(carrier);

  // 6) Merge with domain info + rate-con extraction, save to history
  const merged: any = {
    ...scored,
    queriedEmail: extraction.broker_email || undefined,
    domain: domainCheck || undefined,
    rateCon: extraction,
    source_hint: 'ratecon',
  };

  const row = {
    user_id: user.id,
    query: (extraction.broker_mc || extraction.broker_dot || extraction.broker_name || 'rate-con upload').toString(),
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
