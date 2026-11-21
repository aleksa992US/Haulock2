-- Driver-filed reports: proof the driver drove for the company, and the
-- option to withhold the driver's name from the public report. The identity
-- stays verified and stored; only the public display changes.
alter table public.company_reports
  add column if not exists reporter_anonymous boolean not null default false,
  add column if not exists proof jsonb not null default '[]'::jsonb;

comment on column public.company_reports.reporter_anonymous is
  'Driver chose to withhold their name from the public report (shown as "Verified driver"). Identity is still verified and stored.';
comment on column public.company_reports.proof is
  'Documents proving the reporter drove for / dealt with the company: [{path,name,type,size}] in the private report-evidence bucket. Required for drivers.';
