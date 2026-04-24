import { NextResponse } from 'next/server';
import { lookupCarrier, parseQuery } from '@/lib/fmcsa';
import { scoreCarrier } from '@/lib/risk';
import { getServerSupabase } from '@/lib/supabase/server';
import { monthStart } from '@/lib/plans';
import { checkAddress } from '@/lib/places';
import { isAdmin } from '@/lib/admin';
import { resolveTeamContext } from '@/lib/teams';
import { getServiceSupabase } from '@/lib/supabase/service';
import { findCarrierWebsite, nameMatchesDomain } from '@/lib/website-finder';
import { checkDomain } from '@/lib/domain';
import { findSocialLinks } from '@/lib/social-finder';
import { checkUserRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? '';
  const force = searchParams.get('force') === '1';
  const parsed = parseQuery(q);
  if (!parsed) return NextResponse.json({ error: 'Missing or empty query' }, { status: 400 });

  const supabase = getServerSupabase();
  let user: any = null;
  if (supabase) {
    const { data: userData } = await supabase.auth.getUser();
    user = userData?.user;
  }

  // Cache hit: return most recent saved lookup for this MC/DOT — no credit spent, no FMCSA call.
  if (!force && supabase && user && parsed.kind !== 'name') {
    const col = parsed.kind === 'mc' ? 'mc' : 'dot';
    const { data: cached } = await supabase
      .from('lookups')
      .select('*')
      .eq('user_id', user.id)
      .eq(col, parsed.value)
      .order('created_at', { ascending: false })
      .limit(1);
    if (cached && cached[0]) {
      return NextResponse.json({
        ...cached[0].data,
        cached: true,
        cachedAt: cached[0].created_at,
      });
    }
  }

  // Per-user burst rate limit (admins bypass).
  if (user && !(await isAdmin(user.email))) {
    const rl = await checkUserRateLimit(user.id);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Too many lookups — slow down. ${rl.count}/${rl.limit} in the last minute.`, code: 'rate_limited', retryAfter: rl.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      );
    }
  }

  // Enforce plan limit on FMCSA calls (admins bypass all limits).
  if (supabase && user && !(await isAdmin(user.email))) {
    const ctx = await resolveTeamContext(user.id, user.user_metadata?.plan);
    const plan = ctx.effectivePlan;
    const cap = plan.limits.fmcsaLookups;
    if (cap != null) {
      let countableIds: string[] = [user.id];
      if (ctx.team) {
        const svc = getServiceSupabase();
        if (svc) {
          const { data: members } = await svc.from('team_members').select('user_id').eq('team_id', ctx.team.id);
          countableIds = (members || []).map((m: any) => m.user_id);
        }
      }
      const since = monthStart().toISOString();
      const { count } = await supabase
        .from('lookups')
        .select('id', { count: 'exact', head: true })
        .in('user_id', countableIds)
        .eq('source', 'quick')
        .gte('created_at', since);
      if ((count ?? 0) >= cap) {
        return NextResponse.json({
          error: `Your ${ctx.team ? 'team' : 'account'} has used all ${cap} lookups on the ${plan.label} plan this month.`,
          code: 'limit_reached', plan: plan.id, limit: cap, used: count ?? 0,
        }, { status: 402 });
      }
    }
  }

  let carrier;
  try {
    carrier = await lookupCarrier(parsed);
  } catch (err: any) {
    return NextResponse.json(
      {
        error: 'FMCSA is temporarily unavailable. Please try again in a minute.',
        code: 'upstream_unavailable',
        detail: err?.message,
      },
      { status: 503, headers: { 'Retry-After': '30' } },
    );
  }

  // Run all enrichment sources in parallel — address verification (Google
  // Places) and web presence (search + WHOIS + DNS + social media) don't
  // depend on each other, so we don't pay the latency twice.
  const [addressResult, webResult] = await Promise.all([
    carrier.address
      ? checkAddress(carrier.address, carrier.name).catch(() => null)
      : Promise.resolve(null),
    findCarrierWebsite({ name: carrier.name, mc: carrier.mc, dot: carrier.dot }).catch(() => null),
  ]);

  if (addressResult && addressResult.configured) carrier.addressCheck = addressResult;

  if (webResult && webResult.configured) {
    let domainAgeDays: number | null | undefined;
    let hasMx: boolean | undefined;
    let hasSpf: boolean | undefined;
    let socials: { platform: string; url: string }[] | undefined;
    if (webResult.found && webResult.domain) {
      const [dc, sc] = await Promise.all([
        checkDomain(webResult.domain).catch(() => null),
        webResult.url ? findSocialLinks(webResult.url).catch(() => []) : Promise.resolve([]),
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
      found: webResult.found,
      domain: webResult.domain,
      url: webResult.url,
      title: webResult.title,
      snippet: webResult.snippet,
      nameMatch: webResult.found && webResult.domain ? nameMatchesDomain(carrier.name, webResult.domain) : undefined,
      domainAgeDays,
      hasMx,
      hasSpf,
      socials,
      error: webResult.error,
    };
  }

  // Surface which sources actually answered so the UI can show the user
  // exactly what was scanned. Each entry: name + ok flag + short note.
  carrier.sources = [
    {
      name: 'FMCSA registry',
      ok: Boolean(carrier.mc || carrier.dot),
      note: carrier.mc || carrier.dot ? `Authority, insurance, safety${carrier.crashTotal != null ? ', crashes' : ''}` : 'Not found',
    },
    {
      name: 'Google Places',
      ok: Boolean(carrier.addressCheck?.configured && carrier.addressCheck.found),
      note: carrier.addressCheck?.configured
        ? (carrier.addressCheck.found ? (carrier.addressCheck.isMailbox ? 'Mailbox service' : 'Verified business') : 'Not found in Places')
        : 'Not configured',
    },
    {
      name: 'Web presence',
      ok: Boolean(carrier.webPresence?.configured && carrier.webPresence.found),
      note: carrier.webPresence?.configured
        ? (carrier.webPresence.found ? `Website ${carrier.webPresence.nameMatch ? 'matches' : 'mismatch'}` : 'No website found')
        : 'Not configured',
    },
    {
      name: 'Domain & email',
      ok: Boolean(carrier.webPresence?.found && (carrier.webPresence.hasMx || carrier.webPresence.domainAgeDays != null)),
      note: carrier.webPresence?.found
        ? `${carrier.webPresence.domainAgeDays != null ? `${carrier.webPresence.domainAgeDays}d old` : 'no WHOIS'}${carrier.webPresence.hasMx ? ' · MX' : ''}${carrier.webPresence.hasSpf ? ' · SPF' : ''}`
        : 'No domain to check',
    },
    {
      name: 'Social media',
      ok: Boolean(carrier.webPresence?.socials && carrier.webPresence.socials.length > 0),
      note: carrier.webPresence?.socials?.length
        ? `${carrier.webPresence.socials.length} profile${carrier.webPresence.socials.length === 1 ? '' : 's'} found`
        : 'None found',
    },
  ];

  return NextResponse.json(scoreCarrier(carrier));
}
