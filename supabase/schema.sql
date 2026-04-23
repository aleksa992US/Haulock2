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
