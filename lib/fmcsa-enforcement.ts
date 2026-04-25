// FMCSA enforcement / red-flag feed.
// Pulls carriers from the FMCSA "Carrier - All With History" Socrata dataset
// (6eyk-hxee) that match one or more enforcement / illegal-operation signals.
//
// Strategy: query each signal SEPARATELY in parallel, then merge + dedupe.
// A single OR query gets dominated by the most common signal (mail
// undeliverable) and never surfaces rarer-but-more-serious ones (pending
// revocations, illegal operations). Querying each bucket independently lets
// us guarantee a useful mix.

const SOCRATA_BASE = 'https://data.transportation.gov/resource';

export type EnforcementSeverity = 'critical' | 'high' | 'medium';

export type EnforcementAction = {
  source: 'fmcsa-flag';
  severity: EnforcementSeverity;
  dot?: string;
  mc?: string;
  name: string;
  dba?: string;
  city?: string;
  state?: string;
  flags: string[];
  authorityType?: string;
};

const SELECT_FIELDS = [
  'dot_number', 'docket_number', 'legal_name', 'dba_name',
  'bus_city', 'bus_state_code',
  'common_stat', 'contract_stat', 'broker_stat',
  'common_rev_pend', 'contract_rev_pend', 'broker_rev_pend',
  'undeliverable_mail',
  'bipd_file', 'bond_file',
].join(',');

async function querySocrata(where: string, perBucketLimit: number): Promise<Array<Record<string, any>>> {
  const datasetId = process.env.FMCSA_SOCRATA_DATASET_ID;
  if (!datasetId) return [];
  const params = new URLSearchParams();
  params.set('$select', SELECT_FIELDS);
  params.set('$where', where);
  params.set('$order', 'dot_number DESC');
  params.set('$limit', String(perBucketLimit));

  const url = `${SOCRATA_BASE}/${datasetId}.json?${params.toString()}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      console.warn(`[fmcsa-enforcement] Socrata ${res.status} for "${where}"`);
      return [];
    }
    return (await res.json()) as Array<Record<string, any>>;
  } catch (err) {
    console.warn(`[fmcsa-enforcement] query failed for "${where}":`, err instanceof Error ? err.message : err);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchFlaggedCarriers(totalLimit = 300): Promise<EnforcementAction[]> {
  if (!process.env.FMCSA_SOCRATA_DATASET_ID) return [];

  // Per-bucket caps. We over-pull a bit then trim — guarantees representation
  // from rarer-but-serious buckets even when the total cap is hit. Mail
  // undeliverable as a sole signal is excluded — too noisy to be actionable.
  const PER_REV = 100;      // pending revocations (any kind) — most serious
  const PER_ILLEGAL = 150;  // active authority + missing insurance/bond — illegal operations

  const [revRows, illegalCarriers, illegalBrokers] = await Promise.all([
    querySocrata(
      `(common_rev_pend='Y' OR contract_rev_pend='Y' OR broker_rev_pend='Y')`,
      PER_REV,
    ),
    querySocrata(
      `(common_stat='A' OR contract_stat='A') AND (bipd_file='00000' OR bipd_file IS NULL)`,
      PER_ILLEGAL,
    ),
    querySocrata(
      `broker_stat='A' AND (bond_file='00000' OR bond_file IS NULL)`,
      PER_ILLEGAL,
    ),
  ]);

  // Dedupe by DOT (or MC if no DOT).
  const seen = new Map<string, EnforcementAction>();
  const ingest = (rows: Array<Record<string, any>>) => {
    for (const r of rows) {
      const action = toEnforcementAction(r);
      if (!action) continue;
      const key = action.dot ? `dot:${action.dot}` : action.mc ? `mc:${action.mc}` : `name:${action.name}`;
      // First-seen ordering means earlier (more serious) buckets win the
      // representation slot — but we still want to MERGE flags if a later
      // bucket adds new info.
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, action);
      } else {
        const merged = new Set([...existing.flags, ...action.flags]);
        existing.flags = Array.from(merged);
        existing.severity = recomputeSeverity(existing.flags);
      }
    }
  };

  // Order matters here — most serious bucket first so it gets the seen-slot.
  ingest(revRows);
  ingest(illegalCarriers);
  ingest(illegalBrokers);

  // Sort: critical > high > medium, then newest DOT inside each tier.
  const rank: Record<EnforcementSeverity, number> = { critical: 0, high: 1, medium: 2 };
  const all = Array.from(seen.values()).sort((a, b) => {
    const r = rank[a.severity] - rank[b.severity];
    if (r !== 0) return r;
    const ad = Number(a.dot || 0), bd = Number(b.dot || 0);
    return bd - ad;
  });

  return all.slice(0, totalLimit);
}

function toEnforcementAction(r: Record<string, any>): EnforcementAction | null {
  const flags: string[] = [];
  const isCommonActive = String(r.common_stat || '') === 'A';
  const isContractActive = String(r.contract_stat || '') === 'A';
  const isBrokerActive = String(r.broker_stat || '') === 'A';
  const bipd = parseAmount(r.bipd_file);
  const bond = parseAmount(r.bond_file);

  if (String(r.broker_rev_pend || '') === 'Y') flags.push('Broker authority revocation pending');
  if (String(r.common_rev_pend || '') === 'Y') flags.push('Common authority revocation pending');
  if (String(r.contract_rev_pend || '') === 'Y') flags.push('Contract authority revocation pending');
  if ((isCommonActive || isContractActive) && bipd === 0) flags.push('No liability insurance on file');
  if (isBrokerActive && bond === 0) flags.push('Broker operating without surety bond');
  // Note: mail-undeliverable is intentionally NOT surfaced as a flag — too
  // noisy to be actionable on its own.

  if (flags.length === 0) return null;

  const dot = stripDigits(r.dot_number);
  const mc = stripDigits(r.docket_number);
  const name = String(r.legal_name || r.dba_name || '').trim();
  if (!name) return null;

  return {
    source: 'fmcsa-flag',
    severity: recomputeSeverity(flags),
    dot, mc,
    name,
    dba: r.dba_name && r.dba_name !== r.legal_name ? String(r.dba_name).trim() : undefined,
    city: r.bus_city ? String(r.bus_city).trim() : undefined,
    state: r.bus_state_code ? String(r.bus_state_code).trim() : undefined,
    flags,
    authorityType: deriveAuthorityType(r),
  };
}

function recomputeSeverity(flags: string[]): EnforcementSeverity {
  const hasCritical = flags.some((f) => /revocation|liability insurance|surety bond/i.test(f));
  if (hasCritical) return 'critical';
  if (flags.length >= 2) return 'high';
  return 'medium';
}

function parseAmount(v: any): number {
  if (v == null) return 0;
  const s = String(v).replace(/[^0-9]/g, '');
  if (!s) return 0;
  return Number(s);
}

function stripDigits(v: any): string | undefined {
  if (v == null) return undefined;
  const s = String(v).replace(/[^0-9]/g, '').replace(/^0+/, '');
  return s || undefined;
}

function deriveAuthorityType(r: Record<string, any>): string | undefined {
  const parts: string[] = [];
  if (String(r.common_stat || '') === 'A') parts.push('common');
  if (String(r.contract_stat || '') === 'A') parts.push('contract');
  if (String(r.broker_stat || '') === 'A') parts.push('broker');
  return parts.length ? parts.join(' + ') : undefined;
}
