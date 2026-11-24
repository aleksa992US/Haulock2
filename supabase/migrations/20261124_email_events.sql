-- Delivery and engagement for every logged email, filled in by Resend's
-- webhook (/api/resend/events). First time each thing happened, plus open
-- and click counts. Powers the admin Email stats tab.
alter table public.email_log
  add column if not exists delivered_at timestamptz,
  add column if not exists opened_at timestamptz,
  add column if not exists clicked_at timestamptz,
  add column if not exists bounced_at timestamptz,
  add column if not exists complained_at timestamptz,
  add column if not exists open_count integer not null default 0,
  add column if not exists click_count integer not null default 0;

create index if not exists email_log_resend_id_idx on public.email_log(resend_id);
create index if not exists email_log_kind_sent_at_idx on public.email_log(kind, sent_at desc);
