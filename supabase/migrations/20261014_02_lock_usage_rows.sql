-- Step 2 of 3 — safe to run any time, including before the deploy: the code
-- running today never deletes usage rows as the user, and only updates the
-- columns still granted below.
--
-- Monthly limits count `lookups` rows by source + created_at. Users could
-- delete those rows, or rewrite those columns, straight from the browser
-- with the public anon key — resetting their own limits.
drop policy if exists "lookups_delete_own" on public.lookups;
revoke update on public.lookups from anon, authenticated;
grant update (name, mc, dot, score, verdict, data, hidden_at) on public.lookups to authenticated;

-- Community fraud reports are retired (the API returns 410) and nothing in
-- the app reads or writes them as a user; the policies still exposed every
-- report, including reporter ids, to any signed-in user.
drop policy if exists "fraud_reports_select_authed" on public.fraud_reports;
drop policy if exists "fraud_reports_insert_own" on public.fraud_reports;
drop policy if exists "fraud_reports_delete_own" on public.fraud_reports;
