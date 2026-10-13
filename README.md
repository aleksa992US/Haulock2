# Haulock

> Verify every broker. Protect every load.

A broker verification and freight-fraud protection SaaS for trucking carriers. Built with Next.js 14, TypeScript, and Tailwind CSS.

## What's in this repo

This is the front-end MVP skeleton. It includes:

- Landing page with hero, features, testimonials, pricing, FAQ
- Login / Signup flow (mock auth for now)
- Dashboard with stats, recent lookups, fraud alerts feed
- Broker verify tool (quick lookup, rate con analyzer, bulk verify tabs)
- Full risk report page with gauge, red flags, community reports
- Fraud reports community feed
- Watchlist
- Alerts
- Settings

All data is currently mocked. Wire up the FMCSA API, Supabase, and Stripe per the `PROJECT_PLAN.md` to make it real.

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Deploy to Vercel

The easiest way:

1. Push this repo to GitHub
2. Go to https://vercel.com/new
3. Import the repo
4. Click Deploy

Vercel will auto-detect Next.js and configure everything. First deploy takes about 90 seconds.

For a custom domain (like haulock.com), go to your Vercel project → Settings → Domains.

## Environment variables

Copy `.env.example` to `.env.local` and fill in as you build out backend features:

- **Supabase** — sign up at https://supabase.com, create a project, copy URL + keys from Settings → API
- **FMCSA API** — register at https://mobile.fmcsa.dot.gov/QCDevsite (approval takes a few days)
- **Stripe** — grab keys from https://dashboard.stripe.com/apikeys

## Forward-to-scan (scan@haulock.com) and COI checks

**COI check** (`/api/coi/check`, Verify → COI check) reads a certificate of insurance with
Document AI + Claude and compares it with FMCSA's public insurance filings (dataset
`qh9u-swkp` on data.transportation.gov) and the PDF metadata. No new keys needed; optional
`FMCSA_INSURANCE_DATASET_ID` overrides the dataset. Monthly limits: `coiChecks` in `lib/plans.ts`.

**Forward-to-scan** (`/api/inbound/email`) replies to forwarded rate cons and COIs. Setup:

1. Run the `inbound_scans` table from `supabase/schema.sql` in the Supabase SQL editor.
2. Resend → Receiving: add a receiving domain. If haulock.com mail already runs on another
   provider (e.g. Google Workspace), use a subdomain such as `in.haulock.com` and forward
   `scan@haulock.com` to `scan@in.haulock.com` from your mail provider.
3. Resend → Webhooks: add `https://haulock.com/api/inbound/email` with the `email.received`
   event; copy its signing secret.
4. Env vars:
   - `RESEND_INBOUND_WEBHOOK_SECRET` — the webhook signing secret (required)
   - `INBOUND_SCAN_ADDRESS` — address shown in replies (default `scan@haulock.com`)
   - `INBOUND_SCAN_ADDRESSES` — optional comma list; only emails to these are processed
   - `INBOUND_PREVIEW_MONTHLY` — free/unknown senders' preview replies per month (default 3)
   - `INBOUND_DAILY_CAP` — max emails per sender per day before ignoring (default 25)
   - `NEXT_PUBLIC_SCAN_EMAIL` — address shown in the app (default `scan@haulock.com`)

Paid plans get full replies and the result saved to history (counts against rate con / COI
limits); free and unknown senders get a preview. Replies carry `Auto-Submitted` and
`X-Haulock-Scan` headers, and auto-replies, mailing lists and our own domain are ignored, so
mail loops can't start.

## Project structure

```
haulock/
├── app/
│   ├── layout.tsx          # Root layout with fonts
│   ├── page.tsx            # Main entry
│   └── globals.css         # Global styles + animations
├── components/
│   └── Haulock.tsx         # Full app skeleton (will split into separate files)
├── public/                 # Static assets
├── lib/                    # Future: FMCSA wrapper, scoring engine
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── next.config.js
```

## Next steps

See `PROJECT_PLAN.md` in the parent folder for the full roadmap. Immediate priorities:

1. Apply for FMCSA WebKey (approval takes time, start early)
2. Set up Supabase project and run migrations
3. Replace mock auth with real Supabase Auth
4. Build `lib/fmcsa.ts` for real broker lookups
5. Wire up Stripe Checkout

## Tech stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Auth** (planned): Supabase
- **Database** (planned): Supabase Postgres
- **Payments** (planned): Stripe
- **Hosting**: Vercel
