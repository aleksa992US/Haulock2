-- Deleting an admin who had added another admin failed with a foreign-key
-- error (admins.added_by → auth.users had no ON DELETE rule), after their
-- Stripe subscriptions had already been canceled. Keep the admin row and
-- forget who added it instead. Safe to run any time.
alter table public.admins drop constraint if exists admins_added_by_fkey;
alter table public.admins
  add constraint admins_added_by_fkey foreign key (added_by) references auth.users(id) on delete set null;
