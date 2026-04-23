import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { lookupCarrier, parseQuery } from '@/lib/fmcsa';
import { scoreCarrier } from '@/lib/risk';
import { checkAddress } from '@/lib/places';
import { findCarrierWebsite, nameMatchesDomain } from '@/lib/website-finder';
import { checkDomain } from '@/lib/domain';
import { findSocialLinks } from '@/lib/social-finder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Returns the user's own broker report (using user_metadata.mc or .dot).
// Re-runs FMCSA at most once per 24h. Always free of quota — never counts against
// the user's monthly lookup limit. Saves auto-refreshes with source='auto'.
export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const ownMc = (me.user_metadata?.mc || '').trim();
  const ownDot = (me.user_metadata?.dot || '').trim();
  if (!ownMc && !ownDot) return NextResponse.json({ ownMc: null, ownDot: null });

  const queryStr = ownMc ? `MC-${ownMc}` : `DOT-${ownDot}`;
  const matchCol = ownMc ? 'mc' : 'dot';
  const matchVal = ownMc || ownDot;

  // Look for any saved lookup for this MC/DOT in the last 24h
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: cached } = await supabase
    .from('lookups')
    .select('*')
    .eq('user_id', me.id)
    .eq(matchCol, matchVal)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1);
  if (cached && cached[0]) {
    return NextResponse.json({
      ownMc: ownMc || null,
      ownDot: ownDot || null,
      report: { ...cached[0].data, cached: true, cachedAt: cached[0].created_at },
    });
  }

  // Stale → run a fresh FMCSA lookup. Bypass the plan limit.
  const parsed = parseQuery(queryStr);
  if (!parsed) return NextResponse.json({ ownMc, ownDot, report: null, error: 'Invalid ID' });
  const carrier = await lookupCarrier(parsed);
  if (carrier.address) {
    const ac = await checkAddress(carrier.address, carrier.name);
    if (ac.configured) carrier.addressCheck = ac;
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
  } catch {}
  const scored = scoreCarrier(carrier);

  await supabase.from('lookups').insert({
    user_id: me.id,
    query: queryStr,
    name: scored.name,
    mc: scored.mc || ownMc || null,
    dot: scored.dot || ownDot || null,
    score: scored.score,
    verdict: scored.verdict,
    source: 'auto',
    data: scored,
  }).then(() => null).catch(() => null);

  return NextResponse.json({ ownMc: ownMc || null, ownDot: ownDot || null, report: scored });
}
