import { NextResponse } from 'next/server';
import { lookupCarrier, parseQuery } from '@/lib/fmcsa';
import { scoreCarrier } from '@/lib/risk';
import { getServiceSupabase } from '@/lib/supabase/service';
import { monthStart } from '@/lib/plans';
import { checkAddress } from '@/lib/places';
import { isAdmin } from '@/lib/admin';
import { resolveTeamContext } from '@/lib/teams';
import { findCarrierWebsite, nameMatchesDomain } from '@/lib/website-finder';
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
  const parsed = parseQuery(q);
  if (!parsed) {
    return NextResponse.json(
      { error: 'Missing or empty query parameter `q`' },
      { status: 400, headers: corsHeaders() },
    );
  }

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
  if (!force && parsed.kind !== 'name') {
    const col = parsed.kind === 'mc' ? 'mc' : 'dot';
    const { data: cached } = await svc
      .from('lookups')
      .select('*')
      .eq('user_id', user.id)
      .eq(col, parsed.value)
      .order('created_at', { ascending: false })
      .limit(1);
    if (cached && cached[0]) {
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
    const ctx = await resolveTeamContext(user.id, user.user_metadata?.plan);
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

  const carrier = await lookupCarrier(parsed);
  if (carrier.address) {
    const addressCheck = await checkAddress(carrier.address, carrier.name);
    if (addressCheck.configured) carrier.addressCheck = addressCheck;
  }

  try {
    const web = await findCarrierWebsite({ name: carrier.name, mc: carrier.mc, dot: carrier.dot });
    if (web.configured) {
      let domainAgeDays: number | null | undefined;
      let hasMx: boolean | undefined;
      let hasSpf: boolean | undefined;
      let socials: { platform: string; url: string }[] | undefined;
      if (web.found && web.domain) {
        const [dc, sc] = await Promise.all([
          checkDomain(web.domain).catch(() => null),
          web.url ? findSocialLinks(web.url).catch(() => []) : Promise.resolve([]),
        ]);
        if (dc) {
          domainAgeDays = dc.whois.ageDays ?? null;
          hasMx = dc.mx.hasMx;
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
        nameMatch: web.found && web.domain ? nameMatchesDomain(carrier.name, web.domain) : undefined,
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
