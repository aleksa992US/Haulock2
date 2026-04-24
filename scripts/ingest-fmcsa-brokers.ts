#!/usr/bin/env tsx
/**
 * Pull every active US broker from data.transportation.gov's "Carrier - All
 * With History" Socrata dataset and write them to fmcsa_cache under both
 * mc:<n> and dot:<n> keys. One-shot bulk ingest to warm the cache so future
 * rate-con scans are near-instant.
 *
 * Only writes records that meet a "good info" bar: must have docket_number,
 * legal_name, and at least one address field populated.
 *
 * Usage:
 *   npm run ingest:fmcsa-brokers
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_TOKEN = process.env.SOCRATA_APP_TOKEN;
const DATASET = process.env.FMCSA_SOCRATA_DATASET_ID || '6eyk-hxee';
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const BASE = `https://data.transportation.gov/resource/${DATASET}.json`;
const PAGE = APP_TOKEN ? 50000 : 5000;
const UPSERT_BATCH = 200;

console.log(`[brokers] dataset: ${DATASET}`);
console.log(`[brokers] token:   ${APP_TOKEN ? 'yes (50K/page)' : 'no (5K/page — slower)'}`);
console.log(`[brokers] filter:  broker_stat='A' (active brokers only)`);
console.log('');

function stripDigits(s: any): string {
  return String(s ?? '').replace(/[^0-9]/g, '').replace(/^0+/, '');
}

async function fetchPage(offset: number): Promise<any[]> {
  const params = new URLSearchParams();
  params.set('$limit', String(PAGE));
  params.set('$offset', String(offset));
  params.set('$where', `broker_stat='A'`);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (APP_TOKEN) headers['X-App-Token'] = APP_TOKEN;
  const res = await fetch(`${BASE}?${params.toString()}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`Socrata ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as any[];
}

function shapeRow(row: any) {
  const dot = stripDigits(row.dot_number);
  const docket = stripDigits(row.docket_number);
  const legalName = (row.legal_name || '').trim();
  if (!docket) return null; // must have MC — this is a broker ingest
  if (!legalName) return null;
  const hasAddress = !!(row.bus_street_po || row.mail_street_po || row.bus_city || row.mail_city);
  if (!hasAddress) return null; // "good info" bar

  const carrier: any = {
    dotNumber: dot || undefined,
    docketNumber: docket,
    legalName,
    dbaName: row.dba_name || undefined,
    phyStreet: row.bus_street_po || row.mail_street_po,
    phyCity: row.bus_city || row.mail_city,
    phyState: row.bus_state_code || row.mail_state_code,
    phyZipcode: row.bus_zip_code || row.mail_zip_code,
    telephone: row.bus_telno || row.mail_telno,
    commonAuthorityStatus: row.common_stat,
    brokerAuthorityStatus: row.broker_stat,
    contractAuthorityStatus: row.contract_stat,
    bipdInsuranceOnFile: row.bipd_file ? Number(row.bipd_file) : undefined,
    cargoInsuranceOnFile: row.cargo_file ? Number(row.cargo_file) : undefined,
    cargoInsuranceRequired: row.cargo_req,
    bondInsuranceOnFile: row.bond_file ? Number(row.bond_file) : undefined,
  };
  return { docket, dot, carrier };
}

let totalProcessed = 0;
let totalWritten = 0;
let totalSkipped = 0;
let batch: { cache_key: string; response: any; cached_at: string }[] = [];

async function flushBatch() {
  if (!batch.length) return;
  // Dedupe within batch (multiple records per broker in "All With History").
  const seen = new Map<string, any>();
  for (const r of batch) seen.set(r.cache_key, r);
  const toWrite = Array.from(seen.values());
  batch = [];
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { error } = await svc.from('fmcsa_cache').upsert(toWrite, { onConflict: 'cache_key' });
      if (!error) { totalWritten += toWrite.length; return; }
      if (attempt === 4) console.error(`[brokers] upsert failed (${toWrite.length} rows):`, error.message);
      else console.warn(`[brokers] upsert ${attempt} failed: ${error.message.slice(0, 120)} — retrying`);
    } catch (err: any) {
      if (attempt === 4) console.error('[brokers] upsert threw:', err?.message);
    }
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

async function main() {
  const started = Date.now();
  let offset = 0;
  let pageNum = 0;
  while (true) {
    pageNum++;
    const page = await fetchPage(offset);
    if (!page.length) break;
    for (const row of page) {
      totalProcessed++;
      const shaped = shapeRow(row);
      if (!shaped) { totalSkipped++; continue; }
      const response = { content: { carrier: shaped.carrier } };
      const now = new Date().toISOString();
      batch.push({ cache_key: `mc:${shaped.docket}`, response, cached_at: now });
      if (shaped.dot) batch.push({ cache_key: `dot:${shaped.dot}`, response, cached_at: now });
      if (batch.length >= UPSERT_BATCH) await flushBatch();
    }
    await flushBatch();
    console.log(`[brokers] page ${pageNum} (offset ${offset.toLocaleString()}) · processed ${totalProcessed.toLocaleString()} · written ${totalWritten.toLocaleString()} · skipped ${totalSkipped.toLocaleString()}`);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  const duration = ((Date.now() - started) / 1000).toFixed(1);
  console.log('');
  console.log('[brokers] DONE');
  console.log(`  processed: ${totalProcessed.toLocaleString()}`);
  console.log(`  written:   ${totalWritten.toLocaleString()}`);
  console.log(`  skipped:   ${totalSkipped.toLocaleString()} (no docket / no name / no address)`);
  console.log(`  duration:  ${duration}s`);
}

main().catch((err) => { console.error(err); process.exit(1); });
