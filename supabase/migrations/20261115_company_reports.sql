-- Verified reports: carriers report brokers, brokers report carriers, drivers
-- report the companies they hauled for, and shippers report and can be
-- reported. Only new tables and one private storage bucket; nothing existing
-- changes. Safe to re-run.
--
-- All three tables are server-only: RLS on with no policies, so only the
-- service role (the /api/reports routes) can read or write them.

create table if not exists public.company_reports (
  id uuid primary key default gen_random_uuid(),

  -- Who reported. The row outlives the account: reports stay on record.
  reporter_user_id uuid references auth.users(id) on delete set null,
  reporter_role text not null check (reporter_role in ('carrier', 'broker', 'driver', 'shipper')),
  reporter_name text not null,           -- shown publicly: company name, or the driver's verified name
  reporter_mc text,
  reporter_dot text,
  -- One reporter counts once per company in the score, however many loads
  -- they report: 'dot:123', 'driver:<user id>', 'shipper:<domain>'.
  reporter_key text not null,
  reporter_verified_by text not null,    -- email | domain | code | identity | work_email

  -- Who it's about. Carriers and brokers by USDOT/MC; shippers by name + state.
  subject_type text not null check (subject_type in ('carrier', 'broker', 'shipper')),
  subject_mc text,
  subject_dot text,
  subject_name text not null,
  subject_city text,
  subject_state text,
  subject_key text not null,             -- 'dot:123' | 'mc:123' | 'shipper:<name>|<state>'

  -- What happened: a fixed category, one load, facts.
  category text not null,
  load_ref text not null,
  incident_date date not null,
  amount numeric,
  description text not null,
  -- [{ path, name, type, size }] in the private "report-evidence" bucket.
  evidence jsonb not null default '[]'::jsonb,

  -- The reporter's signed statement that the report is true.
  attested_at timestamptz not null,
  attested_ip text,

  -- pending → published | rejected; the reporter can withdraw at any time.
  status text not null default 'pending' check (status in ('pending', 'published', 'rejected', 'withdrawn')),
  reviewed_by text,
  reviewed_at timestamptz,
  reject_reason text,
  published_at timestamptz,
  resolved_at timestamptz,               -- the reporter marked it resolved (e.g. paid)
  created_at timestamptz not null default now()
);

-- One report per reporter, per company, per load.
create unique index if not exists company_reports_one_per_load_idx
  on public.company_reports (reporter_key, subject_key, lower(load_ref))
  where status in ('pending', 'published');
create index if not exists company_reports_subject_key_idx on public.company_reports (subject_key, status, published_at desc);
create index if not exists company_reports_subject_dot_idx on public.company_reports (subject_dot) where subject_dot is not null;
create index if not exists company_reports_subject_mc_idx on public.company_reports (subject_mc) where subject_mc is not null;
create index if not exists company_reports_status_idx on public.company_reports (status, created_at desc);
create index if not exists company_reports_reporter_idx on public.company_reports (reporter_user_id, created_at desc);

alter table public.company_reports enable row level security;

-- The reported company's public reply. One per report; it can be edited.
create table if not exists public.company_report_responses (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references public.company_reports(id) on delete cascade,
  responder_user_id uuid references auth.users(id) on delete set null,
  responder_name text not null,
  body text not null,
  disputes boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.company_report_responses enable row level security;

-- Who did what to a report, and when: submitted, published, rejected,
-- unpublished, withdrawn, resolved, responded.
create table if not exists public.company_report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.company_reports(id) on delete cascade,
  actor text,                            -- email of the user or admin
  action text not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists company_report_events_report_idx on public.company_report_events (report_id, created_at);

alter table public.company_report_events enable row level security;

-- Supporting documents (rate cons, BOLs, settlements). Private: only admins
-- see them, through short-lived signed links.
insert into storage.buckets (id, name, public)
values ('report-evidence', 'report-evidence', false)
on conflict (id) do nothing;
