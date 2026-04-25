-- Haulock schema. Run once in Supabase SQL editor.

create table if not exists public.lookups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  name text,
  mc text,
  dot text,
  score int not null default 0,
  verdict text,
  email_query text,
  source text not null default 'quick',
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.lookups add column if not exists source text not null default 'quick';
alter table public.lookups add column if not exists hidden_at timestamptz;

-- Global FMCSA response cache — shared across every user so repeated lookups
-- of the same MC/DOT don't burn FMCSA API quota. Populated by the server.
create table if not exists public.fmcsa_cache (
  cache_key text primary key,
  response jsonb not null,
  cached_at timestamptz not null default now()
);
create index if not exists fmcsa_cache_cached_at_idx on public.fmcsa_cache(cached_at);
alter table public.fmcsa_cache enable row level security;
-- Only the service role writes to this table; no user-facing policies needed.

-- Append-only identity / carrier-state HISTORY. Every successful lookup
-- writes a row HERE if (and only if) the meaningful fields changed since
-- the last row for the same DOT/MC. Over time this becomes a queryable
-- timeline of address changes, authority changes, insurance changes, etc.
-- — the same data BrokerSnapshot sells for $200/mo, generated for free
-- as a side-effect of normal usage.
create table if not exists public.carrier_snapshots (
  id uuid primary key default gen_random_uuid(),
  dot text,
  mc text,
  name text,
  -- Hash of the meaningful fields. Used as a cheap "did anything change?"
  -- check before an insert so we never duplicate a snapshot.
  fingerprint text not null,
  -- The meaningful fields themselves, JSON-serialized. Smaller than the
  -- full FMCSA response and faster to diff.
  data jsonb not null,
  -- Field names that changed vs the previous snapshot for this carrier.
  -- ['initial'] for the first row. Lets us render a clean diff timeline
  -- without reading every prior row.
  changed_fields text[] not null default array[]::text[],
  -- Where the snapshot came from: 'lookup' (real-time user search) or
  -- 'bulk' (nightly FMCSA CSV import — added later).
  source text not null default 'lookup',
  captured_at timestamptz not null default now()
);
create index if not exists carrier_snapshots_dot_captured_idx on public.carrier_snapshots (dot, captured_at desc);
create index if not exists carrier_snapshots_mc_captured_idx  on public.carrier_snapshots (mc, captured_at desc);
alter table public.carrier_snapshots enable row level security;
-- Reads happen through the service role (via /api/carrier-history). No user-facing policies.

-- Third-party historical risk ratings imported from a partner data dump.
-- Stored separately from our own scoring so we never confuse the two; we
-- just surface "rated X in 2021" as a reference signal on the report.
-- Source is intentionally generic (no partner attribution stored) — the
-- public surface is "third-party brokerage rating, 2021".
create table if not exists public.legacy_risk_ratings (
  id uuid primary key default gen_random_uuid(),
  mc text,
  dot text,
  name text,
  risk_overall text,             -- 'Acceptable' | 'Moderate' | 'Unacceptable' | other
  trucks_total int,
  captured_at date not null,
  source text not null default 'partner-2021',
  created_at timestamptz not null default now()
);
create index if not exists legacy_risk_ratings_mc_idx  on public.legacy_risk_ratings(mc)  where mc  is not null;
create index if not exists legacy_risk_ratings_dot_idx on public.legacy_risk_ratings(dot) where dot is not null;
alter table public.legacy_risk_ratings enable row level security;
-- Service role only.

-- Storage-usage RPC for the admin "Storage" panel. Returns the database
-- size + a per-table breakdown so the operator can see when we're getting
-- close to a Supabase plan limit (free=500MB, Pro=8GB) and which tables
-- are eating the most space. Service-role only.
create or replace function public.haulock_storage_stats()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'fetched_at', now(),
    'tables', coalesce((
      select jsonb_agg(t order by t.total_bytes desc)
      from (
        select
          c.relname                     as name,
          pg_total_relation_size(c.oid) as total_bytes,
          pg_relation_size(c.oid)       as data_bytes,
          pg_indexes_size(c.oid)        as index_bytes,
          coalesce(s.n_live_tup, 0)     as row_estimate
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_stat_user_tables s
          on s.schemaname = n.nspname and s.relname = c.relname
        where n.nspname = 'public'
          and c.relkind = 'r'
      ) t
    ), '[]'::jsonb)
  );
$$;
revoke execute on function public.haulock_storage_stats() from public;
grant execute on function public.haulock_storage_stats() to service_role;

-- Per-call FMCSA observability log. One row per outgoing call to FMCSA
-- (not per user request — cache hits don't log here).
create table if not exists public.fmcsa_events (
  id bigserial primary key,
  path text,
  status text not null,        -- 'ok' | 'error'
  http_status int,
  duration_ms int,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists fmcsa_events_created_idx on public.fmcsa_events(created_at desc);
alter table public.fmcsa_events enable row level security;
-- Service-role only.

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'API key',
  prefix text not null,
  key_hash text not null unique,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists api_keys_user_idx on public.api_keys(user_id, created_at desc);
create index if not exists api_keys_hash_idx on public.api_keys(key_hash) where revoked_at is null;
alter table public.api_keys enable row level security;
drop policy if exists "api_keys_select_own" on public.api_keys;
drop policy if exists "api_keys_insert_own" on public.api_keys;
drop policy if exists "api_keys_update_own" on public.api_keys;
drop policy if exists "api_keys_delete_own" on public.api_keys;
create policy "api_keys_select_own" on public.api_keys for select using (auth.uid() = user_id);
create policy "api_keys_insert_own" on public.api_keys for insert with check (auth.uid() = user_id);
create policy "api_keys_update_own" on public.api_keys for update using (auth.uid() = user_id);
create policy "api_keys_delete_own" on public.api_keys for delete using (auth.uid() = user_id);

create index if not exists lookups_user_created_idx on public.lookups(user_id, created_at desc);
create index if not exists lookups_user_verdict_idx on public.lookups(user_id, verdict, created_at desc);

alter table public.lookups enable row level security;

drop policy if exists "lookups_select_own" on public.lookups;
drop policy if exists "lookups_insert_own" on public.lookups;
drop policy if exists "lookups_update_own" on public.lookups;
drop policy if exists "lookups_delete_own" on public.lookups;
create policy "lookups_select_own" on public.lookups for select using (auth.uid() = user_id);
create policy "lookups_insert_own" on public.lookups for insert with check (auth.uid() = user_id);
create policy "lookups_update_own" on public.lookups for update using (auth.uid() = user_id);
create policy "lookups_delete_own" on public.lookups for delete using (auth.uid() = user_id);

create table if not exists public.watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mc text,
  dot text,
  name text not null,
  last_score int,
  last_verdict text,
  last_checked timestamptz default now(),
  data jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists watchlist_unique_broker_idx
  on public.watchlist(user_id, coalesce(mc, ''), coalesce(dot, ''));
create index if not exists watchlist_user_created_idx on public.watchlist(user_id, created_at desc);

alter table public.watchlist enable row level security;

drop policy if exists "watchlist_select_own" on public.watchlist;
drop policy if exists "watchlist_insert_own" on public.watchlist;
drop policy if exists "watchlist_update_own" on public.watchlist;
drop policy if exists "watchlist_delete_own" on public.watchlist;
create policy "watchlist_select_own" on public.watchlist for select using (auth.uid() = user_id);
create policy "watchlist_insert_own" on public.watchlist for insert with check (auth.uid() = user_id);
create policy "watchlist_update_own" on public.watchlist for update using (auth.uid() = user_id);
create policy "watchlist_delete_own" on public.watchlist for delete using (auth.uid() = user_id);

-- Community fraud reports — visible to all authenticated users.
create table if not exists public.fraud_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  mc text,
  dot text,
  name text not null,
  type text not null default 'other',
  amount numeric,
  description text,
  created_at timestamptz not null default now()
);

create index if not exists fraud_reports_mc_idx on public.fraud_reports(mc, created_at desc);
create index if not exists fraud_reports_dot_idx on public.fraud_reports(dot, created_at desc);
create index if not exists fraud_reports_recent_idx on public.fraud_reports(created_at desc);

alter table public.fraud_reports enable row level security;

drop policy if exists "fraud_reports_select_authed" on public.fraud_reports;
drop policy if exists "fraud_reports_insert_own" on public.fraud_reports;
drop policy if exists "fraud_reports_delete_own" on public.fraud_reports;
create policy "fraud_reports_select_authed" on public.fraud_reports for select using (auth.uid() is not null);
create policy "fraud_reports_insert_own" on public.fraud_reports for insert with check (auth.uid() = reporter_user_id);
create policy "fraud_reports_delete_own" on public.fraud_reports for delete using (auth.uid() = reporter_user_id);

-- Admins — email-based allow list. Managed server-side only via service role.
create table if not exists public.admins (
  email text primary key,
  created_at timestamptz not null default now(),
  added_by uuid references auth.users(id)
);

alter table public.admins enable row level security;
-- Note: no policies — only service_role key can read/write. Client cannot query this table at all.

-- Seed yourself as the first admin (safe to re-run; does nothing if already present).
insert into public.admins (email) values ('aleksa@viceseo.com')
on conflict (email) do nothing;

-- Teams: one team owns a subscription. Members share the team's plan limits.
-- Step A: create all 3 tables first (so policies can reference them).
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text,
  plan text not null default 'free',
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  email text not null,
  token text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending',
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now()
);

-- Step B: indexes
create index if not exists teams_owner_idx on public.teams(owner_user_id);
create unique index if not exists team_members_user_unique_idx on public.team_members(user_id);
create unique index if not exists team_invites_pending_unique
  on public.team_invites(team_id, lower(email)) where status = 'pending';
create index if not exists team_invites_email_idx on public.team_invites(lower(email)) where status = 'pending';
create index if not exists team_invites_token_idx on public.team_invites(token);

-- Step C: enable RLS
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invites enable row level security;

-- Step D: policies (now safe — all tables exist)
drop policy if exists "teams_select_member" on public.teams;
create policy "teams_select_member" on public.teams for select using (
  owner_user_id = auth.uid()
  or exists (select 1 from public.team_members tm where tm.team_id = id and tm.user_id = auth.uid())
);

drop policy if exists "team_members_select_in_team" on public.team_members;
create policy "team_members_select_in_team" on public.team_members for select using (
  user_id = auth.uid()
  or team_id in (select team_id from public.team_members where user_id = auth.uid())
);

drop policy if exists "team_invites_select_in_team" on public.team_invites;
create policy "team_invites_select_in_team" on public.team_invites for select using (
  team_id in (select team_id from public.team_members where user_id = auth.uid())
);
-- Inserts/updates/deletes for all three tables go through service role (server only).

-- Append-only log of every transactional/newsletter email sent. Powers
-- the admin Newsletter tab: per-contact send count + send history. Service
-- role only (RLS enabled with no user policies).
create table if not exists public.email_log (
  id bigserial primary key,
  to_email text not null,
  subject text,
  kind text,
  resend_id text,
  sent_at timestamptz not null default now()
);
create index if not exists email_log_to_email_idx on public.email_log(lower(to_email));
create index if not exists email_log_sent_at_idx on public.email_log(sent_at desc);
alter table public.email_log enable row level security;

-- Support tickets. Users open tickets, see their own conversation thread,
-- and admins reply + change status. Service role handles admin reads/writes;
-- user-side reads are scoped via RLS.
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  status text not null default 'open',  -- 'open' | 'working' | 'solved'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_tickets_user_idx on public.support_tickets(user_id, created_at desc);
create index if not exists support_tickets_status_idx on public.support_tickets(status, updated_at desc);
alter table public.support_tickets enable row level security;
drop policy if exists "support_tickets_select_own" on public.support_tickets;
drop policy if exists "support_tickets_insert_own" on public.support_tickets;
create policy "support_tickets_select_own" on public.support_tickets for select using (auth.uid() = user_id);
create policy "support_tickets_insert_own" on public.support_tickets for insert with check (auth.uid() = user_id);
-- Updates (status changes) go through service role. No user-side update policy.

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_admin boolean not null default false,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists support_messages_ticket_idx on public.support_messages(ticket_id, created_at);
alter table public.support_messages enable row level security;
drop policy if exists "support_messages_select_own_ticket" on public.support_messages;
drop policy if exists "support_messages_insert_own_ticket" on public.support_messages;
create policy "support_messages_select_own_ticket" on public.support_messages for select using (
  exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = auth.uid())
);
create policy "support_messages_insert_own_ticket" on public.support_messages for insert with check (
  user_id = auth.uid()
  and is_admin = false
  and exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = auth.uid())
);
-- Admin replies go through service role.
