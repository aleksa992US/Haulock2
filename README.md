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
