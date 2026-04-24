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

  // 3 + 4) FMCSA lookup (with address check) and domain check run in parallel —
  // no data dependency between them.
  //
  // Claude returns broker_mc / broker_dot as bare digits (e.g. "1649053") without
  // a type prefix. Our parseQuery heuristic assumes anything 7+ digits is a DOT,
  // which misidentifies real MC numbers and returns a totally unrelated carrier.
  // Force the prefix based on which field Claude populated.
  const cleanDigits = (raw: string | null | undefined) =>
    raw ? String(raw).replace(/[^0-9]/g, '') : '';
  const mcDigits = cleanDigits(extraction.broker_mc);
  const dotDigits = cleanDigits(extraction.broker_dot);
  // Many legitimate rate cons don't include MC/DOT in the body (it's often only
  // in the letterhead logo, which OCR sometimes misses). Fall back to broker
  // name — Socrata handles name queries well inside lookupCarrier's fallback.
  // We'll cross-check the address below for extra confidence.
  const lookupQuery = mcDigits
    ? `MC-${mcDigits}`
    : dotDigits
    ? `DOT-${dotDigits}`
    : extraction.broker_name || null;
  const parsed = lookupQuery ? parseQuery(lookupQuery) : null;
  const matchedByName = !mcDigits && !dotDigits && !!extraction.broker_name;

  const carrierPromise: Promise<CarrierReport | null> = parsed
    ? (async () => {
        try {
          // Rate-con context: we KNOW we're looking up a broker, so prefer
          // records with active broker authority to disambiguate when multiple
          // carriers share a name. Pass broker address as a geographic hint.
          const c = await lookupCarrier(parsed, {
            preferActiveBroker: true,
            addressHint: extraction.broker_address || undefined,
          });
          if (c?.address) {
            const addressCheck = await checkAddress(c.address, c.name);
            if (addressCheck.configured) c.addressCheck = addressCheck;
          }
          return c;
        } catch {
          return null;
        }
      })()
    : Promise.resolve(null);

  const domainPromise: Promise<any> = extraction.broker_email
    ? checkDomain(extraction.broker_email).catch(() => undefined)
    : Promise.resolve(undefined);

  let [carrierResult, domainCheck] = await Promise.all([carrierPromise, domainPromise]);

  // Safety net: if Claude put the CARRIER's MC into broker_mc (a common failure
  // mode — carrier MC is often the only one explicit on the rate con), the
  // FMCSA result will be a company whose name DOESN'T match Claude's broker_name.
  // When that happens, redo the lookup by the broker's actual name.
  const nameMatches = (a: string | undefined, b: string | undefined) => {
    if (!a || !b) return false;
    const norm = (s: string) => s.toUpperCase()
      .replace(/[.,]/g, '')
      .replace(/\b(LLC|L\s*L\s*C|INC|INCORPORATED|CORP|CORPORATION|LTD|LIMITED|LP|LLP|CO)\b/g, '')
      .replace(/\s+/g, ' ').trim();
    const wa = new Set(norm(a).split(' ').filter((w) => w.length > 2));
    const wb = new Set(norm(b).split(' ').filter((w) => w.length > 2));
    const shared = Array.from(wa).filter((w) => wb.has(w)).length;
    return shared >= Math.min(2, Math.min(wa.size, wb.size));
  };

  if (
    carrierResult && carrierResult.source !== 'mock' &&
    extraction.broker_name &&
    (mcDigits || dotDigits) &&
    !nameMatches(carrierResult.name, extraction.broker_name)
  ) {
    // FMCSA returned a carrier whose name doesn't match Claude's broker_name.
    // Claude almost certainly gave us the CARRIER's MC/DOT, not the broker's.
    // Retry by broker name — Socrata-first name lookup is smarter about this.
    console.warn(`[rate-con/scan] MC/DOT mismatch — Claude said broker="${extraction.broker_name}" but FMCSA returned "${carrierResult.name}". Retrying by name.`);
    const nameParsed = parseQuery(extraction.broker_name);
    if (nameParsed) {
      try {
        const byName = await lookupCarrier(nameParsed, {
          preferActiveBroker: true,
          addressHint: extraction.broker_address || undefined,
        });
        if (byName && nameMatches(byName.name, extraction.broker_name)) {
          carrierResult = byName;
          if (byName.address) {
            const addressCheck = await checkAddress(byName.address, byName.name);
            if (addressCheck.configured) byName.addressCheck = addressCheck;
          }
        }
      } catch { /* fall through to original result */ }
    }
  }

  let carrier: CarrierReport = carrierResult || {
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

  // When FMCSA fails (mockCarrier fallback kicked in), the hardcoded mock returns
  // an unrelated demo name like "Summit Logistics Inc" that doesn't match the broker
  // the user is trying to verify. Overlay Claude's extraction on top of the mock so
  // the report at least reflects the actual rate con content. The "FMCSA lookup
  // failed" flag is still present, so the UI banner correctly warns the user.
  if (carrier.source === 'mock') {
    if (extraction.broker_name) carrier.name = extraction.broker_name;
    if (extraction.broker_mc) carrier.mc = String(extraction.broker_mc).replace(/[^0-9]/g, '') || carrier.mc;
    if (extraction.broker_dot) carrier.dot = String(extraction.broker_dot).replace(/[^0-9]/g, '') || carrier.dot;
    if (extraction.broker_phone) carrier.phone = extraction.broker_phone;
  }

  // 5a) Informational note when broker was matched by name only — lets the user
  // know the MC/DOT in the report came from our registry lookup, not the PDF,
  // and that they should sanity-check before booking.
  if (matchedByName && carrier.source !== 'mock') {
    const mcMatched = !!carrier.mc;
    const dotMatched = !!carrier.dot;
    // Address cross-check: rate-con addresses are often mailing (PO Box) while
    // FMCSA stores physical, so exact-street compare rarely works. Match on the
    // city + 3-digit-zip signal instead — brokers almost never relocate between
    // physical and mailing addresses by more than one ZIP code.
    const normCity = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
    const extractAddr = (extraction.broker_address || '').toLowerCase();
    const regAddr = (carrier.address || '').toLowerCase();
    const extractZip3 = (extractAddr.match(/\b(\d{3})\d{2}\b/) || [])[1];
    const regZip3 = (regAddr.match(/\b(\d{3})\d{2}\b/) || [])[1];
    const extractWords = new Set<string>(extractAddr.split(/[^a-z]+/).filter((w) => w.length > 3).map(normCity));
    const regWords = new Set<string>(regAddr.split(/[^a-z]+/).filter((w) => w.length > 3).map(normCity));
    const sharedCityTokens = Array.from(extractWords).filter((w) => regWords.has(w)).length;
    const addrMatches = Boolean(
      (extractZip3 && regZip3 && extractZip3 === regZip3) ||     // same 3-digit ZIP prefix
      sharedCityTokens >= 1                                       // or share at least one 4+ char word (city name)
    );
    carrier.flags.push({
      sev: addrMatches ? 'info' : 'warning',
      title: addrMatches ? 'Broker matched by name + address (high confidence)' : 'Broker matched by name only — verify MC independently',
      desc: addrMatches
        ? `The rate con didn't list an MC, but the broker's name and address match FMCSA registration for ${carrier.name}${mcMatched ? ` (MC-${carrier.mc})` : ''}. Treat as verified, but if unsure, call the broker to confirm.`
        : `The rate con didn't list an MC — we matched "${extraction.broker_name}" by name. Multiple carriers can have similar names, so verify by calling the broker before booking. Matched record: ${carrier.name}${mcMatched ? ` · MC-${carrier.mc}` : ''}${dotMatched ? ` · DOT-${carrier.dot}` : ''}.`,
      pts: addrMatches ? 0 : 5,
      details: `Rate con broker address: ${extraction.broker_address || 'not found'}\nFMCSA-registered address: ${carrier.address || 'not found'}`,
      recommendation: addrMatches
        ? undefined
        : 'Phone the broker at the number on the rate con and ask for their MC docket number. Verify it matches the one here.',
    });
  }

  // 5b) Inject Claude stylistic flag into carrier flags
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
    query: lookupQuery || 'rate-con upload',
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
