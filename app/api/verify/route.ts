import { NextResponse } from 'next/server';
import { lookupCarrier, parseQuery, resolveQuery, ambiguousNumberMessage, NotFoundByNameError, AmbiguousNameError } from '@/lib/fmcsa';
import { scoreCarrier } from '@/lib/risk';
import { getServerSupabase } from '@/lib/supabase/server';
import { monthStart } from '@/lib/plans';
import { checkAddress } from '@/lib/places';
import { isAdmin } from '@/lib/admin';
import { resolveTeamContext } from '@/lib/teams';
import { getServiceSupabase } from '@/lib/supabase/service';
import { findCarrierWebsite, assessWebsiteOwnership } from '@/lib/website-finder';
import { checkDomain } from '@/lib/domain';
import { findSocialLinks } from '@/lib/social-finder';
import { checkUserRateLimit } from '@/lib/rate-limit';
import { detectLookalike, describeLookalike, normalizeDomain } from '@/lib/lookalike-detection';
import { findChameleonLinks } from '@/lib/chameleon-detection';
import { checkWebReputation, isWebReputationConfigured } from '@/lib/web-reputation';
import { extractLinkedEntities } from '@/lib/linked-entity-extractor';
import { findLegacyCrossReferences } from '@/lib/legacy-cross-reference';
import { fetchSmsData } from '@/lib/fmcsa-sms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? '';
  const force = searchParams.get('force') === '1';
  // Optional sender domain or email — used for lookalike-domain detection
  // against the carrier's actual FMCSA-listed website.
  const queriedEmail = searchParams.get('email') ?? '';
  const raw = parseQuery(q);
  if (!raw) return NextResponse.json({ error: 'Missing or empty query' }, { status: 400 });
  // Bare digits can be an MC or a USDOT number for two different companies.
  const resolved = await resolveQuery(raw);
  if ('candidates' in resolved) {
    return NextResponse.json(
      { error: ambiguousNumberMessage(resolved.candidates), code: 'ambiguous_number', candidates: resolved.candidates },
      { status: 409 },
    );
  }
  const parsed = resolved.query;
  // Set when the user searched a name and then picked this MC/DOT from the
  // `ambiguous_name` candidate list: the name they originally typed.
  const searchedName = parsed.kind !== 'name' ? (searchParams.get('searched') ?? '').trim().slice(0, 120) : '';
  const matchedBy: 'mc' | 'dot' | 'name-choice' | undefined = parsed.kind === 'name'
    ? undefined // set by lookupCarrier on a strong single match
    : searchedName ? 'name-choice' : parsed.kind;
  const searchedFor = searchedName || q.trim();

  const supabase = getServerSupabase();
  let user: any = null;
  if (supabase) {
    const { data: userData } = await supabase.auth.getUser();
    user = userData?.user;
  }

  // Per-user lookup cache: return the most recent saved row for this MC/DOT
  // unless it predates the current response schema. Older rows lack the
  // `sources` summary, parallel enrichment fields, and the multi-source
  // scan strip — bypass them so the user gets a fresh full scan.
  // Skipped when a sender email is given (the saved row never ran the
  // lookalike check for it) and for rows older than 7 days (FMCSA data,
  // insurance and web results move — an old result shouldn't pass as today's).
  if (!force && !queriedEmail.trim() && supabase && user && parsed.kind !== 'name') {
    const col = parsed.kind === 'mc' ? 'mc' : 'dot';
    const { data: cached } = await supabase
      .from('lookups')
      .select('*')
      .eq('user_id', user.id)
      .eq(col, parsed.value)
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1);
    if (cached && cached[0]) {
      const row = cached[0].data || {};
      // Schema markers: bump these when the response shape grows new
      // top-level fields. Older rows lacking them get bypassed and
      // refreshed so the user sees the latest features (sources strip,
      // chameleon links, lookalike check).
      const hasSources = Array.isArray(row.sources);
      const hasChameleonCheck = row.sources?.some((s: any) => s?.name === 'Chameleon check');
      const hasWebReputation = row.sources?.some((s: any) => s?.name === 'Web reputation');
      const hasLinkedEntities = row.sources?.some((s: any) => s?.name === 'Linked entities');
      const hasFmcsaArchive = row.sources?.some((s: any) => s?.name === 'FMCSA archive');
      const hasFmcsaSms = row.sources?.some((s: any) => s?.name === 'FMCSA SMS');
      // Schema fingerprint — bump whenever the verify route changes how
      // it constructs the carrier payload so older rows fall through to
      // a fresh scan. V10: linked-entity extractor rejects 2-word matches
      // without a hard corporate suffix (LLC/INC/CORP) and risk flag now
      // requires 2+ citations AND 2+ sources for company-shaped aliases
      // before contributing to the risk score. V11: linked entities only
      // from trusted-source hits (no directory listings), and no hazmat
      // percentile read from FMCSA's intervention-threshold label. V12:
      // reports record their data source/date (dataSource, dataAsOf) and how
      // the company was found (matchedBy, searchedFor); snapshot backfill no
      // longer fills 24-month crash/inspection fields; web reputation only
      // scores pages that mention fraud; websites must be confirmed as the
      // company's; chameleon links use FMCSA facts only.
      const SCHEMA_VERSION = 12;
      const hasMatchingSchemaVersion = row.schemaVersion === SCHEMA_VERSION;
      // A report built from fallback data (FMCSA didn't answer) is never
      // replayed: the next search should try the live service again.
      const isLiveData = row.dataSource == null || row.dataSource === 'fmcsa-live';
      const isCurrentSchema = hasSources && hasChameleonCheck && hasWebReputation && hasLinkedEntities && hasFmcsaArchive && hasFmcsaSms && hasMatchingSchemaVersion && isLiveData;
      console.log('[verify] user-cache hit', { q, hasSources, hasChameleonCheck, hasWebReputation, hasLinkedEntities, hasFmcsaArchive, hasFmcsaSms, hasMatchingSchemaVersion, isLiveData, savedAt: cached[0].created_at });
      if (isCurrentSchema) {
        return NextResponse.json({
          ...row,
          // How it was found this time, not when the row was saved.
          matchedBy,
          searchedFor,
          cached: true,
          cachedAt: cached[0].created_at,
        });
      }
      console.log('[verify] user-cache stale schema — running fresh scan');
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

  console.log('[verify] start', { q, kind: parsed.kind, value: parsed.value });
  let carrier;
  try {
    const t0 = Date.now();
    carrier = await lookupCarrier(parsed);
    console.log('[verify] FMCSA lookup ok', {
      ms: Date.now() - t0,
      mc: carrier.mc,
      dot: carrier.dot,
      hasCrashTotal: carrier.crashTotal != null,
      hasFatalCrash: carrier.fatalCrash != null,
      hasVehicleOos: carrier.vehicleOosRate != null,
      hasSafetyRating: carrier.safetyRating && carrier.safetyRating !== 'Not rated',
      hasMcs150Date: carrier.mcs150Date != null,
      hasOperation: carrier.operation != null,
    });
  } catch (err: any) {
    console.error('[verify] FMCSA lookup FAILED', err?.message);
    // The name matches several companies, or none closely enough to accept
    // without asking. Same 409 shape as `ambiguous_number`: each candidate's
    // `query` (MC-… / DOT-…) picks it. Clients re-run with that query plus
    // `searched=<name>` so the report records the name the user picked from.
    if (err instanceof AmbiguousNameError || err?.code === 'ambiguous_name') {
      return NextResponse.json(
        {
          error: err.message,
          code: 'ambiguous_name',
          searched: err.searched ?? q,
          candidates: err.candidates ?? [],
          total: err.total ?? err.candidates?.length ?? 0,
          exactMatchFound: err.exactMatchFound ?? true,
          needsConfirmation: Boolean(err.needsConfirmation),
        },
        { status: 409 },
      );
    }
    // "Name not found anywhere" is a 404, not a 503. The user typed a name
    // that no public source registers — they need different guidance than
    // "try again in a minute".
    if (err instanceof NotFoundByNameError || err?.code === 'name_not_found') {
      return NextResponse.json(
        {
          error: `We couldn't find a carrier or broker named "${err.searched ?? q}" in any data source.`,
          code: 'name_not_found',
          searched: err.searched ?? q,
          suggestions: [
            'Double-check the spelling — small typos break the search.',
            'Try searching by MC number (MC-1040945) or USDOT number (DOT-3288433) directly — those are unique and unambiguous.',
            'Some carriers operate under a TRADE name that differs from their FMCSA legal name. If you only know the trade name, look up their MC on a rate confirmation or via SAFER (safer.fmcsa.dot.gov).',
            'If you got this name from a rate con, the broker may not actually have FMCSA authority — that itself is a major fraud signal.',
          ],
        },
        { status: 404 },
      );
    }
    // We exhausted FMCSA primary, Socrata, the Brave name resolver, AND
    // every cache layer. Genuinely nothing to show — return a 503 with a
    // factual message + the same actionable suggestions we use for 404, so
    // the user always has a next step.
    return NextResponse.json(
      {
        error: `Couldn't reach FMCSA or any fallback source on this scan${parsed.kind === 'name' ? ` for "${parsed.value}"` : ''}.`,
        code: 'upstream_unavailable',
        detail: err?.message,
        suggestions: [
          parsed.kind === 'name'
            ? 'Try searching by MC number (e.g. MC-1040945) or USDOT number (e.g. DOT-3288433) — we keep a separate cache by id and can usually serve that even when FMCSA is down.'
            : 'Wait ~30 seconds and click Scan again — most FMCSA outages are short.',
          'If this carrier was scanned before, the prior report is in your History tab — open that to see what we had.',
          'Check status.dot.gov to see if FMCSA is in a maintenance window.',
        ],
      },
      { status: 503, headers: { 'Retry-After': '30' } },
    );
  }

  // How the company was found, for the report's "You searched … → matched …"
  // line. Name searches arrive with matchedBy='name' from lookupCarrier,
  // which only returns a company for a single strong name match.
  if (matchedBy) carrier.matchedBy = matchedBy;
  if (!carrier.searchedFor) carrier.searchedFor = searchedFor;
  // Web reputation also searches the typed name, but only when the user
  // picked this company for that name or it matched the name strongly, and
  // only when it differs from the registered names already searched.
  const typedName = carrier.searchedFor || '';
  const reputationAliases = (carrier.matchedBy === 'name' || carrier.matchedBy === 'name-choice')
    && typedName
    && ![carrier.name, carrier.dba].some((n) => (n || '').trim().toLowerCase() === typedName.toLowerCase())
    ? [typedName]
    : [];

  // Run all enrichment sources in parallel — address verification (Google
  // Places), web presence, and chameleon-carrier link detection don't
  // depend on each other, so we don't pay the latency multiple times.
  const tEnrich = Date.now();
  // Per-source timing: each promise resolves with how long it took so we
  // can log "FMCSA SMS · 4200ms" and the operator can see which sources
  // are slow.
  const timings: Record<string, number> = {};
  const timed = <T,>(name: string, p: Promise<T>): Promise<T> => {
    const t = Date.now();
    return p.then(
      (r) => { timings[name] = Date.now() - t; return r; },
      (e) => { timings[name] = Date.now() - t; throw e; },
    );
  };
  const [addressResult, webResult, chameleonLinks, webReputation, legacyReference, smsData] = await Promise.all([
    timed('places',
      carrier.address
        ? checkAddress(carrier.address, carrier.name).catch((e) => {
            console.error('[verify] places check FAILED', e?.message);
            return null;
          })
        : Promise.resolve(null),
    ),
    timed('web',
      findCarrierWebsite({ name: carrier.name, mc: carrier.mc, dot: carrier.dot, address: carrier.address, phone: carrier.phone }).catch((e) => {
        console.error('[verify] website find FAILED', e?.message);
        return null;
      }),
    ),
    timed('chameleon',
      findChameleonLinks(carrier).catch((e) => {
        console.error('[verify] chameleon detection FAILED', e?.message);
        return [];
      }),
    ),
    timed('reputation',
      isWebReputationConfigured()
        ? checkWebReputation(carrier.name, {
            // Pass the user's ORIGINAL query string as an alias seed — when
            // the user searches "Super Ego Logistics" but FMCSA registers
            // them as "GRAY FALCON UNITED LLC", we want to find articles
            // that mention either name. Pass MC/DOT too so identifier-based
            // citations surface even when no name matches.
            aliases: parsed.kind === 'name' && parsed.value.toLowerCase() !== (carrier.name || '').toLowerCase()
              ? [parsed.value]
              : [],
            mc: carrier.mc,
            dot: carrier.dot,
          }).catch((e) => {
            console.error('[verify] web reputation FAILED', e?.message);
            return { configured: true, ok: false, hits: [], reviewHits: [], extractionHits: [], queriesRun: 0, error: e?.message };
          })
        : Promise.resolve({ configured: false, ok: false, hits: [], reviewHits: [], extractionHits: [], queriesRun: 0 }),
    ),
    timed('legacy',
      findLegacyCrossReferences(carrier).catch((e) => {
        console.error('[verify] legacy cross-reference FAILED', e?.message);
        return { rating: null, emailMatches: [] };
      }),
    ),
    // FMCSA Safety Measurement System — BASIC scores, inspection
    // breakdown, crash detail. Only call when we have a DOT (SMS is
    // keyed by DOT, not MC). Cached weekly.
    timed('sms',
      carrier.dot
        ? fetchSmsData(carrier.dot).catch((e) => {
            console.error('[verify] SMS fetch FAILED', e?.message);
            return null;
          })
        : Promise.resolve(null),
    ),
  ]);
  // Friendly per-source breakdown — operator opens the dev terminal,
  // searches a carrier, watches the data come in source-by-source.
  // Format: status icon · source name · timing · what came back.
  const totalEnrichMs = Date.now() - tEnrich;
  const fmt = (ms: number | undefined) => `${(ms ?? 0).toString().padStart(5)}ms`;
  const lines: string[] = [];
  lines.push(`\n[verify] ─── ENRICHMENT for ${carrier.name || '?'} (${[carrier.mc && `MC-${carrier.mc}`, carrier.dot && `DOT-${carrier.dot}`].filter(Boolean).join(' / ') || 'no id'}) ─── total ${totalEnrichMs}ms`);

  // FMCSA registry was already pulled before enrichment (lookupCarrier),
  // but we summarize what we got here so the source list reads top-to-bottom.
  lines.push(`[verify]  ✓ FMCSA registry      ·  cached  · authority: ${carrier.authorityStatus || '—'} · BIPD: ${carrier.bipdOnFile != null ? `$${carrier.bipdOnFile}k` : '—'} · crashes: ${carrier.crashTotal ?? '—'} · OOS: ${carrier.outOfService ? 'Yes' : 'No'}`);

  // SMS
  if (smsData?.fetched) {
    const basicCount = Object.keys(smsData.basics || {}).length;
    const alerts = Object.values(smsData.basics || {}).filter((b: any) => b?.alert).length;
    const veh = smsData.inspections?.vehicleInspections ?? 0;
    const drv = smsData.inspections?.driverInspections ?? 0;
    const crashes = smsData.crashes?.total ?? 0;
    const icon = alerts > 0 ? '⚠' : '✓';
    lines.push(`[verify]  ${icon} FMCSA SMS            · ${fmt(timings.sms)} · ${basicCount} BASICs · ${alerts} alert${alerts === 1 ? '' : 's'} · ${veh + drv} inspections · ${crashes} crashes`);
  } else if (smsData) {
    lines.push(`[verify]  - FMCSA SMS            · ${fmt(timings.sms)} · ${smsData.error || 'no data'}`);
  } else {
    lines.push(`[verify]  - FMCSA SMS            ·       skipped · no DOT to query`);
  }

  // Google Places
  if (addressResult?.configured) {
    const ok = addressResult.found && !addressResult.isMailbox;
    const icon = ok ? '✓' : addressResult.isMailbox ? '⚠' : '-';
    const detail = addressResult.found
      ? `${addressResult.matchedName || 'business'} ${addressResult.isMailbox ? '(mailbox!)' : ''}`
      : 'not found in Places';
    lines.push(`[verify]  ${icon} Google Places        · ${fmt(timings.places)} · ${detail}`);
  } else {
    lines.push(`[verify]  - Google Places        ·       skipped · API not configured`);
  }

  // Web presence
  if (webResult?.configured) {
    const found = webResult.found;
    const icon = found ? '✓' : '-';
    const detail = found ? `${webResult.domain || webResult.url}` : 'no website found';
    lines.push(`[verify]  ${icon} Web presence         · ${fmt(timings.web)} · ${detail}`);
  } else {
    lines.push(`[verify]  - Web presence         ·       skipped · no search API configured`);
  }

  // Domain & email infra (folded into web presence's call)
  if (carrier.webPresence?.found) {
    const age = carrier.webPresence.domainAgeDays;
    const ageStr = age != null ? (age < 365 ? `${age}d` : `${(age / 365).toFixed(1)}y`) : '—';
    lines.push(`[verify]  ✓ Domain & email      ·    (folded) · age ${ageStr} · MX ${carrier.webPresence.hasMx ? '✓' : '—'} · SPF ${carrier.webPresence.hasSpf ? '✓' : '—'}`);
  }

  // Social media
  const socials = carrier.webPresence?.socials || [];
  if (socials.length > 0) {
    lines.push(`[verify]  ✓ Social media        ·    (folded) · ${socials.length} profile${socials.length === 1 ? '' : 's'}: ${socials.map((s: any) => s.platform).join(', ')}`);
  } else {
    lines.push(`[verify]  - Social media        ·    (folded) · none found`);
  }

  // Lookalike domain check (runs after web result, only if email supplied)
  if (carrier.lookalikeMatch) {
    lines.push(`[verify]  ⚠ Lookalike domain    ·     <inline> · ${carrier.lookalikeMatch.kind} of ${carrier.lookalikeMatch.legit}`);
  } else if (queriedEmail) {
    lines.push(`[verify]  ✓ Lookalike domain    ·     <inline> · no impersonation`);
  } else {
    lines.push(`[verify]  - Lookalike domain    ·     <inline> · no sender email supplied`);
  }

  // Cross-reference / chameleon
  if (chameleonLinks.length > 0) {
    const sample = chameleonLinks.slice(0, 2).map((l) => `${l.matchedOn}→${l.name}`).join(', ');
    lines.push(`[verify]  ⚠ Cross-reference     · ${fmt(timings.chameleon)} · ${chameleonLinks.length} match${chameleonLinks.length === 1 ? '' : 'es'}: ${sample}`);
  } else {
    lines.push(`[verify]  ✓ Cross-reference     · ${fmt(timings.chameleon)} · no flagged-record matches`);
  }

  // Web reputation
  if (webReputation.configured) {
    const hits = webReputation.hits.length;
    const allHits = (webReputation as any).extractionHits?.length ?? 0;
    const icon = hits > 0 ? '⚠' : '✓';
    const sources = hits > 0 ? webReputation.hits.slice(0, 3).map((h) => h.domain).join(', ') : '';
    lines.push(`[verify]  ${icon} Web reputation       · ${fmt(timings.reputation)} · ${webReputation.queriesRun} queries · ${hits} trusted hits${allHits > hits ? ` (${allHits - hits} other)` : ''}${sources ? ` · ${sources}` : ''}`);
  } else {
    lines.push(`[verify]  - Web reputation       · ${fmt(timings.reputation)} · Brave Search not configured`);
  }

  // Linked entities (extracted from web reputation hits)
  const entities = carrier.linkedEntities || [];
  if (entities.length > 0) {
    const top = entities.slice(0, 3).map((e: any) => e.kind === 'company' ? e.value : `${e.kind.toUpperCase()}-${e.value}`);
    lines.push(`[verify]  ⚠ Linked entities     ·    (folded) · ${entities.length} alias${entities.length === 1 ? '' : 'es'}: ${top.join(', ')}${entities.length > 3 ? ` +${entities.length - 3}` : ''}`);
  } else {
    lines.push(`[verify]  - Linked entities     ·    (folded) · no aliases extracted`);
  }

  // FMCSA archive (legacy partner-2021 data)
  if (legacyReference.rating || legacyReference.emailMatches.length > 0) {
    const parts: string[] = [];
    if (legacyReference.rating?.riskOverall) parts.push(`rated ${legacyReference.rating.riskOverall}`);
    if (legacyReference.emailMatches.length > 0) parts.push(`${legacyReference.emailMatches.length} email-shared MC${legacyReference.emailMatches.length === 1 ? '' : 's'}`);
    lines.push(`[verify]  ✓ FMCSA archive       · ${fmt(timings.legacy)} · ${parts.join(' · ')}`);
  } else {
    lines.push(`[verify]  - FMCSA archive       · ${fmt(timings.legacy)} · no archive snapshot for this carrier`);
  }

  console.log(lines.join('\n'));

  if (chameleonLinks.length > 0) carrier.chameleonLinks = chameleonLinks;
  if (webReputation.configured) carrier.webReputation = webReputation;
  if (legacyReference.rating || legacyReference.emailMatches.length > 0) {
    carrier.legacyReference = legacyReference;
  }
  if (smsData) carrier.sms = smsData;

  // Backfill order — most-recent-and-most-canonical first:
  //   1. FMCSA primary (current call)            ← already in carrier
  //   2. Most recent carrier_snapshots row       ← previous successful primary
  //   3. FMCSA SMS                               ← updated monthly, can lag
  // We prefer snapshot before SMS because the snapshot represents the
  // most recent FMCSA primary call we ever got — far fresher than SMS's
  // monthly cadence. Concrete example: a carrier that grew from 6 trucks
  // to 65 in the last 3 weeks will show 65 in our snapshot but still 6
  // in SMS until SMS recomputes.
  if (carrier.dot || carrier.mc) {
    try {
      // Walk the last 10 snapshots and pick the most recent non-null value
      // for every field. This is far more resilient than reading just the
      // single most-recent snapshot — fields like `phone` and `fax` are
      // routinely dropped by FMCSA between updates, so the latest snapshot
      // we just inserted will have them empty even though earlier ones had
      // valid values. The merge preserves "stickiness" so the carrier's
      // last known phone keeps showing on the report.
      //
      // Never for 24-month-window fields (crashes, OOS rates, inspections):
      // an old snapshot's count can cover a different 24 months. Those come
      // from the SMS backfill below, which is current. Fleet size only from
      // a snapshot under 90 days old. Every backfilled field is recorded in
      // `carrier.backfilled` so the report can say it's from an earlier record.
      const { findCarrierFieldsWithDates } = await import('@/lib/carrier-snapshots');
      const sd = await findCarrierFieldsWithDates({ dot: carrier.dot, mc: carrier.mc }, 10);
      const recentCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const backfilled: { field: string; asOf: string }[] = [...(carrier.backfilled || [])];
      const fill = (field: 'powerUnits' | 'drivers' | 'operation' | 'phone' | 'emailDomain', recentOnly: boolean) => {
        const hit = sd[field];
        if (!hit || (carrier as any)[field] != null && (carrier as any)[field] !== '') return;
        if (recentOnly && hit.capturedAt < recentCutoff) return;
        (carrier as any)[field] = hit.value;
        backfilled.push({ field, asOf: hit.capturedAt });
      };
      fill('powerUnits', true);
      fill('drivers', true);
      fill('operation', false);
      fill('phone', false);
      // The email domain FMCSA had on file (often only in the archive
      // record) — used to judge the website's domain fairly below.
      fill('emailDomain', false);
      if (backfilled.length) carrier.backfilled = backfilled;
    } catch (err) {
      console.warn('[verify] snapshot backfill failed:', err instanceof Error ? err.message : err);
    }
  }

  // SMS backfill — runs AFTER the snapshot pass, so it only fills fields
  // still missing. SMS data is monthly-updated; the snapshot above is
  // closer to real-time, so we use SMS only when neither primary nor
  // snapshot had the field.
  if (smsData?.fetched) {
    if (carrier.crashTotal == null && smsData.crashes) {
      carrier.crashTotal = smsData.crashes.total;
    }
    if (carrier.fatalCrash == null && smsData.crashes) {
      carrier.fatalCrash = smsData.crashes.fatal;
    }
    if (carrier.injCrash == null && smsData.crashes) {
      carrier.injCrash = smsData.crashes.injury;
    }
    // OOS rates: prefer the parsed percentage, fall back to computing it
    // from raw counts so the Operations panel never shows '—' when SMS
    // gave us inspection counts.
    const insp = smsData.inspections;
    if (insp) {
      const computedVeh = insp.vehicleOosPct != null
        ? insp.vehicleOosPct
        : (insp.vehicleInspections > 0 ? Math.round((insp.vehicleOosCount / insp.vehicleInspections) * 1000) / 10 : null);
      const computedDrv = insp.driverOosPct != null
        ? insp.driverOosPct
        : (insp.driverInspections > 0 ? Math.round((insp.driverOosCount / insp.driverInspections) * 1000) / 10 : null);
      if (carrier.vehicleOosRate == null && computedVeh != null) carrier.vehicleOosRate = computedVeh;
      if (carrier.driverOosRate == null && computedDrv != null) carrier.driverOosRate = computedDrv;
      if (carrier.vehicleOosRateNat == null && insp.vehicleNationalAvgPct != null) carrier.vehicleOosRateNat = insp.vehicleNationalAvgPct;
      if (carrier.driverOosRateNat == null && insp.driverNationalAvgPct != null) carrier.driverOosRateNat = insp.driverNationalAvgPct;
    }
    // Operations panel: SMS Overview reports total trucks + drivers and
    // the operation classification. Use these when QCMobile's response
    // didn't include them.
    const ov = smsData.carrier;
    if (ov) {
      if (carrier.powerUnits == null && ov.totalTrucks != null) carrier.powerUnits = ov.totalTrucks;
      if (carrier.drivers == null && ov.totalDrivers != null) carrier.drivers = ov.totalDrivers;
      if (!carrier.operation && ov.carrierOperation) carrier.operation = ov.carrierOperation;
    }
  }

  // SMS BASIC alerts → flag. FMCSA flags a category as "Alert" when the
  // carrier's measure exceeds the threshold for prioritized intervention.
  // We surface that as a critical risk flag.
  if (smsData?.fetched) {
    const alertedBasics = Object.entries(smsData.basics || {})
      .filter(([, b]: any) => b?.alert)
      .map(([k, b]: any) => ({ key: k, ...b }));
    if (alertedBasics.length > 0) {
      const labelMap: Record<string, string> = {
        unsafeDriving: 'Unsafe Driving',
        hoursOfService: 'Hours-of-Service Compliance',
        driverFitness: 'Driver Fitness',
        controlledSubstances: 'Controlled Substances / Alcohol',
        vehicleMaintenance: 'Vehicle Maintenance',
        hazmat: 'Hazardous Materials Compliance',
        crashIndicator: 'Crash Indicator',
      };
      const top = alertedBasics.slice(0, 3).map((b) => labelMap[b.key] || b.key);
      carrier.flags = [
        ...(carrier.flags || []),
        {
          sev: 'critical',
          title: `${alertedBasics.length} FMCSA BASIC alert${alertedBasics.length === 1 ? '' : 's'} active`,
          desc: `FMCSA's Safety Measurement System shows an alert for this carrier in: ${top.join(', ')}${alertedBasics.length > 3 ? ` (+${alertedBasics.length - 3} more)` : ''}. An alert means the carrier is above FMCSA's intervention threshold in that category, or an investigation found acute or critical violations.`,
          pts: 30,
          metrics: alertedBasics.slice(0, 5).map((b) => ({
            label: labelMap[b.key] || b.key,
            value: `measure ${b.measure} · ${b.inspections} inspections`,
          })),
          recommendation: 'Pull the carrier\'s SMS Overview directly at ai.fmcsa.dot.gov/SMS/Carrier/<DOT>/Overview.aspx and read the full inspection history before you tender a load.',
        },
      ];
    }
  }

  // Extract aliases / sister-entities / co-cited MC numbers from the
  // trusted-source hits (industry press, regulators, forums) we already
  // pulled. Catches networks like Super Ego ↔ Gray Falcon United ↔ JHI
  // Transport ↔ Sky Blue Leasing — the article that mentions one usually
  // mentions all. The wider `extractionHits` set is NOT used: it is mostly
  // carrier directories that list unrelated companies side by side, which
  // tied legitimate carriers to strangers.
  const linkedEntities = extractLinkedEntities(
    webReputation.hits,
    carrier.name,
    carrier.mc,
    carrier.dot,
  );
  if (linkedEntities.length > 0) carrier.linkedEntities = linkedEntities;

  // Linked-entity flag — only for entities cited 2+ times across 2+
  // trusted sources. One page naming another number is not evidence of a
  // relationship. The panel still lists weaker entities for transparency.
  const scoreableEntities = linkedEntities.filter((e) => e.citations >= 2 && e.sources.length >= 2);
  if (scoreableEntities.length > 0) {
    const top = scoreableEntities.slice(0, 3);
    carrier.flags = [
      ...(carrier.flags || []),
      {
        sev: 'warning',
        title: `Other companies named in coverage (${scoreableEntities.length})`,
        desc: `News and industry coverage that mentions ${carrier.name} also names: ${top.map((e) => e.kind === 'mc' ? `MC-${e.value}` : e.kind === 'dot' ? `DOT-${e.value}` : e.value).join(', ')}${scoreableEntities.length > 3 ? `, +${scoreableEntities.length - 3} more` : ''}. Being named in the same coverage does not by itself mean the companies are related.`,
        pts: 15,
        details: top.map((e) => `• ${e.kind === 'mc' ? `MC-${e.value}` : e.kind === 'dot' ? `DOT-${e.value}` : e.value} — named ${e.citations}× across ${e.sources.length} sources (${e.sources.slice(0, 3).join(', ')})`).join('\n'),
        recommendation: 'Read the cited coverage, and run a separate Haulock scan on any MC/DOT that matters to this load.',
      },
    ];
  }

  // Web-reputation hits → flag. Only pages from trusted domains that name
  // the company AND use a fraud term count (see lib/web-reputation.ts).
  // Pages that just name it — court cases, BBB profiles, articles — are
  // listed for review with 0 points.
  const reviewHits = (webReputation as any).reviewHits || [];
  if (webReputation.hits.length > 0) {
    const n = webReputation.hits.length;
    const top = webReputation.hits.slice(0, 3);
    const sev = n >= 3 ? 'critical' : 'warning';
    const pts = n >= 3 ? 30 : n === 2 ? 20 : 15;
    carrier.flags = [
      ...(carrier.flags || []),
      {
        sev,
        title: `Web reputation: ${n} page${n === 1 ? '' : 's'} mention${n === 1 ? 's' : ''} fraud or scams`,
        desc: `${n} page${n === 1 ? '' : 's'} on trusted sites name ${carrier.name} together with words like fraud, scam or non-payment (${top.map((h) => h.domain).join(', ')}). Open them to see what they say.`,
        pts,
        details: top.map((h) => `• ${h.domain} — ${h.title}`).join('\n'),
        links: [...webReputation.hits, ...reviewHits],
        metrics: [
          { label: 'Pages mentioning fraud', value: String(n) },
          { label: 'Other pages to review', value: String(reviewHits.length) },
        ],
        recommendation: 'Read each page before booking. One forum post can be a dispute; several independent reports usually point to a real pattern.',
      },
    ];
  } else if (reviewHits.length > 0) {
    carrier.flags = [
      ...(carrier.flags || []),
      {
        sev: 'info',
        title: `Web: ${reviewHits.length} page${reviewHits.length === 1 ? '' : 's'} to review (not scored)`,
        desc: `Court cases, business profiles or articles that name ${carrier.name}. None of them mention fraud or scams, so they don't affect the score.`,
        pts: 0,
        links: reviewHits,
        recommendation: 'Skim them if this load matters. For carriers, court cases are usually accident or injury claims.',
      },
    ];
  }

  if (addressResult && addressResult.configured) carrier.addressCheck = addressResult;

  // A found website is only treated as the company's when there's real
  // evidence: the domain or listing name matches the company AND the site's
  // Google listing is at the FMCSA address or has the FMCSA phone. FMCSA
  // itself lists no websites. Re-assessed here (not just in the finder)
  // because the phone may have been backfilled from snapshots above.
  let siteConfirmed = false;
  if (webResult && webResult.configured) {
    const ownership = webResult.found && webResult.domain
      ? assessWebsiteOwnership(webResult, { name: carrier.name, address: carrier.address, phone: carrier.phone })
      : undefined;
    siteConfirmed = ownership?.verified === true;
    let domainAgeDays: number | null | undefined;
    let hasMx: boolean | undefined;
    let hasSpf: boolean | undefined;
    let socials: { platform: string; url: string }[] | undefined;
    // Domain age, email setup and social links describe the site's owner —
    // only meaningful once we know the site is theirs.
    // FMCSA's email domain, when it's a different domain from the website:
    // a company emailing from an established domain shouldn't be marked down
    // because its (newer) website domain has no mail server.
    const fmcsaEmailDomain = String(carrier.emailDomain || '').toLowerCase().replace(/^www\./, '');
    const siteDomain = String(webResult.domain || '').toLowerCase().replace(/^www\./, '');
    let emailDomainCheck: { domain: string; ageDays: number | null; hasMx?: boolean; provider?: string | null } | undefined;
    if (siteConfirmed && webResult.domain) {
      const [dc, sc, ec] = await Promise.all([
        checkDomain(webResult.domain).catch(() => null),
        webResult.url ? findSocialLinks(webResult.url).catch(() => []) : Promise.resolve([]),
        fmcsaEmailDomain && fmcsaEmailDomain !== siteDomain ? checkDomain(fmcsaEmailDomain).catch(() => null) : Promise.resolve(null),
      ]);
      if (ec) {
        emailDomainCheck = {
          domain: fmcsaEmailDomain,
          ageDays: ec.whois.ageDays ?? null,
          hasMx: ec.mx.error ? undefined : ec.mx.hasMx,
          provider: ec.mx.provider ?? null,
        };
      }
      if (dc) {
        domainAgeDays = dc.whois.ageDays ?? null;
        // Unknown (undefined) when the DNS lookup itself failed.
        hasMx = dc.mx.error ? undefined : dc.mx.hasMx;
        hasSpf = dc.spf.hasSpf;
      }
      if (sc && sc.length) socials = sc;
    }
    // Built as a variable so the ownership fields (not yet on the shared
    // CarrierReport type) pass through.
    const webPresence = {
      configured: true,
      found: webResult.found,
      domain: webResult.domain,
      url: webResult.url,
      title: webResult.title,
      snippet: webResult.snippet,
      nameMatch: ownership ? ownership.nameMatch : undefined,
      verified: ownership ? ownership.verified : undefined,
      verifiedBy: ownership ? ownership.verifiedBy : undefined,
      addressMatch: ownership ? ownership.addressMatch : undefined,
      phoneMatch: ownership ? ownership.phoneMatch : undefined,
      source: webResult.source,
      emailDomainCheck,
      domainAgeDays,
      hasMx,
      hasSpf,
      socials,
      error: webResult.error,
    };
    carrier.webPresence = webPresence;
  }

  // Lookalike-domain detection — only meaningful when we have BOTH a sender
  // domain (from `?email=…`) AND a website we confirmed belongs to this
  // company (see above). Comparing against an unconfirmed site could call
  // the real company's email a lookalike of an impersonator's site, so an
  // unconfirmed site is never used here.
  const senderDomain = normalizeDomain(queriedEmail);
  const carrierDomain = siteConfirmed ? normalizeDomain(carrier.webPresence?.domain) : undefined;
  if (senderDomain && carrierDomain) {
    const lookalike = detectLookalike(senderDomain, carrierDomain);
    if (lookalike) {
      const rawDesc = describeLookalike(lookalike);
      // lib/lookalike-detection's wording says "FMCSA-listed website"; FMCSA
      // lists no websites. Say what we actually know.
      const desc = {
        title: rawDesc.title.replace(/the carrier's real website/g, 'the website we confirmed for this company'),
        desc: rawDesc.desc.replace(/the FMCSA-listed website/g, 'the website we confirmed for this company'),
      };
      const pts =
        lookalike.kind === 'tld_swap' ? 35 :
        lookalike.kind === 'homograph' ? 35 :
        lookalike.kind === 'subdomain_swap' ? 30 :
        25; // levenshtein
      carrier.flags = [
        ...(carrier.flags || []),
        {
          sev: 'critical',
          title: desc.title,
          desc: desc.desc,
          pts,
          metrics: [
            { label: 'Sender domain', value: lookalike.suspect },
            { label: 'Confirmed website', value: lookalike.legit },
            { label: 'Match type', value: lookalike.kind.replace('_', ' ') },
          ],
          recommendation: 'Do NOT reply to this email. Phone the carrier on a number from the FMCSA registry — not from the rate con — to verify the load.',
        },
      ];
      carrier.queriedEmail = queriedEmail;
      carrier.lookalikeMatch = lookalike;
    }
  }

  // Chameleon-carrier flag. Links come only from FMCSA's own data about the
  // other record (revocation pending, no insurance/bond, no active
  // authority) — never from Haulock's past verdicts. One flag for all of
  // them (15 pts, +5 per extra record, max 25) so sister companies don't
  // stack up. Phones shared by many records (dispatch / answering services)
  // arrive with badStatus=false and are listed in the report, not scored.
  const badLinks = chameleonLinks.filter((l) => l.badStatus);
  if (badLinks.length > 0) {
    const idOf = (l: typeof badLinks[number]) => [l.mc && `MC-${l.mc}`, l.dot && `DOT-${l.dot}`].filter(Boolean).join(' · ');
    const top = badLinks.slice(0, 3);
    const noun = badLinks.length === 1 ? 'another FMCSA record' : `${badLinks.length} other FMCSA records`;
    const sharesAddress = badLinks.some((l) => l.matchedOn === 'phone+address');
    carrier.flags = [
      ...(carrier.flags || []),
      {
        sev: 'warning',
        title: `Shares a phone number with ${noun} with problems on file`,
        desc: `In FMCSA records, this company's phone number${sharesAddress ? ' (and street address)' : ''} also appears on ${top.map((l) => `${l.name}${idOf(l) ? ` (${idOf(l)})` : ''} — ${l.reason}`).join('; ')}${badLinks.length > 3 ? `; +${badLinks.length - 3} more` : ''}. Sharing a phone can be legitimate (sister companies, an old authority the owner replaced), so this is a yellow flag, not a verdict.`,
        pts: Math.min(25, 15 + 5 * (badLinks.length - 1)),
        metrics: top.flatMap((l) => [
          { label: 'Other FMCSA record', value: `${l.name}${idOf(l) ? ` · ${idOf(l)}` : ''}` },
          { label: 'What FMCSA shows for it', value: l.reason },
        ]).concat([{ label: 'Source', value: 'FMCSA carrier registry' }]),
        recommendation: 'Before booking, call the company on a number you look up yourself, ask for a current insurance certificate, and ask how they are connected to the other record.',
      },
    ];
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
      ok: Boolean(carrier.addressCheck?.configured && carrier.addressCheck.found && !carrier.addressCheck.error),
      note: !carrier.addressCheck?.configured
        ? 'Not configured'
        : carrier.addressCheck.error
          ? 'Couldn’t check — Places didn’t respond'
          : !carrier.addressCheck.found
            ? 'No listing at this exact address'
            : carrier.addressCheck.isMailbox
              ? 'Mailbox service'
              : carrier.addressCheck.isResidence
                ? 'Likely residential address'
                : (carrier.addressCheck as { nameMatches?: boolean }).nameMatches
                  ? 'Business listed under their name'
                  : 'A different business is listed there',
    },
    {
      name: 'Web presence',
      ok: Boolean(carrier.webPresence?.configured && carrier.webPresence.found && siteConfirmed),
      note: carrier.webPresence?.configured
        ? (carrier.webPresence.found
            ? (siteConfirmed ? 'Website confirmed via Google listing' : 'Possible website — not confirmed as theirs')
            : 'No website found')
        : 'Not configured',
    },
    {
      name: 'Domain & email',
      ok: Boolean(siteConfirmed && (carrier.webPresence?.hasMx || carrier.webPresence?.domainAgeDays != null)),
      note: !carrier.webPresence?.found
        ? 'No domain to check'
        : !siteConfirmed
          ? 'Not checked — website not confirmed'
          : [
              carrier.webPresence.domainAgeDays != null
                ? (carrier.webPresence.domainAgeDays < 365 ? `website domain ${carrier.webPresence.domainAgeDays}d old` : `website domain ${Math.floor(carrier.webPresence.domainAgeDays / 365)}+ yrs old`)
                : 'domain age unavailable',
              carrier.webPresence.hasMx === true ? 'mail server' : carrier.webPresence.hasMx === false ? 'no mail server' : null,
              carrier.webPresence.emailDomainCheck ? `email on ${carrier.webPresence.emailDomainCheck.domain}` : null,
            ].filter(Boolean).join(' · '),
    },
    {
      name: 'Social media',
      ok: Boolean(carrier.webPresence?.socials && carrier.webPresence.socials.length > 0),
      note: carrier.webPresence?.socials?.length
        ? `${carrier.webPresence.socials.length} profile${carrier.webPresence.socials.length === 1 ? '' : 's'} found`
        : carrier.webPresence?.found && !siteConfirmed
          ? 'Not checked — website not confirmed'
          : 'None found',
    },
    {
      name: 'Lookalike domain',
      // "ok" here means "no impersonation detected" — green dot = clean.
      // When we DID detect a lookalike, leave ok=false so the chip is dim
      // and the red flag in the report panel does the loud work.
      ok: !carrier.lookalikeMatch && Boolean(senderDomain && carrierDomain),
      note: carrier.lookalikeMatch
        ? `Match: ${carrier.lookalikeMatch.kind.replace('_', ' ')} of ${carrier.lookalikeMatch.legit}`
        : senderDomain && carrierDomain
          ? 'No impersonation detected'
          : senderDomain ? 'No confirmed company website to compare' : 'No sender email supplied',
    },
    {
      name: 'Chameleon check',
      ok: badLinks.length === 0,
      note: badLinks.length > 0
        ? `Phone shared with ${badLinks.length} FMCSA record${badLinks.length === 1 ? '' : 's'} with problems`
        : chameleonLinks.length > 0
          ? 'Phone shared with many records (likely a service) — not scored'
          : 'No shared phone with problem FMCSA records',
    },
    {
      name: 'Web reputation',
      // Green when nothing fraud-related found in trusted sources. Dim
      // grey + the loud red flag if hits exist.
      ok: Boolean(carrier.webReputation?.configured) && Boolean(carrier.webReputation?.ok) && (carrier.webReputation?.hits.length ?? 0) === 0,
      note: !carrier.webReputation?.configured
        ? 'Brave Search not configured'
        : !carrier.webReputation?.ok
          // Every search failed — that's "couldn't check", not "clean".
          ? 'Search didn’t respond — try Scan again'
          : (carrier.webReputation?.hits.length ?? 0) > 0
            ? `${carrier.webReputation!.hits.length} page${carrier.webReputation!.hits.length === 1 ? '' : 's'} mention fraud`
            : (carrier.webReputation?.reviewHits?.length ?? 0) > 0
              ? `No fraud mentions · ${carrier.webReputation!.reviewHits!.length} page${carrier.webReputation!.reviewHits!.length === 1 ? '' : 's'} to review`
              : 'No fraud mentions found',
    },
    {
      name: 'Linked entities',
      ok: !carrier.linkedEntities || carrier.linkedEntities.length === 0,
      note: carrier.linkedEntities && carrier.linkedEntities.length > 0
        ? `${carrier.linkedEntities.length} other compan${carrier.linkedEntities.length === 1 ? 'y' : 'ies'} named in coverage`
        : 'No other companies named in coverage',
    },
    {
      name: 'FMCSA SMS',
      ok: Boolean(carrier.sms?.fetched),
      note: !carrier.sms
        ? 'Skipped (no DOT)'
        : carrier.sms.fetched
          ? (() => {
              const alerts = Object.values(carrier.sms!.basics).filter((b: any) => b?.alert).length;
              const inspCount = (carrier.sms!.inspections?.vehicleInspections || 0) + (carrier.sms!.inspections?.driverInspections || 0);
              if (alerts > 0) return `${alerts} BASIC alert${alerts === 1 ? '' : 's'} · ${inspCount} inspections`;
              return `Clean · ${inspCount} inspections`;
            })()
          : /abort|timed? ?out/i.test(carrier.sms.error || '')
            ? 'FMCSA SMS didn’t respond in time — try Scan again'
            : (carrier.sms.error || 'SMS unavailable'),
    },
    {
      name: 'FMCSA archive',
      // "ok=true" here means we found a historical archive snapshot for
      // this carrier (good — more data). "ok=false" with note "no archive"
      // is just informational. Email-shared rows surface as a soft note,
      // never as a red flag.
      ok: Boolean(carrier.legacyReference?.rating || (carrier.legacyReference?.emailMatches.length ?? 0) > 0),
      note: !carrier.legacyReference
        ? 'No matching archive snapshot found'
        : carrier.legacyReference.emailMatches.length > 0
          ? `Archive: ${carrier.legacyReference.emailMatches.length} other carrier${carrier.legacyReference.emailMatches.length === 1 ? '' : 's'} sharing the email`
          : carrier.legacyReference.rating
            ? `Archive snapshot ~5 years ago available`
            : 'No matching archive snapshot found',
    },
  ];

  const scored = scoreCarrier(carrier) as any;
  // Stamp the schema version so the user-cache check can identify rows
  // generated by this version of the verify route. Bump whenever the
  // payload shape changes meaningfully.
  // Must equal SCHEMA_VERSION in the user-cache check above.
  scored.schemaVersion = 12;
  const verdictLabel = scored.verdict === 'high' ? 'HIGH RISK' : scored.verdict === 'medium' ? 'CAUTION' : 'LOW RISK';
  console.log(`[verify] ─── RESULT · score ${scored.score}/100 · ${verdictLabel} · ${scored.flags?.length ?? 0} red flag${(scored.flags?.length ?? 0) === 1 ? '' : 's'} ───`);
  if (scored.flags && scored.flags.length > 0) {
    for (const f of scored.flags.slice(0, 8)) {
      const sevIcon = f.sev === 'critical' ? '🔴' : f.sev === 'warning' ? '🟡' : '⚪';
      console.log(`[verify]    ${sevIcon} +${f.pts} · ${f.title}`);
    }
    if (scored.flags.length > 8) {
      console.log(`[verify]    … +${scored.flags.length - 8} more`);
    }
  }
  console.log(''); // visual gap after each scan
  return NextResponse.json(scored);
}
