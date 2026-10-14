-- Step 1 of 3 — run BEFORE deploying fix/security-and-bugs.
--
-- The app used to enforce the plan stored in user_metadata, which users can
-- edit from the browser. The new code enforces app_metadata.plan, which only
-- the server can write. This copies every account's CURRENT plan (and the
-- affiliate settings) into app_metadata, so nobody gains or loses access when
-- the new code goes live. It changes nothing for the code running today.
--
-- Safe to re-run: rows that already have the value are skipped.

-- 1) Plan: copy each account's current plan into app_metadata.plan.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('plan',
       case when raw_user_meta_data->>'plan' in ('free', 'carrier', 'team', 'fleet')
            then raw_user_meta_data->>'plan' else 'free' end)
where raw_app_meta_data->>'plan' is null;

-- 2) Affiliates: copy role, promo code and commission into app_metadata.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
  'role', raw_user_meta_data->'role',
  'affiliate_code', raw_user_meta_data->'affiliate_code',
  'affiliate_commission_mode', raw_user_meta_data->'affiliate_commission_mode',
  'affiliate_commission_type', raw_user_meta_data->'affiliate_commission_type',
  'affiliate_commission_value', raw_user_meta_data->'affiliate_commission_value',
  'affiliate_commission_by_plan', raw_user_meta_data->'affiliate_commission_by_plan',
  'affiliate_assigned_at', raw_user_meta_data->'affiliate_assigned_at'
))
where raw_user_meta_data->>'role' = 'affiliate'
  and raw_app_meta_data->>'role' is null;

-- 3) Paid plans with no Stripe customer were granted by hand. Keep them as
--    comps: manual_plan marks the plan as granted, so the admin Users tab
--    doesn't flag it as unpaid and billing sync leaves it alone. List the
--    accounts by email (kept out of the repo):
--
--      update auth.users
--      set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('manual_plan', raw_app_meta_data->>'plan')
--      where email in ('...')
--        and raw_app_meta_data->>'plan' in ('carrier', 'team', 'fleet');

-- Check: every account should now have app_metadata.plan.
select
  count(*) as users,
  count(*) filter (where raw_app_meta_data->>'plan' is null) as missing_plan,
  count(*) filter (where raw_app_meta_data->>'plan' in ('carrier', 'team', 'fleet')) as paid,
  count(*) filter (where raw_app_meta_data->>'role' = 'affiliate') as affiliates
from auth.users;

-- Check: paid accounts with neither a Stripe customer nor a comp flag. After
-- step 3 this should return no rows; any row here wasn't paid for in Stripe
-- or granted by an admin.
select email, raw_app_meta_data->>'plan' as plan
from auth.users
where raw_app_meta_data->>'plan' in ('carrier', 'team', 'fleet')
  and raw_app_meta_data->>'manual_plan' is null
  and raw_user_meta_data->>'stripe_customer_id' is null;
