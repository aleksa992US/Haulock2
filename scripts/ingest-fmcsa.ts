#!/usr/bin/env tsx
/**
 * Bulk-ingest FMCSA Motor Carrier Census CSV into Supabase fmcsa_cache.
 *
 * Usage:
 *   npm run ingest:fmcsa -- ./path/to/census.csv brokers
 *   npm run ingest:fmcsa -- ./path/to/census.csv carriers
 *   npm run ingest:fmcsa -- ./path/to/census.csv all
 *
 * mode:
 *   brokers  — rows where broker authority is Active (A) — recommended first pass
 *   carriers — rows where common/contract authority is Active
 *   all      — every row with a DOT number
 *
 * Reads column names case-insensitively and falls back to common variants,
 * so it works with both the data.transportation.gov Motor Carrier Census
 * export and the FMCSA SMS bulk download.
 */

import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
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

type Mode = 'brokers' | 'carriers' | 'all';

const [, , filePath, modeArg] = process.argv;
const mode: Mode = (modeArg === 'carriers' || modeArg === 'all' ? modeArg : 'brokers');

if (!filePath) {
  console.error('Usage: npm run ingest:fmcsa -- <path-to-csv> [brokers|carriers|all]');
  process.exit(1);
}

console.log(`[ingest] file: ${filePath}`);
console.log(`[ingest] mode: ${mode}`);
console.log(`[ingest] target: ${SUPABASE_URL}`);

// ---- Column lookup helpers ---------------------------------------------------

function pick(row: Record<string, string>, ...keys: string[]): string | null {
  for (const k of keys) {
    for (const actual of Object.keys(row)) {
      if (actual.toLowerCase() === k.toLowerCase()) {
        const v = row[actual];
        if (v != null && v !== '') return String(v).trim();
      }
    }
  }
  return null;
}

function pickNum(row: Record<string, string>, ...keys: string[]): number | null {
  const raw = pick(row, ...keys);
  if (raw == null) return null;
  const n = Number(raw.replace(/[,$]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function stripMcPrefix(raw: string | null): string | null {
  if (!raw) return null;
  return raw.replace(/[^0-9]/g, '') || null;
}

// ---- Authority filter --------------------------------------------------------

function shouldInclude(row: Record<string, string>): boolean {
  const brokerActive = pick(row, 'broker_authority_status', 'broker_auth_status') === 'A';
  const commonActive = pick(row, 'common_authority_status', 'common_auth_status') === 'A';
  const contractActive = pick(row, 'contract_authority_status', 'contract_auth_status') === 'A';
  if (mode === 'brokers') return brokerActive;
  if (mode === 'carriers') return commonActive || contractActive;
  return true;
}

// ---- Shape a CSV row into something lib/fmcsa.ts normalize() can parse -------

function shapeRow(row: Record<string, string>): { cacheKey: string; response: any } | null {
  const dot = stripMcPrefix(pick(row, 'dot_number', 'dot', 'usdot_number'));
  const docket = stripMcPrefix(pick(row, 'mc_mx_ff_number', 'docket_number', 'mc_number'));
  if (!dot && !docket) return null;

  // Prefer DOT as the primary cache key (it's always present). Also write an MC
  // key so MC lookups hit the cache too.
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
    commonAuthorityStatus: pick(row, 'common_authority_status', 'common_auth_status'),
    brokerAuthorityStatus: pick(row, 'broker_authority_status', 'broker_auth_status'),
    contractAuthorityStatus: pick(row, 'contract_authority_status', 'contract_auth_status'),
    allowedToOperate: pick(row, 'allowed_to_operate'),
    oosDate: pick(row, 'oos_date', 'out_of_service_date'),
    bipdInsuranceOnFile: pickNum(row, 'bipd_insurance_on_file', 'bipd_insurance', 'bipd_ins_on_file'),
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

  return {
    cacheKey,
    response: { content: { carrier } },
  };
}

// ---- Batched upsert ----------------------------------------------------------

const BATCH_SIZE = 500;
let batch: { cache_key: string; response: any; cached_at: string }[] = [];
let totalProcessed = 0;
let totalWritten = 0;
let totalSkipped = 0;
let lastPrintAt = Date.now();

async function flushBatch() {
  if (!batch.length) return;
  const toWrite = batch;
  batch = [];
  const { error } = await svc.from('fmcsa_cache').upsert(toWrite, { onConflict: 'cache_key' });
  if (error) {
    console.error(`[ingest] upsert error (${toWrite.length} rows):`, error.message);
  } else {
    totalWritten += toWrite.length;
  }
}

async function handleRow(row: Record<string, string>) {
  totalProcessed += 1;
  if (!shouldInclude(row)) { totalSkipped += 1; return; }
  const shaped = shapeRow(row);
  if (!shaped) { totalSkipped += 1; return; }

  const now = new Date().toISOString();
  batch.push({ cache_key: shaped.cacheKey, response: shaped.response, cached_at: now });

  // Also write the companion MC key so MC lookups hit the same cache.
  const carrier = shaped.response.content.carrier;
  if (shaped.cacheKey.startsWith('dot:') && carrier.docketNumber) {
    batch.push({ cache_key: `mc:${carrier.docketNumber}`, response: shaped.response, cached_at: now });
  }

  if (batch.length >= BATCH_SIZE) await flushBatch();

  if (Date.now() - lastPrintAt > 5000) {
    console.log(`[ingest] processed ${totalProcessed.toLocaleString()} · written ${totalWritten.toLocaleString()} · skipped ${totalSkipped.toLocaleString()}`);
    lastPrintAt = Date.now();
  }
}

// ---- Main --------------------------------------------------------------------

async function main() {
  const start = Date.now();
  const parser = createReadStream(filePath).pipe(
    parse({ columns: (h) => h.map((c: string) => c.trim()), skip_empty_lines: true, trim: true }),
  );

  for await (const record of parser) {
    await handleRow(record);
  }
  await flushBatch();

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log('');
  console.log('[ingest] DONE');
  console.log(`  processed: ${totalProcessed.toLocaleString()}`);
  console.log(`  written:   ${totalWritten.toLocaleString()}`);
  console.log(`  skipped:   ${totalSkipped.toLocaleString()}`);
  console.log(`  duration:  ${duration}s`);
}

main().catch((err) => { console.error(err); process.exit(1); });
