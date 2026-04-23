# FreightGuard — Complete Project Plan & Developer Handoff

> **Purpose of this document**
> This is the master plan for building FreightGuard, a broker verification and freight-fraud protection SaaS for trucking carriers. It is written so that an AI coding assistant (Claude in VS Code, Cursor, Claude Code, etc.) can read it, understand the full scope, and pick up implementation from any point. Drop this file in the repo root as `PROJECT_PLAN.md` before starting work.

---

## 1. Product Summary

**Name:** FreightGuard
**Tagline:** Verify every broker. Protect every load.
**What it does:** Lets carriers and owner-operators instantly check if a freight broker is legitimate, view a fraud risk score, analyze rate confirmations for red flags, and tap into a community-reported scam network.
**Who pays:** Trucking carriers (1 truck up to ~150 trucks), dispatchers, and small freight brokerages that want to vet counterparties.
**Business model:** SaaS subscription, three tiers (Free / Carrier $49/mo / Fleet $149/mo), plus optional API access on the top tier.

### Why this product wins
- Cargo theft, double-brokering, and identity fraud are at record highs heading into 2026.
- Existing tools (Highway, Carrier411, MyCarrierPortal, DAT CarrierWatch, RMIS) mostly sell to **brokers vetting carriers**. There is a real gap selling to **carriers vetting brokers**.
- The core data is free and public (FMCSA). The moat is the scoring algorithm + the community fraud-reporting network effect.

---

## 2. Tech Stack (Locked)

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 14 (App Router) + TypeScript | Modern, SEO-friendly marketing pages + fast dashboard |
| Styling | Tailwind CSS + shadcn/ui | Consistent, professional, fast to build |
| Auth | Supabase Auth | Email/password + Google OAuth, row-level security built in |
| Database | Supabase Postgres | Managed, scales, integrates with auth |
| File storage | Supabase Storage | Rate-con PDFs, evidence uploads |
| Payments | Stripe (Checkout + Billing Portal) | Standard subscription flow |
| Icons | Lucide React | Clean, consistent |
| Charts | Recharts | Risk timeline, insurance history viz |
| Toasts | Sonner | Modern notification library |
| OCR (phase 2) | OpenAI GPT-4 Vision or Claude | Rate con parsing |
| Hosting | Vercel | Zero-config Next.js deploys |
| Monitoring | Sentry (phase 2) | Error tracking |

### Environment variables required
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# FMCSA (get from https://mobile.fmcsa.dot.gov/QCDevsite)
FMCSA_API_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_PRICE_ID_CARRIER=
STRIPE_PRICE_ID_FLEET=

# Optional phase-2
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
SENTRY_DSN=
```

---

## 3. Brand & Design System

- **Primary:** Deep navy `#0B1E3F`
- **Accent:** Safety orange `#FF6B35`
- **Risk colors:** green `#16A34A` (low), amber `#F59E0B` (medium), red `#DC2626` (high)
- **Neutrals:** slate palette from Tailwind
- **Typography:** Inter (fallback to system sans)
- **Feel:** Looks like a financial tool, not a trucking app. Think Stripe meets Carfax. Generous whitespace, subtle shadows, 8px rounded corners, no stock truck imagery.
- **Dark mode:** Not required for MVP.

---

## 4. Database Schema

All tables live in the Supabase `public` schema. Enable row-level security on every table.

### `profiles`
Extends `auth.users`.
```sql
id uuid primary key references auth.users(id) on delete cascade,
email text not null,
full_name text,
company_name text,
mc_number text,        -- the user's own MC if they have one
dot_number text,
fleet_size int,
role text,             -- owner, dispatcher, broker, driver
plan_tier text default 'free', -- free | carrier | fleet
stripe_customer_id text,
created_at timestamptz default now(),
updated_at timestamptz default now()
```

### `lookups`
Every time a user runs a broker verification.
```sql
id uuid primary key default gen_random_uuid(),
user_id uuid references profiles(id) on delete cascade,
searched_mc text,
searched_dot text,
searched_name text,
risk_score int,        -- 0-100
report_data jsonb,     -- full cached report
source text,           -- 'manual' | 'rate_con' | 'bulk' | 'api'
created_at timestamptz default now()
```
Index on `user_id`, `searched_mc`, `searched_dot`.

### `fraud_reports`
Community-submitted scam reports.
```sql
id uuid primary key default gen_random_uuid(),
reporter_user_id uuid references profiles(id) on delete set null,
broker_mc text,
broker_dot text,
broker_name text,
scam_type text,        -- double_brokering | non_payment | identity_fraud | fake_load | other
description text,
amount_lost numeric,
evidence_url text,
status text default 'pending', -- pending | verified | rejected
upvotes int default 0,
created_at timestamptz default now()
```

### `watchlist`
```sql
id uuid primary key default gen_random_uuid(),
user_id uuid references profiles(id) on delete cascade,
broker_mc text,
broker_name text,
notes text,
added_at timestamptz default now(),
unique(user_id, broker_mc)
```

### `alerts`
```sql
id uuid primary key default gen_random_uuid(),
user_id uuid references profiles(id) on delete cascade,
broker_mc text,
alert_type text,       -- status_change | new_fraud_report | authority_revoked
message text,
is_read boolean default false,
created_at timestamptz default now()
```

### `subscriptions`
```sql
id uuid primary key default gen_random_uuid(),
user_id uuid references profiles(id) on delete cascade,
stripe_customer_id text,
stripe_subscription_id text,
plan_tier text,
status text,           -- active | past_due | canceled | trialing
current_period_end timestamptz,
created_at timestamptz default now()
```

### `fmcsa_cache`
To avoid hammering the FMCSA API.
```sql
id uuid primary key default gen_random_uuid(),
mc_number text,
dot_number text,
snapshot jsonb,
fetched_at timestamptz default now(),
unique(mc_number),
unique(dot_number)
```
Cache TTL: 24 hours.

### `ip_free_lookups`
For rate-limiting anonymous homepage lookups.
```sql
id uuid primary key default gen_random_uuid(),
ip_hash text not null,
lookup_date date not null,
count int default 1,
unique(ip_hash, lookup_date)
```

### Row-level security quick rules
- `profiles`: user can select/update their own row.
- `lookups`, `watchlist`, `alerts`, `subscriptions`: user_id = auth.uid().
- `fraud_reports`: SELECT public for all authenticated users; INSERT if authenticated; UPDATE only by admins (use a `service_role` flag or a separate `admins` table).
- `fmcsa_cache`: read-only for clients, writes only from server.

---

## 5. App Structure (Next.js App Router)

```
app/
  layout.tsx
  page.tsx                          # Landing page
  verify/page.tsx                   # Public free lookup tool
  (auth)/
    login/page.tsx
    signup/page.tsx
    onboarding/page.tsx
  (dashboard)/
    layout.tsx                      # Sidebar + topbar, auth-gated
    dashboard/page.tsx              # Home / overview
    dashboard/verify/page.tsx       # Main lookup tool (tabs)
    dashboard/report/[id]/page.tsx  # Full risk report
    dashboard/reports/page.tsx      # Community fraud feed
    dashboard/alerts/page.tsx
    dashboard/watchlist/page.tsx
    dashboard/settings/page.tsx
  api/
    verify/route.ts                 # POST: run a lookup
    rate-con/route.ts               # POST: parse uploaded rate con
    fraud-reports/route.ts          # GET/POST
    watchlist/route.ts
    webhooks/stripe/route.ts
    checkout/route.ts               # Create Stripe checkout session
    portal/route.ts                 # Stripe billing portal redirect

lib/
  supabase/
    client.ts
    server.ts
    admin.ts
  fmcsa.ts                          # FMCSA API wrapper
  scoring.ts                        # Risk scoring engine
  rate-con-parser.ts                # OCR stub
  stripe.ts

components/
  ui/                               # shadcn/ui components
  marketing/                        # hero, pricing, faq
  dashboard/                        # sidebar, stats, feeds
  report/                           # risk gauge, timeline, flags list
  forms/

types/
  index.ts                          # shared types

supabase/
  migrations/                       # SQL migration files
  seed.sql                          # Demo fraud reports
```

---

## 6. Pages & Features — Full Spec

### 6.1 Landing page (`/`)
- Hero with tagline, primary CTA "Check a broker free," secondary CTA "See pricing"
- 3-column feature grid: Instant Broker Verification / Rate Con Analysis / Fraud Alert Network
- Live preview of a sample risk report (animated or static screenshot)
- "How it works" 3-step section
- Pricing preview (3 cards)
- FAQ accordion
- Footer: links, legal, social

### 6.2 Free public lookup (`/verify`)
- Single input field: accepts MC, DOT, or company name (auto-detect)
- Anonymous users limited to 3 lookups per IP per day (hash IP, store in `ip_free_lookups`)
- Returns a limited risk card: score, authority status, age, top 2 flags
- Locks full detail behind "Sign up free to see the full report"

### 6.3 Signup / login / onboarding
- Supabase Auth: email+password and Google OAuth
- After signup, onboarding form collects: company name, MC number (optional), fleet size, role
- Redirect to `/dashboard` on completion

### 6.4 Dashboard home (`/dashboard`)
Widgets:
- Quick lookup bar at top (Cmd+K shortcut)
- Usage card: lookups this month / plan limit
- Recent lookups (last 10)
- Active alerts (unread)
- Recently reported scams feed (last 5 community reports)
- Upgrade CTA if on free tier

### 6.5 Verify tool (`/dashboard/verify`)
Three tabs:
1. **Quick lookup** — MC/DOT/name input → full risk report
2. **Rate con analyzer** — drag-and-drop PDF/image upload → extracted fields + risk score
3. **Bulk verify** — CSV upload (Fleet tier only), returns results table

### 6.6 Risk report page (`/dashboard/report/[id]`)
This is the marquee page. Layout top to bottom:
- **Header:** broker name, MC, DOT, "Share" and "Export PDF" buttons
- **Risk gauge:** big 0–100 semi-circle gauge, color-coded
- **Recommended action banner:** plain-English verdict ("Proceed with caution — require payment upfront")
- **Identity panel:** legal name, DBA, physical address, phone, email (if available), authority type
- **Authority timeline:** visual timeline of authority status changes and age
- **Insurance panel:** current policy, history of cancellations/replacements
- **Red flags list:** each flag is a card with icon, severity, plain-English description
- **Community reports:** "3 carriers reported this broker" with excerpts
- **Safety record:** safety rating, out-of-service status, inspection summary
- **Raw FMCSA data:** collapsible JSON for power users

### 6.7 Fraud reports feed (`/dashboard/reports`)
- Filterable table/feed: date, broker name/MC, state, scam type
- Each card: reporter (anonymized), scam type, amount lost, description excerpt, upvotes
- "Submit a report" button → modal with form

### 6.8 Watchlist (`/dashboard/watchlist`)
- List of tracked brokers
- Status column, last-checked column
- Quick-remove action
- "Add broker" input

### 6.9 Alerts (`/dashboard/alerts`)
- Chronological list of alerts, filter by read/unread
- Click alert → navigate to relevant report

### 6.10 Pricing (`/pricing`)
Three tiers as defined in section 1.

### 6.11 Settings (`/dashboard/settings`)
Tabs: Profile / Team / Billing / API keys / Notifications

---

## 7. Core Risk-Scoring Engine (`lib/scoring.ts`)

Implement as a pure function that takes FMCSA data + community data and returns a score.

```ts
export type RiskInput = {
  fmcsa: {
    authorityStatus: 'active' | 'inactive' | 'pending' | 'revoked';
    authorityGrantedAt: Date | null;
    authorityReactivatedAt: Date | null;   // most recent reactivation
    insuranceOnFile: boolean;
    insuranceCancellations12mo: number;
    nameChanges12mo: number;
    addressChanges90d: number;
    outOfService: boolean;
    safetyRating: 'satisfactory' | 'conditional' | 'unsatisfactory' | 'none';
    entityExists: boolean;
  };
  community: {
    verifiedFraudReports: number;
    totalLookups: number;
    complaintCount: number;
  };
};

export type RiskResult = {
  score: number;           // 0-100, higher = riskier
  verdict: 'low' | 'medium' | 'high';
  flags: RiskFlag[];
  recommendation: string;
};

export type RiskFlag = {
  severity: 'info' | 'warning' | 'critical';
  code: string;
  title: string;
  description: string;
  points: number;
};
```

### Scoring rules (starting weights — tune later with real data)

**Add points (increase risk):**
| Condition | Points |
|---|---|
| Entity does not exist in FMCSA | 100 (cap, short-circuit) |
| Out-of-service flag set | 50 |
| Authority reactivated in last 30 days | 30 |
| Authority age < 6 months | 25 |
| Insurance not on file | 20 |
| Insurance cancelled within last 30 days | 20 |
| Each name change in past 12 months | 15 |
| Each verified community fraud report | 15 |
| Address changed in past 90 days | 10 |
| Unsatisfactory safety rating | 25 |
| Conditional safety rating | 10 |

**Subtract points (decrease risk):**
| Condition | Points |
|---|---|
| Authority age > 5 years | -10 |
| Satisfactory safety rating | -5 |
| 100+ lookups with zero complaints | -5 |

**Final steps:**
1. Clamp between 0 and 100.
2. Verdict: 0–30 low (green), 31–60 medium (amber), 61–100 high (red).
3. Recommendation text mapped from verdict + top flags.

Write unit tests for scoring covering: perfect broker, nonexistent MC, freshly reactivated authority, multiple name changes, out-of-service. Use Vitest.

---

## 8. FMCSA Integration (`lib/fmcsa.ts`)

### Strategy
- **Phase 1 (MVP):** hit FMCSA QCMobile API directly with the WebKey. Cache every response in `fmcsa_cache` for 24 hours.
- **Phase 2:** download FMCSA bulk data files nightly and store in Postgres for historical analysis (authority age, insurance history, name changes). Switch scoring engine to read from your own DB.

### Phase 1 functions
```ts
getCarrierByDOT(dot: string): Promise<FmcsaSnapshot>
getCarrierByMC(mc: string): Promise<FmcsaSnapshot>
searchByName(name: string): Promise<FmcsaSnapshot[]>
getSafetyRating(dot: string): Promise<SafetyRating>
```

All functions:
1. Check cache first.
2. If miss or stale, fetch from FMCSA.
3. Normalize response to internal `FmcsaSnapshot` type.
4. Write to cache.
5. Return.

Handle FMCSA downtime gracefully: return stale cached data with a `stale: true` flag so UI can show a warning.

### Phase 2: bulk data ingestion
Set up a nightly cron (Vercel Cron or Supabase scheduled function) that:
1. Downloads the FMCSA "Carrier - All With History" file.
2. Downloads the "InsHist - All With History" file.
3. Upserts into local Postgres tables (`fmcsa_carriers`, `fmcsa_insurance_history`).
4. Recomputes cached risk fields.

This is what makes your product hard to copy — competitors hitting the API one-at-a-time can't match your historical signals.

---

## 9. Rate Con Analyzer (`lib/rate-con-parser.ts`)

### MVP stub
```ts
export async function extractRateConData(file: File): Promise<RateConData> {
  // TODO: replace with real OCR
  return {
    broker_name: 'EXAMPLE FREIGHT LLC',
    broker_mc: '123456',
    broker_email: 'dispatch@example.com',
    pickup: { city: 'Dallas', state: 'TX', date: '2026-05-01' },
    delivery: { city: 'Atlanta', state: 'GA', date: '2026-05-03' },
    rate: 2400,
    raw_text: '',
  };
}
```

### Phase 2 real implementation
Pipeline:
1. Upload file to Supabase Storage.
2. If PDF, render pages to images with `pdf-lib` or `pdf2pic`.
3. Send image(s) to GPT-4 Vision or Claude with a structured extraction prompt.
4. Parse JSON response.
5. Run extracted broker info through `getCarrierByMC`.
6. Run through scoring engine.
7. Add rate-con-specific flags:
   - Email domain ≠ broker's historical domain
   - MC on document doesn't match sender domain
   - Rate > 2x market average for lane (phase 3, needs DAT data)
   - Broker letterhead differs from on-file address

---

## 10. Stripe Integration

### Products & prices (create in Stripe dashboard)
- **Carrier plan:** $49/mo recurring, get price ID, put in env
- **Fleet plan:** $149/mo recurring, get price ID, put in env

### Checkout flow
1. User clicks "Upgrade" → POST `/api/checkout` with `plan_tier`
2. Server creates Stripe Checkout Session, returns URL
3. User redirected to Stripe, pays, returns to `/dashboard?upgraded=1`

### Webhook (`/api/webhooks/stripe`)
Handle these events:
- `checkout.session.completed` — create/update `subscriptions` row, update `profiles.plan_tier`
- `customer.subscription.updated` — update row
- `customer.subscription.deleted` — set status, downgrade `plan_tier` to free
- `invoice.payment_failed` — flag `status = past_due`

Verify webhook signature with `STRIPE_WEBHOOK_SECRET`.

### Plan gating
Central helper:
```ts
canUseFeature(user, feature): boolean
```
Features: `unlimited_lookups`, `rate_con_analyzer`, `bulk_verify`, `api_access`, `watchlist_alerts`.

---

## 11. Seed Data

Before launch, seed `fraud_reports` with ~20 realistic-looking reports using fake broker names across a mix of scam types. This prevents the community feed from looking empty on day one.

Script: `supabase/seed.sql` — run after migrations.

---

## 12. Build Roadmap (Phased)

### Phase 0 — Bolt.new MVP (days 1–3)
Use the Bolt prompt (separate doc) to generate:
- Landing page
- Auth pages
- Dashboard shell
- Verify page with mock data
- Pricing page
Deploy to Vercel, take screenshots, show to 5 truckers for feedback.

### Phase 1 — Real backend (week 1–2)
Tasks in order:
1. [ ] Set up Supabase project, run migrations, enable RLS
2. [ ] Wire up real Supabase Auth (replace Bolt mocks)
3. [ ] Apply for FMCSA WebKey (do this day one, approval takes time)
4. [ ] Build `lib/fmcsa.ts` with caching
5. [ ] Build `lib/scoring.ts` with unit tests
6. [ ] Replace mock verify endpoint with real FMCSA-powered version
7. [ ] Full risk report page with real data
8. [ ] Stripe integration end-to-end
9. [ ] Fraud reports submission + feed (live data)
10. [ ] Watchlist
11. [ ] Seed data
12. [ ] Deploy to production

### Phase 2 — Moat building (week 3–4)
1. [ ] FMCSA bulk data ingestion pipeline
2. [ ] Historical signals in scoring (name changes, insurance churn, address history)
3. [ ] Real rate-con OCR with GPT-4 Vision or Claude
4. [ ] Email/SMS alerts (Resend + Twilio)
5. [ ] PDF export of risk reports
6. [ ] Admin dashboard to verify fraud reports
7. [ ] API access for Fleet tier

### Phase 3 — Growth (month 2+)
1. [ ] Bulk verify (CSV upload)
2. [ ] Browser extension that scans rate cons in Gmail
3. [ ] Integrations with existing TMS systems (this is where your background wins)
4. [ ] Lane rate intelligence (requires DAT or Truckstop data partnership)
5. [ ] Mobile app (React Native)

---

## 13. Go-to-Market Notes

- **Primary channel:** Facebook groups for owner-operators and small carriers. These are where scam rate cons are posted daily — meet users where the pain lives.
- **Secondary:** TikTok and YouTube trucking creators. A $500 sponsorship on a channel with 50k trucker viewers can be high-signal.
- **Content moat:** Publish weekly "Top 10 most-reported scam brokers this week" on the blog. SEO gold, trust-building, and viral in trucking groups.
- **Pricing psychology:** $49/mo is less than a single load lost to fraud. Lead with "one prevented scam pays for 3 years of FreightGuard."
- **Existing TMS relationships:** the user built 4 custom TMS systems. Offer FreightGuard as a white-label add-on to those TMS customers first. Warm leads beat cold acquisition every time.

---

## 14. Legal / Compliance Notes (Not legal advice — consult a lawyer)

- FMCSA data is public and explicitly licensed for public use. Safe to use.
- Community fraud reports are user-generated content. Terms of Service must include: good-faith requirement, no defamation, right to remove.
- Consider Section 230 protection language in ToS.
- A "verified" fraud report should require evidence (BOL, rate con, bank statement) and admin review before being labeled verified — otherwise you risk defamation exposure.
- Privacy policy must cover: IP hashing for anonymous lookups, data retention, Stripe data processing.
- Recommended: LLC formation before launch.

---

## 15. How to Use This Document with Claude Code / AI Coding Tools

When working in VS Code:
1. Keep this file at repo root as `PROJECT_PLAN.md`.
2. When asking the AI to build a feature, point it at the relevant section: "Implement section 7, the scoring engine, with tests."
3. After each phase, update the roadmap checkboxes so the AI knows what's done.
4. Add a `DECISIONS.md` alongside this plan to log architectural decisions as they come up — the AI will read both and stay consistent.
5. If the AI is about to make a choice that contradicts this plan, push back and tell it to follow the plan or propose an update to the plan.

---

## 16. Open Questions (Decide Before Launch)

- [ ] Exact MC-number-age cutoff for "new" (6 months? 12?)
- [ ] Do free-tier users get community feed access or is it paid-only?
- [ ] Watchlist cap on Carrier tier (25 brokers?)
- [ ] API rate limit on Fleet tier (1000/day?)
- [ ] Trial period (14-day free trial of Carrier?)
- [ ] Annual pricing discount (2 months free?)
- [ ] Refund policy (7-day full refund?)
