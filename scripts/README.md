# FMCSA bulk ingest

Populate your `fmcsa_cache` table with every US broker / motor carrier so
lookups are instant and survive FMCSA API outages.

## What this solves

- FMCSA's public API goes down → your app keeps working (cache hits).
- First-ever lookup of an MC → instant (already cached).
- Zero per-request FMCSA API calls for pre-ingested carriers.

## One-time setup

Already done if you're reading this:
- `scripts/ingest-fmcsa.ts` — the ingest script
- `package.json` → `npm run ingest:fmcsa`
- Dependencies: `csv-parse`, `tsx`, `dotenv`

## Env vars required

In `.env.local` (should already be set):

```
NEXT_PUBLIC_SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=...
```

The script writes via service role, bypassing RLS.

## Step-by-step workflow

### 1. Download the FMCSA Motor Carrier Census CSV

Go to **https://data.transportation.gov/Trucking-and-Motorcoaches/Motor-Carrier-Census-Information-and-Registration-/az4n-8mr2**
→ click **Export → CSV**.

Expected file size: 500 MB – 1 GB.

If that dataset has moved, browse https://data.transportation.gov/browse?q=fmcsa+census for "Motor Carrier Census". The script auto-detects common column-name variants, so any reasonable CSV export should work.

Save somewhere OUTSIDE the repo so git doesn't try to track it:

```
~/Downloads/motor-carrier-census.csv
```

Or via command line:

```
curl -L -o ~/Downloads/motor-carrier-census.csv \
  "https://data.transportation.gov/api/views/az4n-8mr2/rows.csv?accessType=DOWNLOAD"
```

### 2. Ingest brokers (recommended first pass)

```
npm run ingest:fmcsa -- ~/Downloads/motor-carrier-census.csv brokers
```

Only rows with `broker_authority_status = 'A'` (Active) are ingested.

Expected output:

```
[ingest] file: /Users/you/Downloads/motor-carrier-census.csv
[ingest] mode: brokers
[ingest] processed 50,000 · written 12,847 · skipped 37,153
[ingest] processed 100,000 · written 28,041 · skipped 71,959
...
[ingest] DONE
  processed: 2,100,000
  written:   ~150,000
  skipped:   ~1,950,000
  duration:  ~30 min
```

### 3. Ingest carriers (optional, later)

Same CSV, different mode:

```
npm run ingest:fmcsa -- ~/Downloads/motor-carrier-census.csv carriers
```

Only rows with active common or contract authority.

Takes ~2-3 hours. Safe to run anytime.

### 4. Ingest everything (nuclear option)

```
npm run ingest:fmcsa -- ~/Downloads/motor-carrier-census.csv all
```

All ~2M rows — only recommended if you really need non-authorized carriers too.

### 5. Verify it worked

1. Open http://localhost:3001/admin (or your deployed admin URL)
2. Scroll to the **"FMCSA cache · permanent storage"** card
3. "Carriers cached" should jump to ~150K after brokers (or ~2M after all)
4. Test by visiting `/verify` and entering an MC you know is a broker — response should be instant.

## Monthly refresh

Download the latest CSV once a month and re-run the same command:

```
npm run ingest:fmcsa -- ~/Downloads/motor-carrier-census.csv brokers
```

The script upserts on `cache_key`, so it updates existing records instead
of creating duplicates.

## Script behaviour details

- **Streams** the CSV (no memory blowup, works with 5+ GB files)
- Upserts in **batches of 500**
- Writes **two cache rows per carrier**: `dot:<n>` and `mc:<n>` — so both DOT and MC lookups hit the cache.
- **Idempotent** — safe to cancel (Ctrl+C) and re-run
- **Case-insensitive column matching** with fallback variants so it handles both `DOT_NUMBER` and `dot_number`

## Storage estimate (Supabase Pro, 8 GB limit)

| Scope | Rows written | Est. storage |
|---|---|---|
| Brokers only | ~300 K | ~600 MB |
| + All carriers | +4.2 M | ~8 GB (tight) |

If you run out of room adding carriers, we can halve storage by dropping the redundant MC-key write — open an issue or ping Claude Code.

## Troubleshooting

**"Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"**
→ env vars aren't set in `.env.local`. The script uses the same values Next.js does.

**CSV parse errors**
→ Your CSV file is probably malformed or truncated — re-download.

**"upsert error: new row violates row-level security policy"**
→ You're using the anon key instead of the service role key. Check
`SUPABASE_SERVICE_ROLE_KEY` is actually a service-role key (starts with `eyJ...`
and is NOT the same as your anon key).

**Script runs but 0 written, all skipped**
→ The CSV column names are different from what we expect. Open the CSV in
Excel, check the header row, and either rename the columns or tell Claude
what the actual column names are so we can add them to the lookup table.

**Seeing `stripe_...` errors**
→ Wrong script — you want `ingest:fmcsa`, not `ingest:stripe` (which doesn't exist).
