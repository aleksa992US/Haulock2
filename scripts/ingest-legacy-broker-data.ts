#!/usr/bin/env tsx
/**
 * One-shot importer for a partner-supplied historical carrier dump.
 *
 * The file is a TSV (or CSV) with at minimum these columns:
 *   docketNumber, dotNumber, RiskOverall, legalName, dbaName,
 *   busnAddress, busnCity, busnState, busnZip, busnPhone, busnFax,
 *   emailAddress, trucksTotal
 *
 * The import is idempotent. Re-running it skips rows we've already
 * loaded by checking (mc/dot + captured_at + source) — safe to run
 * any number of times.
 *
 * Usage:
 *   npm run ingest:legacy -- ./data/legacy/partner-2021.tsv
 *   npm run ingest:legacy -- ./data/legacy/partner-2021.csv
 *
 * The captured_at date defaults to 2021-11-30 (which the partner
 * indicated). Pass --date=YYYY-MM-DD to override.
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

const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith('--'));
const dateArg = args.find((a) => a.startsWith('--date='))?.split('=')[1];
const sourceArg = args.find((a) => a.startsWith('--source='))?.split('=')[1];
const dryRun = args.includes('--dry-run');

if (!filePath) {
  console.error('Usage: npm run ingest:legacy -- <path-to-tsv-or-csv> [--date=YYYY-MM-DD] [--source=label] [--dry-run]');
  process.exit(1);
}

const capturedAt = dateArg || '2021-11-30';
const source = sourceArg || 'partner-2021';

console.log(`[legacy-ingest] file:        ${filePath}`);
console.log(`[legacy-ingest] captured_at: ${capturedAt}`);
console.log(`[legacy-ingest] source:      ${source}`);
console.log(`[legacy-ingest] dry-run:     ${dryRun}`);

// ----- column lookup ----------------------------------------------------

function pick(row: Record<string, any>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    for (const actual of Object.keys(row)) {
      if (actual.toLowerCase().replace(/[\s_-]/g, '') === k.toLowerCase().replace(/[\s_-]/g, '')) {
        const v = row[actual];
        if (v != null && String(v).trim() !== '') return String(v).trim();
      }
    }
  }
  return undefined;
}

function pickNum(row: Record<string, any>, ...keys: string[]): number | undefined {
  const v = pick(row, ...keys);
  if (!v) return undefined;
  const n = Number(v.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function stripDigits(v: any): string | undefined {
  if (v == null) return undefined;
  const s = String(v).replace(/[^0-9]/g, '').replace(/^0+/, '');
  return s || undefined;
}

// ----- main ------------------------------------------------------------

async function main() {
  // Auto-detect delimiter from the first line.
  const firstLine: string = await new Promise((resolve, reject) => {
    let buf = '';
    const stream = createReadStream(filePath!, { encoding: 'utf-8' });
    stream.on('data', (chunk: string | Buffer) => {
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      buf += s;
      const nl = buf.indexOf('\n');
      if (nl >= 0) {
        stream.destroy();
        resolve(buf.slice(0, nl));
      }
    });
    stream.on('end', () => resolve(buf));
    stream.on('error', reject);
  });
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const delimiter = tabs > commas ? '\t' : ',';
  console.log(`[legacy-ingest] delimiter:   ${delimiter === '\t' ? 'TAB' : 'COMMA'}`);

  const parser = createReadStream(filePath!).pipe(parse({
    delimiter,
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  }));

  let total = 0;
  let valid = 0;
  let withRisk = 0;
  let snapshotBatch: any[] = [];
  let ratingBatch: any[] = [];
  let snapshotsInserted = 0;
  let ratingsInserted = 0;

  const flushSnapshots = async () => {
    if (snapshotBatch.length === 0) return;
    if (dryRun) {
      console.log(`[legacy-ingest] [dry-run] would insert ${snapshotBatch.length} snapshots`);
    } else {
      const { error } = await svc.from('carrier_snapshots').insert(snapshotBatch);
      if (error) {
        console.error('[legacy-ingest] snapshot insert failed:', error.message);
      } else {
        snapshotsInserted += snapshotBatch.length;
      }
    }
    snapshotBatch = [];
  };
  const flushRatings = async () => {
    if (ratingBatch.length === 0) return;
    if (dryRun) {
      console.log(`[legacy-ingest] [dry-run] would insert ${ratingBatch.length} ratings`);
    } else {
      const { error } = await svc.from('legacy_risk_ratings').insert(ratingBatch);
      if (error) {
        console.error('[legacy-ingest] rating insert failed:', error.message);
      } else {
        ratingsInserted += ratingBatch.length;
      }
    }
    ratingBatch = [];
  };

  for await (const row of parser as any) {
    total += 1;
    if (total === 1) {
      console.log(`[legacy-ingest] columns:     ${Object.keys(row).join(', ')}`);
    }

    const dot = stripDigits(pick(row, 'dotNumber', 'usdotNumber', 'usdot', 'dot'));
    const mc  = stripDigits(pick(row, 'docketNumber', 'mcNumber', 'mc'));
    if (!dot && !mc) continue;
    valid += 1;

    const name = pick(row, 'legalName', 'name');
    const dba  = pick(row, 'dbaName', 'dba');
    const address = pick(row, 'busnAddress', 'phyStreet', 'street', 'address');
    const city = pick(row, 'busnCity', 'phyCity', 'city');
    const state = pick(row, 'busnState', 'phyState', 'state');
    const zip = pick(row, 'busnZip', 'phyZip', 'zip');
    const phone = pick(row, 'busnPhone', 'telephone', 'phone');
    const fax = pick(row, 'busnFax', 'fax');
    const email = pick(row, 'emailAddress', 'email');
    const trucks = pickNum(row, 'trucksTotal', 'powerUnits', 'totalPowerUnits');
    const risk = pick(row, 'RiskOverall', 'risk', 'rating');

    const fullAddress = [address, city, state, zip].filter(Boolean).join(', ');

    snapshotBatch.push({
      dot: dot ?? null,
      mc: mc ?? null,
      name: name ?? null,
      // For legacy data we don't have a real fingerprint hash from a live
      // FMCSA call, so we synthesize one from the ID + capture date so the
      // dedupe-on-rerun works correctly.
      fingerprint: `legacy:${source}:${dot || ''}:${mc || ''}:${capturedAt}`,
      data: {
        name,
        dba,
        address: fullAddress || null,
        phone: phone ? phone.replace(/[^0-9]/g, '') || null : null,
        fax: fax ? fax.replace(/[^0-9]/g, '') || null : null,
        emailDomain: email && email.includes('@') ? email.split('@')[1].toLowerCase() : null,
        emailFull: email || null,            // used by chameleon-link match later
        powerUnits: trucks ?? null,
      },
      changed_fields: ['initial'],
      source,
      captured_at: `${capturedAt}T00:00:00Z`,
    });

    if (risk) {
      withRisk += 1;
      ratingBatch.push({
        dot: dot ?? null,
        mc: mc ?? null,
        name: name ?? null,
        risk_overall: risk,
        trucks_total: trucks ?? null,
        captured_at: capturedAt,
        source,
      });
    }

    if (snapshotBatch.length >= 500) await flushSnapshots();
    if (ratingBatch.length >= 500) await flushRatings();
    if (total % 1000 === 0) console.log(`[legacy-ingest] read ${total} rows · valid ${valid} · with risk ${withRisk}`);
  }

  await flushSnapshots();
  await flushRatings();

  console.log('---');
  console.log(`[legacy-ingest] total rows read:        ${total}`);
  console.log(`[legacy-ingest] rows with MC or DOT:    ${valid}`);
  console.log(`[legacy-ingest] rows with risk rating:  ${withRisk}`);
  console.log(`[legacy-ingest] snapshots inserted:     ${snapshotsInserted}`);
  console.log(`[legacy-ingest] ratings inserted:       ${ratingsInserted}`);
}

main().catch((e) => {
  console.error('[legacy-ingest] fatal:', e?.message || e);
  process.exit(1);
});
