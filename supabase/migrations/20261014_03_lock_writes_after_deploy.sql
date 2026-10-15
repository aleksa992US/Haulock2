-- Step 3 of 3 — run only AFTER fix/security-and-bugs is live in production.
-- The new code writes these tables with the service role; the code running
-- today still writes them as the user, so running this earlier breaks saving
-- lookups, the watchlist, API keys and payout requests.
--
-- Users could insert rows directly (bypassing the watchlist limit, minting
-- API keys on Free, filing payout requests for any amount) and edit their
-- usage rows.
drop policy if exists "lookups_insert_own" on public.lookups;
drop policy if exists "lookups_update_own" on public.lookups;
drop policy if exists "watchlist_insert_own" on public.watchlist;
drop policy if exists "watchlist_update_own" on public.watchlist;
drop policy if exists "api_keys_insert_own" on public.api_keys;
drop policy if exists "api_keys_update_own" on public.api_keys;
drop policy if exists "affiliate_payouts_insert_own" on public.affiliate_payouts;
