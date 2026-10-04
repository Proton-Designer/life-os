-- 252: two new opt-in features for profiles.enabled_features -- 'morning_routine' and
-- 'sleep_plan' (RS-01). (Sonnet ENG 1; number allocated by the Opus lead, 2026-10-04.)
--
-- enabled_features (250) has a CHECK that validates every stored value against the TS
-- enum in lib/opt-in-features.ts, so adding ids there needs the CHECK widened here or
-- updateProfile({ enabled_features }) fails at the database for the new ids.
--
-- NO BACKFILL: both features start absent (OFF) for every existing and new account.
-- Nothing is deleted or rewritten -- the old constraint is replaced by a strict superset.
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

do $$
declare
  c record;
begin
  -- The column CHECK from 250 was created inline, so its generated name is
  -- profiles_enabled_features_check; find it by definition rather than trusting the name.
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%enabled_features%'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.profiles
  add constraint profiles_enabled_features_check
  check (enabled_features <@ array['cards_library', 'estimate_vs_actual', 'morning_routine', 'sleep_plan']);
