// Carrier identity history.
//
// Append-only. Every successful FMCSA lookup runs through `recordSnapshot`,
// which compares the carrier's current "meaningful fields" against the most
// recent snapshot for the same DOT/MC. If anything changed (address, phone,
// authority, insurance, fleet size, etc.) we insert a new row. If nothing
// changed we skip — no duplicate snapshots, no wasted storage.
//
// The result, accumulated over time, is a free real-time history of every
// carrier our users have ever looked up. The same data BrokerSnapshot
// charges for, generated as a side-effect of regular usage.

import { createHash } from 'crypto';
import type { CarrierReport } from './fmcsa';

// Fields that, when changed, are worth recording as a new snapshot. Keep
// this list tight — adding a noisy field (e.g. `fetchedAt`) would mean a
// new snapshot on EVERY lookup and would defeat the dedupe purpose.
export type CarrierFingerprint = {
  name?: string;
  dba?: string;
  address?: string;
  phone?: string;
  emailDomain?: string;
  authorityStatus?: string;
  commonAuthority?: string;
  brokerAuthority?: string;
  contractAuthority?: string;
  authorityGrantDate?: string;
  safetyRating?: string;
  outOfService?: boolean;
  bipdOnFile?: number;
  bondOnFile?: number;
  cargoOnFile?: number;
  cargoRequired?: boolean;
  mcs150Date?: string;
  mcs150Outdated?: boolean;
  powerUnits?: number;
  drivers?: number;
  crashTotal?: number;
  fatalCrash?: number;
};

export type CarrierSnapshotRow = {
  id: string;
  dot: string | null;
  mc: string | null;
  name: string | null;
  fingerprint: string;
  data: CarrierFingerprint;
  changed_fields: string[];
  source: 'lookup' | 'bulk' | string;
  captured_at: string;
};

export function buildFingerprint(c: CarrierReport): { fields: CarrierFingerprint; hash: string } {
  // Pull only the fields we care about. JSON-stable order so the same
  // carrier state always produces the same hash.
  const fields: CarrierFingerprint = {
    name: c.name?.trim().toUpperCase(),
    dba: c.dba?.trim().toUpperCase(),
    address: c.address?.trim().toUpperCase(),
    phone: c.phone?.replace(/[^0-9]/g, ''),
    emailDomain: c.emailDomain?.trim().toLowerCase(),
    authorityStatus: c.authorityStatus,
    commonAuthority: c.commonAuthority,
    brokerAuthority: c.brokerAuthority,
    contractAuthority: c.contractAuthority,
    authorityGrantDate: c.authorityGrantDate,
    safetyRating: c.safetyRating,
    outOfService: c.outOfService,
    bipdOnFile: c.bipdOnFile,
    bondOnFile: c.bondOnFile,
    cargoOnFile: c.cargoOnFile,
    cargoRequired: c.cargoRequired,
    mcs150Date: c.mcs150Date,
    mcs150Outdated: c.mcs150Outdated,
    powerUnits: c.powerUnits,
    drivers: c.drivers,
    crashTotal: c.crashTotal,
    fatalCrash: c.fatalCrash,
  };
  const stable = stableStringify(fields);
  const hash = createHash('sha256').update(stable).digest('hex');
  return { fields, hash };
}

// Compare two fingerprints and return the names of fields that differ.
// Used to populate `changed_fields` so the UI can render a clean diff
// without re-deriving it from prior snapshots.
export function diffFingerprints(prev: CarrierFingerprint, next: CarrierFingerprint): string[] {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<keyof CarrierFingerprint>;
  const changed: string[] = [];
  for (const k of keys) {
    const a = prev[k];
    const b = next[k];
    if ((a ?? null) !== (b ?? null)) changed.push(k);
  }
  return changed;
}

// Record a snapshot for a freshly-fetched carrier. Returns the inserted row
// or `null` if no insert happened (no change since last snapshot, or the
// carrier has no DOT/MC to key on).
//
// CALL SITE: this is fire-and-forget from `lookupCarrier`. Errors swallow
// silently so a Supabase hiccup never breaks a user lookup.
export async function recordSnapshot(c: CarrierReport): Promise<CarrierSnapshotRow | null> {
  if (!c.dot && !c.mc) return null;

  let svc;
  try {
    const mod = await import('./supabase/service');
    svc = mod.getServiceSupabase();
  } catch {
    return null;
  }
  if (!svc) return null;

  const { fields, hash } = buildFingerprint(c);

  // Look up the most recent snapshot for this carrier. We key by DOT first
  // (more stable than MC — the same operator often gets a new MC but keeps
  // their DOT) and fall back to MC if DOT is missing.
  let prevQuery = svc
    .from('carrier_snapshots')
    .select('fingerprint,data')
    .order('captured_at', { ascending: false })
    .limit(1);
  if (c.dot) prevQuery = prevQuery.eq('dot', c.dot);
  else if (c.mc) prevQuery = prevQuery.eq('mc', c.mc);

  const { data: prev } = await prevQuery.maybeSingle();
  if (prev && prev.fingerprint === hash) return null;

  const changedFields = prev ? diffFingerprints(prev.data as CarrierFingerprint, fields) : ['initial'];
  if (prev && changedFields.length === 0) return null;

  const { data: inserted, error } = await svc
    .from('carrier_snapshots')
    .insert({
      dot: c.dot ?? null,
      mc: c.mc ?? null,
      name: c.name ?? null,
      fingerprint: hash,
      data: fields,
      changed_fields: changedFields,
      source: 'lookup',
    })
    .select()
    .single();

  if (error) {
    console.warn('[carrier-snapshots] insert failed:', error.message);
    return null;
  }
  return inserted as CarrierSnapshotRow;
}

// Last-resort lookup. When FMCSA primary + Socrata + the FMCSA cache all
// fail to return data for a given MC or DOT, but we have a snapshot in
// `carrier_snapshots` (live or imported), reconstruct a best-effort
// CarrierReport from it. The result is partial — only the fields we
// fingerprint — but it's far better than 503'ing the user.
export async function findCarrierFromSnapshot(args: { dot?: string; mc?: string }): Promise<{ data: CarrierFingerprint; capturedAt: string; source: string; name: string | null; mc: string | null; dot: string | null } | null> {
  const { dot, mc } = args;
  if (!dot && !mc) return null;
  const { getServiceSupabase } = await import('./supabase/service');
  const svc = getServiceSupabase();
  if (!svc) return null;

  let query = svc
    .from('carrier_snapshots')
    .select('dot,mc,name,data,captured_at,source')
    .order('captured_at', { ascending: false })
    .limit(1);
  if (dot) query = query.eq('dot', dot);
  else if (mc) query = query.eq('mc', mc);

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return {
    name: data.name as any,
    mc: data.mc as any,
    dot: data.dot as any,
    data: (data.data || {}) as CarrierFingerprint,
    capturedAt: data.captured_at as any,
    source: data.source as any,
  };
}

// Walks the most-recent N snapshots for a carrier and merges them into a
// single "best-available" view. For each field we keep the value from the
// MOST RECENT snapshot that actually had it populated. Useful for backfill
// when today's primary FMCSA call returned an empty field but an older
// snapshot has it (common for phone, fax, drivers count, etc.).
export async function findCarrierFieldsFromSnapshots(
  args: { dot?: string; mc?: string },
  depth: number = 10,
): Promise<Partial<CarrierFingerprint> | null> {
  const { dot, mc } = args;
  if (!dot && !mc) return null;
  const { getServiceSupabase } = await import('./supabase/service');
  const svc = getServiceSupabase();
  if (!svc) return null;

  let query = svc
    .from('carrier_snapshots')
    .select('data,captured_at')
    .order('captured_at', { ascending: false })
    .limit(Math.max(1, Math.min(50, depth)));
  if (dot) query = query.eq('dot', dot);
  else if (mc) query = query.eq('mc', mc);

  const { data, error } = await query;
  if (error || !data || data.length === 0) return null;

  // Walk newest to oldest. For each field, the first time we see a value
  // populated, lock it in.
  const merged: Record<string, any> = {};
  for (const row of data) {
    const d = (row.data || {}) as Record<string, any>;
    for (const [k, v] of Object.entries(d)) {
      if (v == null || v === '' || k in merged) continue;
      merged[k] = v;
    }
  }
  return merged as Partial<CarrierFingerprint>;
}

// Read the timeline for one carrier, newest first.
export async function getCarrierHistory(args: { dot?: string; mc?: string; limit?: number }): Promise<CarrierSnapshotRow[]> {
  const { dot, mc } = args;
  const limit = Math.min(Math.max(args.limit ?? 25, 1), 200);
  if (!dot && !mc) return [];
  const { getServiceSupabase } = await import('./supabase/service');
  const svc = getServiceSupabase();
  if (!svc) return [];

  let query = svc
    .from('carrier_snapshots')
    .select('id,dot,mc,name,fingerprint,data,changed_fields,source,captured_at')
    .order('captured_at', { ascending: false })
    .limit(limit);
  if (dot) query = query.eq('dot', dot);
  else if (mc) query = query.eq('mc', mc);

  const { data, error } = await query;
  if (error) {
    console.warn('[carrier-snapshots] read failed:', error.message);
    return [];
  }
  return (data || []) as CarrierSnapshotRow[];
}

// JSON.stringify with stable key order — so the same object always produces
// the same hash, even if its keys arrived in a different order.
function stableStringify(obj: any): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}
