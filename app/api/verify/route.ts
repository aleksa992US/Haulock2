import { NextResponse } from 'next/server';
import { lookupCarrier, parseQuery, NotFoundByNameError } from '@/lib/fmcsa';
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
  const parsed = parseQuery(q);
  if (!parsed) return NextResponse.json({ error: 'Missing or empty query' }, { status: 400 });

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
      // a fresh scan. Currently V3 (SMS carrier-overview parsing + the
      // snapshot-before-SMS backfill order, both shipped today).
      const SCHEMA_VERSION = 3;
      const hasMatchingSchemaVersion = row.schemaVersion === SCHEMA_VERSION;
      const isCurrentSchema = hasSources && hasChameleonCheck && hasWebReputation && hasLinkedEntities && hasFmcsaArchive && hasFmcsaSms && hasMatchingSchemaVersion;
      console.log('[verify] user-cache hit', { q, hasSources, hasChameleonCheck, hasWebReputation, hasLinkedEntities, hasFmcsaArchive, hasFmcsaSms, hasMatchingSchemaVersion, savedAt: cached[0].created_at });
      if (isCurrentSchema) {
        return NextResponse.json({
          ...row,
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
      findCarrierWebsite({ name: carrier.name, mc: carrier.mc, dot: carrier.dot }).catch((e) => {
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
            return { configured: true, ok: false, hits: [], extractionHits: [], queriesRun: 0, error: e?.message };
          })
        : Promise.resolve({ configured: false, ok: false, hits: [], extractionHits: [], queriesRun: 0 }),
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
      const { findCarrierFromSnapshot } = await import('@/lib/carrier-snapshots');
      const snap = await findCarrierFromSnapshot({ dot: carrier.dot, mc: carrier.mc });
      const sd: any = snap?.data || {};
      if (carrier.powerUnits == null && sd.powerUnits != null) carrier.powerUnits = sd.powerUnits;
      if (carrier.drivers == null && sd.drivers != null) carrier.drivers = sd.drivers;
      if (!carrier.operation && sd.operation) carrier.operation = sd.operation;
      if (carrier.crashTotal == null && sd.crashTotal != null) carrier.crashTotal = sd.crashTotal;
      if (carrier.fatalCrash == null && sd.fatalCrash != null) carrier.fatalCrash = sd.fatalCrash;
      if (carrier.phone == null && sd.phone) carrier.phone = sd.phone;
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
          desc: `FMCSA Safety Measurement System has flagged this carrier for prioritized intervention in: ${top.join(', ')}${alertedBasics.length > 3 ? ` (+${alertedBasics.length - 3} more)` : ''}. BASIC alerts mean the carrier exceeds federal thresholds for these categories — strong safety-history signal.`,
          pts: 30,
          metrics: alertedBasics.slice(0, 5).map((b) => ({
            label: labelMap[b.key] || b.key,
            value: `measure ${b.measure} · ${b.inspections} inspections`,
          })),
          recommendation: 'Pull the carrier\'s SMS Overview directly at ai.fmcsa.dot.gov/SMS/Carrier/<DOT>/Overview.aspx and read the full inspection history before booking.',
        },
      ];
    }
  }

  // Extract aliases / sister-entities / co-cited MC numbers from the same
  // Brave hits we already pulled. Catches networks like
  // Super Ego ↔ Gray Falcon United ↔ JHI Transport ↔ Sky Blue Leasing
  // automatically — the article that mentions one usually mentions all.
  // We use the WIDER `extractionHits` set (not just trusted-source ones)
  // because alias-network coverage frequently lives on industry blogs and
  // forums that aren't in our trusted-source allow-list, but the alias
  // mentions in those articles are still real signal.
  const linkedEntities = extractLinkedEntities(
    (webReputation as any).extractionHits || webReputation.hits,
    carrier.name,
    carrier.mc,
    carrier.dot,
  );
  if (linkedEntities.length > 0) carrier.linkedEntities = linkedEntities;

  // Linked-entity flag — at least one alias / sister-entity / extra MC
  // mentioned alongside the carrier in trusted-source coverage is a
  // strong "this is part of a broader network" signal.
  if (linkedEntities.length > 0) {
    const top = linkedEntities.slice(0, 3);
    const sev: 'critical' | 'warning' = linkedEntities.length >= 3 ? 'critical' : 'warning';
    const pts = linkedEntities.length >= 3 ? 30 : 15;
    carrier.flags = [
      ...(carrier.flags || []),
      {
        sev,
        title: `Linked entities mentioned in coverage (${linkedEntities.length})`,
        desc: `Trusted-source articles about ${carrier.name} also reference: ${top.map((e) => e.kind === 'mc' ? `MC-${e.value}` : e.kind === 'dot' ? `DOT-${e.value}` : e.value).join(', ')}${linkedEntities.length > 3 ? `, +${linkedEntities.length - 3} more` : ''}. Often a sign of a broader fraud / chameleon-MC network — verify each link before booking.`,
        pts,
        details: top.map((e) => `• ${e.kind === 'mc' ? `MC-${e.value}` : e.kind === 'dot' ? `DOT-${e.value}` : e.value} — cited ${e.citations}× across ${e.sources.length} source${e.sources.length === 1 ? '' : 's'}`).join('\n'),
        recommendation: 'Treat these aliases as the same entity. Run a separate Haulock scan on each MC/DOT before booking.',
      },
    ];
  }

  // Web-reputation hits → flag. We only count hits from trusted domains
  // (FMCSA / Land Line / FreightWaves / TruckersReport / BBB / Reddit /
  // government), so even one hit is meaningful.
  if (webReputation.hits.length > 0) {
    const top = webReputation.hits.slice(0, 3);
    const sev = webReputation.hits.length >= 3 ? 'critical' : 'warning';
    const pts = webReputation.hits.length >= 3 ? 30 : 20;
    carrier.flags = [
      ...(carrier.flags || []),
      {
        sev,
        title: `Web reputation: ${webReputation.hits.length} fraud-related mention${webReputation.hits.length === 1 ? '' : 's'}`,
        desc: `Brave Search found ${webReputation.hits.length} hit${webReputation.hits.length === 1 ? '' : 's'} on "${carrier.name}" + fraud/scam/lawsuit keywords from trusted sources (industry press, forums, government). Examples: ${top.map((h) => h.domain).join(', ')}.`,
        pts,
        details: top.map((h) => `• ${h.domain} — ${h.title}`).join('\n'),
        metrics: [
          { label: 'Trusted-source hits', value: String(webReputation.hits.length) },
          { label: 'Queries run', value: String(webReputation.queriesRun) },
        ],
        recommendation: 'Read the linked articles before booking. A handful of mentions on TruckersReport, Land Line, or BBB usually points to a real pattern.',
      },
    ];
  }

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

  // Lookalike-domain detection — only meaningful when we have BOTH a sender
  // domain (from `?email=…`) AND the carrier's real FMCSA-listed website.
  // The sender claiming to be this carrier should resolve to the same
  // domain; near-matches (typosquats, homographs, TLD swaps) are the exact
  // pattern used in carrier-impersonation / spoofed-rate-con fraud.
  const senderDomain = normalizeDomain(queriedEmail);
  const carrierDomain = normalizeDomain(carrier.webPresence?.domain);
  if (senderDomain && carrierDomain) {
    const lookalike = detectLookalike(senderDomain, carrierDomain);
    if (lookalike) {
      const desc = describeLookalike(lookalike);
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
            { label: 'Real website', value: lookalike.legit },
            { label: 'Match type', value: lookalike.kind.replace('_', ' ') },
          ],
          recommendation: 'Do NOT reply to this email. Phone the carrier on a number from the FMCSA registry — not from the rate con — to verify the load.',
        },
      ];
      carrier.queriedEmail = queriedEmail;
      carrier.lookalikeMatch = lookalike;
    }
  }

  // Chameleon-carrier flag — convert each linked carrier into a RiskFlag so
  // it counts toward the score AND shows in the "Red flags detected" panel.
  for (const link of chameleonLinks) {
    if (!link.badStatus) continue;
    const idLine = [link.mc && `MC-${link.mc}`, link.dot && `DOT-${link.dot}`].filter(Boolean).join(' · ');
    carrier.flags = [
      ...(carrier.flags || []),
      {
        sev: 'warning',
        title: `Shared ${link.matchedOn} with another flagged FMCSA record`,
        desc: `In FMCSA records, this carrier shares a ${link.matchedOn} with ${link.name}${idLine ? ` (${idLine})` : ''}, which is currently ${link.reason}. Sharing identifiers can be legitimate — multi-MC operators, shared dispatch services, or shared office addresses — so this is a yellow flag, not a verdict.`,
        pts: 15,
        metrics: [
          { label: 'Other FMCSA record', value: link.name },
          { label: 'Matched on', value: link.matchedOn },
          { label: 'Status of the other record', value: link.reason },
          { label: 'Source', value: link.source === 'fmcsa-flag' ? 'FMCSA enforcement registry' : link.source === 'our-lookup' ? 'Prior Haulock high-risk scan' : 'Community fraud report' },
        ],
        recommendation: 'Investigate before booking — call the carrier on a number from a different source, ask for a current insurance certificate, and check whether the linked entity is actively used.',
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
          : senderDomain ? 'No carrier website to compare' : 'No sender email supplied',
    },
    {
      name: 'Chameleon check',
      ok: !carrier.chameleonLinks || carrier.chameleonLinks.length === 0,
      note: carrier.chameleonLinks && carrier.chameleonLinks.length > 0
        ? `${carrier.chameleonLinks.length} linked flagged carrier${carrier.chameleonLinks.length === 1 ? '' : 's'}`
        : 'No phone/address links to flagged carriers',
    },
    {
      name: 'Web reputation',
      // Green when nothing fraud-related found in trusted sources. Dim
      // grey + the loud red flag if hits exist.
      ok: Boolean(carrier.webReputation?.configured) && (carrier.webReputation?.hits.length ?? 0) === 0,
      note: !carrier.webReputation?.configured
        ? 'Brave Search not configured'
        : (carrier.webReputation?.hits.length ?? 0) > 0
          ? `${carrier.webReputation!.hits.length} mention${carrier.webReputation!.hits.length === 1 ? '' : 's'} on trusted sources`
          : 'No fraud mentions found',
    },
    {
      name: 'Linked entities',
      ok: !carrier.linkedEntities || carrier.linkedEntities.length === 0,
      note: carrier.linkedEntities && carrier.linkedEntities.length > 0
        ? `${carrier.linkedEntities.length} alias${carrier.linkedEntities.length === 1 ? '' : 'es'} / sister entit${carrier.linkedEntities.length === 1 ? 'y' : 'ies'} found`
        : 'No aliases or sister entities found',
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
  scored.schemaVersion = 3;
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
