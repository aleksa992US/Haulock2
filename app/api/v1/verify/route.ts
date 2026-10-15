import { NextResponse } from 'next/server';
import { lookupCarrier, parseQuery, resolveQuery, ambiguousNumberMessage, AmbiguousNameError, NotFoundByNameError } from '@/lib/fmcsa';
import { scoreCarrier } from '@/lib/risk';
import { getServiceSupabase } from '@/lib/supabase/service';
import { monthStart, enforcedPlanId } from '@/lib/plans';
import { checkAddress } from '@/lib/places';
import { isAdmin } from '@/lib/admin';
import { resolveTeamContext } from '@/lib/teams';
import { findCarrierWebsite, assessWebsiteOwnership } from '@/lib/website-finder';
import { checkDomain } from '@/lib/domain';
import { findSocialLinks } from '@/lib/social-finder';
import { extractBearer, resolveApiKey } from '@/lib/api-keys';
import { checkUserRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(req: Request) {
  const token = extractBearer(req);
  if (!token) {
    return NextResponse.json(
      { error: 'Missing Authorization: Bearer <api_key> header' },
      { status: 401, headers: corsHeaders() },
    );
  }

  const resolved = await resolveApiKey(token);
  if (!resolved) {
    return NextResponse.json(
      { error: 'Invalid or revoked API key' },
      { status: 401, headers: corsHeaders() },
    );
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? '';
  const force = searchParams.get('force') === '1';
  const raw = parseQuery(q);
  if (!raw) {
    return NextResponse.json(
      { error: 'Missing or empty query parameter `q`' },
      { status: 400, headers: corsHeaders() },
    );
  }
  // Bare digits can be an MC or a USDOT number for two different companies.
  const resolvedQuery = await resolveQuery(raw);
  if ('candidates' in resolvedQuery) {
    return NextResponse.json(
      { error: ambiguousNumberMessage(resolvedQuery.candidates), code: 'ambiguous_number', candidates: resolvedQuery.candidates },
      { status: 409, headers: corsHeaders() },
    );
  }
  const parsed = resolvedQuery.query;

  const svc = getServiceSupabase();
  if (!svc) {
    return NextResponse.json(
      { error: 'Server not configured' },
      { status: 500, headers: corsHeaders() },
    );
  }

  // Load the account so we can check plan + admin status.
  const { data: acct } = await svc.auth.admin.getUserById(resolved.userId);
  const user = acct?.user;
  if (!user) {
    return NextResponse.json(
      { error: 'Account for this API key no longer exists' },
      { status: 401, headers: corsHeaders() },
    );
  }

  // Cache hit: most recent saved lookup for this MC/DOT — no credit spent.
  // Same rules as the app: only rows from the last 7 days, never when a
  // sender email is given, and never a report built from fallback data.
  const emailParam = (new URL(req.url).searchParams.get('email') || '').trim();
  if (!force && !emailParam && parsed.kind !== 'name') {
    const col = parsed.kind === 'mc' ? 'mc' : 'dot';
    const { data: cached } = await svc
      .from('lookups')
      .select('*')
      .eq('user_id', user.id)
      .eq(col, parsed.value)
      // Plain lookups only: a COI, PDF or rate con row for the same MC is a
      // different payload, and a lookup run with a sender email carries
      // that email's look-alike findings.
      .eq('source', 'quick')
      .is('email_query', null)
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1);
    const cachedData: any = cached?.[0]?.data;
    if (cached && cached[0] && (!cachedData?.dataSource || cachedData.dataSource === 'fmcsa-live')) {
      return NextResponse.json(
        { ...cached[0].data, cached: true, cachedAt: cached[0].created_at },
        { headers: corsHeaders() },
      );
    }
  }

  // Per-user burst rate limit (admins bypass).
  if (!(await isAdmin(user.email))) {
    const rl = await checkUserRateLimit(user.id);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Too many lookups — slow down. ${rl.count}/${rl.limit} in the last minute.`, code: 'rate_limited', retryAfter: rl.retryAfter },
        { status: 429, headers: { ...corsHeaders(), 'Retry-After': String(rl.retryAfter) } },
      );
    }
  }

  // Enforce plan limit on FMCSA calls (admins bypass).
  if (!(await isAdmin(user.email))) {
    const ctx = await resolveTeamContext(user.id, enforcedPlanId(user));
    const plan = ctx.effectivePlan;
    const cap = plan.limits.fmcsaLookups;
    if (cap != null) {
      let countableIds: string[] = [user.id];
      if (ctx.team) {
        const { data: members } = await svc.from('team_members').select('user_id').eq('team_id', ctx.team.id);
        countableIds = (members || []).map((m: any) => m.user_id);
      }
      const since = monthStart().toISOString();
      const { count } = await svc
        .from('lookups')
        .select('id', { count: 'exact', head: true })
        .in('user_id', countableIds)
        .eq('source', 'quick')
        .gte('created_at', since);
      if ((count ?? 0) >= cap) {
        return NextResponse.json(
          {
            error: `Your ${ctx.team ? 'team' : 'account'} has used all ${cap} lookups on the ${plan.label} plan this month.`,
            code: 'limit_reached', plan: plan.id, limit: cap, used: count ?? 0,
          },
          { status: 402, headers: corsHeaders() },
        );
      }
    }
  }

  let carrier;
  try {
    carrier = await lookupCarrier(parsed);
  } catch (err: any) {
    // A name that matches several companies (or none closely enough) is a
    // 409 with candidates, same shape as the app — not an outage.
    if (err instanceof AmbiguousNameError || err?.code === 'ambiguous_name') {
      return NextResponse.json(
        { error: err.message, code: 'ambiguous_name', searched: err.searched, candidates: err.candidates ?? [], total: err.total ?? 0, needsConfirmation: Boolean(err.needsConfirmation) },
        { status: 409, headers: corsHeaders() },
      );
    }
    if (err instanceof NotFoundByNameError || err?.code === 'name_not_found') {
      return NextResponse.json({ error: err.message, code: 'name_not_found' }, { status: 404, headers: corsHeaders() });
    }
    return NextResponse.json(
      {
        error: 'FMCSA is temporarily unavailable. Please try again in a minute.',
        code: 'upstream_unavailable',
        detail: err?.message,
      },
      { status: 503, headers: { ...corsHeaders(), 'Retry-After': '30' } },
    );
  }
  if (carrier.address) {
    const addressCheck = await checkAddress(carrier.address, carrier.name);
    if (addressCheck.configured) carrier.addressCheck = addressCheck;
  }

  try {
    const web = await findCarrierWebsite({ name: carrier.name, mc: carrier.mc, dot: carrier.dot, address: carrier.address, phone: carrier.phone });
    // Only a site confirmed as theirs (name + address/phone) gets the
    // domain-age / email checks — same rule as the app.
    const ownership = web.found && web.domain ? assessWebsiteOwnership(web, { name: carrier.name, address: carrier.address, phone: carrier.phone }) : undefined;
    if (web.configured) {
      let domainAgeDays: number | null | undefined;
      let hasMx: boolean | undefined;
      let hasSpf: boolean | undefined;
      let socials: { platform: string; url: string }[] | undefined;
      if (ownership?.verified && web.domain) {
        const [dc, sc] = await Promise.all([
          checkDomain(web.domain).catch(() => null),
          web.url ? findSocialLinks(web.url).catch(() => []) : Promise.resolve([]),
        ]);
        if (dc) {
          domainAgeDays = dc.whois.ageDays ?? null;
          hasMx = dc.mx.error ? undefined : dc.mx.hasMx;
          hasSpf = dc.spf.hasSpf;
        }
        if (sc && sc.length) socials = sc;
      }
      carrier.webPresence = {
        configured: true,
        found: web.found,
        domain: web.domain,
        url: web.url,
        title: web.title,
        snippet: web.snippet,
        nameMatch: ownership?.nameMatch,
        verified: ownership?.verified,
        verifiedBy: ownership?.verifiedBy,
        addressMatch: ownership?.addressMatch,
        phoneMatch: ownership?.phoneMatch,
        domainAgeDays,
        hasMx,
        hasSpf,
        socials,
        error: web.error,
      };
    }
  } catch { /* swallow — web presence is non-critical */ }

  const scored = scoreCarrier(carrier);

  // Record usage so it counts against the monthly quota.
  try {
    await svc.from('lookups').insert({
      user_id: user.id,
      query: q,
      name: scored.name,
      mc: scored.mc || null,
      dot: scored.dot || null,
      score: scored.score,
      verdict: scored.verdict,
      source: 'quick',
      data: scored,
    });
  } catch { /* don't fail the response on logging errors */ }

  return NextResponse.json(scored, { headers: corsHeaders() });
}
