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

  const carrier = await lookupCarrier(parsed);
  if (carrier.address) {
    const addressCheck = await checkAddress(carrier.address, carrier.name);
    if (addressCheck.configured) carrier.addressCheck = addressCheck;
  }

  // Web presence: find a website via Custom Search, then run our existing domain checks on it.
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

  return NextResponse.json(scoreCarrier(carrier));
}
