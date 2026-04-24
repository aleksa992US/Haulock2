#!/usr/bin/env tsx
/**
 * Stream FMCSA Motor Carrier Census directly from data.transportation.gov
 * into Supabase fmcsa_cache — no local CSV download required.
 *
 * Uses Socrata API with server-side $where filtering so we only pull the
 * rows we want. Much faster than CSV download + filter for narrow ingests
 * (e.g. brokers-only ~= 150K rows in ~5 minutes).
 *
 * Usage:
 *   npm run ingest:fmcsa-api -- brokers
 *   npm run ingest:fmcsa-api -- carriers
 *   npm run ingest:fmcsa-api -- all
 *
 * Env:
 *   NEXT_PUBLIC_SUPABASE_URL        (required)
 *   SUPABASE_SERVICE_ROLE_KEY       (required)
 *   SOCRATA_APP_TOKEN               (optional, higher rate limits)
 *   SOCRATA_DATASET_ID              (optional, default "az4n-8mr2")
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const DATASET = process.env.SOCRATA_DATASET_ID || 'az4n-8mr2';
const APP_TOKEN = process.env.SOCRATA_APP_TOKEN;
// Socrata page size: 50K works cleanly with an App Token; without one, the
// public tier rate-limits aggressively, so use 5K and throttle ourselves.
const PAGE = APP_TOKEN ? 50000 : 5000;
const INTER_PAGE_DELAY_MS = APP_TOKEN ? 0 : 500;
// Supabase is fronted by Cloudflare which 520s on large/fast POST bursts.
// 100 rows per upsert keeps payloads small and errors rare.
const UPSERT_BATCH = 100;
const BASE = `https://data.transportation.gov/resource/${DATASET}.json`;

type Mode = 'brokers' | 'carriers' | 'all' | 'active';
const [, , modeArg] = process.argv;
const mode: Mode = (modeArg === 'carriers' || modeArg === 'all' || modeArg === 'active' ? modeArg : 'brokers');
const WHERE_OVERRIDE = process.env.SOCRATA_WHERE || '';

console.log(`[ingest-api] dataset: ${DATASET}`);
console.log(`[ingest-api] mode:    ${mode}${WHERE_OVERRIDE ? ' (overridden)' : ''}`);
console.log(`[ingest-api] token:   ${APP_TOKEN ? 'yes (higher rate limits)' : 'no (default limits — may be slower)'}`);
console.log(`[ingest-api] target:  ${SUPABASE_URL}`);
console.log('');

function whereClause(): string {
  // Explicit override from env wins.
  if (WHERE_OVERRIDE) return WHERE_OVERRIDE;
  // These filters assume the dataset has FMCSA Licensing & Insurance columns.
  // Not every dataset has them — the Company Census (az4n-8mr2) doesn't, for
  // example. Pass an empty filter for datasets without these columns.
  if (mode === 'brokers') return `broker_authority_status='A'`;
  if (mode === 'carriers') return `(common_authority_status='A' OR contract_authority_status='A')`;
  if (mode === 'active') return `status_code='A'`;          // works on Company Census
  return ''; // all — ingests everything in the dataset
}

// Same helpers as the CSV script so we can reuse shapeRow.
function pick(row: Record<string, any>, ...keys: string[]): string | null {
  for (const k of keys) {
    for (const actual of Object.keys(row)) {
      if (actual.toLowerCase() === k.toLowerCase()) {
        const v = row[actual];
        if (v != null && String(v) !== '') return String(v).trim();
      }
    }
  }
  return null;
}

function pickNum(row: Record<string, any>, ...keys: string[]): number | null {
  const raw = pick(row, ...keys);
  if (raw == null) return null;
  const n = Number(raw.replace(/[,$]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function stripMcPrefix(raw: string | null): string | null {
  if (!raw) return null;
  return raw.replace(/[^0-9]/g, '') || null;
}

function shapeRow(row: Record<string, any>): { cacheKey: string; response: any; carrier: any } | null {
  const dot = stripMcPrefix(pick(row, 'dot_number', 'dot', 'usdot_number'));
  const docket = stripMcPrefix(pick(row, 'mc_mx_ff_number', 'docket_number', 'mc_number'));
  if (!dot && !docket) return null;

  const preferDot = !!dot;
  const cacheKey = preferDot ? `dot:${dot}` : `mc:${docket}`;

  const carrier: any = {
    dotNumber: dot ?? undefined,
    docketNumber: docket ?? undefined,
    legalName: pick(row, 'legal_name', 'name'),
    dbaName: pick(row, 'dba_name', 'dba'),
    phyStreet: pick(row, 'phy_street', 'physical_street', 'street'),
    phyCity: pick(row, 'phy_city', 'physical_city', 'city'),
    phyState: pick(row, 'phy_state', 'physical_state', 'state'),
    phyZipcode: pick(row, 'phy_zip', 'phy_zipcode', 'physical_zipcode', 'zip'),
    telephone: pick(row, 'telephone', 'phone'),
    commonAuthorityStatus: pick(row, 'common_authority_status'),
    brokerAuthorityStatus: pick(row, 'broker_authority_status'),
    contractAuthorityStatus: pick(row, 'contract_authority_status'),
    allowedToOperate: pick(row, 'allowed_to_operate'),
    oosDate: pick(row, 'oos_date', 'out_of_service_date'),
    bipdInsuranceOnFile: pickNum(row, 'bipd_insurance_on_file', 'bipd_ins_on_file'),
    cargoInsuranceOnFile: pickNum(row, 'cargo_insurance_on_file', 'cargo_ins_on_file'),
    bondInsuranceOnFile: pickNum(row, 'bond_insurance_on_file', 'bond_ins_on_file'),
    cargoInsuranceRequired: pick(row, 'cargo_insurance_required'),
    authorityGrantedDate: pick(row, 'authority_granted_date', 'original_authority_date'),
    firstAuthorityDate: pick(row, 'first_authority_date'),
    originalAuthorityDate: pick(row, 'original_authority_date'),
    totalDrivers: pickNum(row, 'total_drivers', 'drivers'),
    totalPowerUnits: pickNum(row, 'total_power_units', 'power_units'),
    crashTotal: pickNum(row, 'total_crashes', 'crash_total'),
  };
  return { cacheKey, response: { content: { carrier } }, carrier };
}

// -----------------------------------------------------------------------------

let filterDisabled = false;

async function fetchPage(offset: number): Promise<any[]> {
  const params = new URLSearchParams();
  params.set('$limit', String(PAGE));
  params.set('$offset', String(offset));
  params.set('$order', 'dot_number');
  const w = filterDisabled ? '' : whereClause();
  if (w) params.set('$where', w);

  const url = `${BASE}?${params.toString()}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (APP_TOKEN) headers['X-App-Token'] = APP_TOKEN;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    // If the filter references a column that doesn't exist in this dataset,
    // log a warning and retry with no filter (ingest everything).
    if (res.status === 400 && /no-such-column/i.test(body) && !filterDisabled && w) {
      console.warn(`[ingest-api] filter "${w}" references a column this dataset doesn't have — disabling filter and ingesting all rows.`);
      filterDisabled = true;
      return fetchPage(offset);
    }
    throw new Error(`Socrata ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as any[];
}

let batch: { cache_key: string; response: any; cached_at: string }[] = [];
let totalProcessed = 0;
let totalWritten = 0;
let totalSkipped = 0;
let pageNum = 0;

async function flushBatch() {
  if (!batch.length) return;
  const toWrite = batch;
  batch = [];
  // Retry on transient 5xx/network errors (Supabase via Cloudflare 520s under load).
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { error } = await svc.from('fmcsa_cache').upsert(toWrite, { onConflict: 'cache_key' });
      if (!error) { totalWritten += toWrite.length; return; }
      const msg = (error.message || '').slice(0, 200);
      if (attempt === 4) { console.error(`[ingest-api] upsert failed (${toWrite.length} rows):`, msg); return; }
      console.warn(`[ingest-api] upsert attempt ${attempt} failed: ${msg} — retrying`);
    } catch (err: any) {
      if (attempt === 4) { console.error(`[ingest-api] upsert threw (${toWrite.length} rows):`, err?.message); return; }
      console.warn(`[ingest-api] upsert attempt ${attempt} threw: ${err?.message?.slice(0, 200)} — retrying`);
    }
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

async function handleRow(row: any) {
  totalProcessed += 1;
  const shaped = shapeRow(row);
  if (!shaped) { totalSkipped += 1; return; }
  const now = new Date().toISOString();
  batch.push({ cache_key: shaped.cacheKey, response: shaped.response, cached_at: now });
  if (shaped.cacheKey.startsWith('dot:') && shaped.carrier.docketNumber) {
    batch.push({ cache_key: `mc:${shaped.carrier.docketNumber}`, response: shaped.response, cached_at: now });
  }
  if (batch.length >= UPSERT_BATCH) await flushBatch();
}

async function main() {
  const started = Date.now();
  let offset = 0;
  while (true) {
    pageNum += 1;
    let page: any[];
    try {
      page = await fetchPage(offset);
    } catch (err: any) {
      // Simple backoff on transient failures (429, 503, network hiccups).
      console.warn(`[ingest-api] page ${pageNum} failed: ${err?.message?.slice(0, 160)} — retrying in 4s`);
      await new Promise((r) => setTimeout(r, 4000));
      page = await fetchPage(offset);
    }
    if (!page.length) break;

    for (const row of page) await handleRow(row);
    await flushBatch();

    console.log(`[ingest-api] page ${pageNum} @ offset=${offset.toLocaleString()} · processed ${totalProcessed.toLocaleString()} · written ${totalWritten.toLocaleString()} · skipped ${totalSkipped.toLocaleString()}`);

    if (page.length < PAGE) break; // last page
    offset += PAGE;
    if (INTER_PAGE_DELAY_MS) await new Promise((r) => setTimeout(r, INTER_PAGE_DELAY_MS));
  }

  const duration = ((Date.now() - started) / 1000).toFixed(1);
  console.log('');
  console.log('[ingest-api] DONE');
  console.log(`  processed: ${totalProcessed.toLocaleString()}`);
  console.log(`  written:   ${totalWritten.toLocaleString()}`);
  console.log(`  skipped:   ${totalSkipped.toLocaleString()}`);
  console.log(`  duration:  ${duration}s`);
}

main().catch((err) => { console.error(err); process.exit(1); });
