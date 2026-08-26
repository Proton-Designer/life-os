-- Engineer A, afternoon batch 2 (2026-08-26). Coverage check on the
-- cross-device realtime sync shipped tonight (049) found a real gap: Work
-- (co_op) never routes through the shared `tasks` table School/Business/
-- etc. use — it writes exclusively to `coop_tasks`/`coop_targets` (see
-- lib/home/get-domain-snapshots.ts:106's own comment: "Work moved off the
-- shared `tasks` table"). Neither table was in the publication, so Work
-- was the one domain where "logging tasks from any screen and domain"
-- (Ayman's own words, quoted in 049) silently didn't sync — worse than a
-- known gap, since it would look like flakiness rather than scope.
--
-- RLS checked before adding — a table added to supabase_realtime without
-- RLS broadcasts every user's rows to any authenticated subscriber. Both
-- tables have rowsecurity = true and exactly one own-row policy each
-- (coop_targets_own_row, coop_tasks_own_row), same shape as the tables
-- already in the publication. Verified live via pg_tables/pg_policies
-- before writing this migration, not assumed from the table name matching
-- the existing pattern.
--
-- New migration, not an edit to 049 — 049 is already applied to prod;
-- editing an applied migration changes nothing about the database and
-- leaves the file lying about what was actually run. Idempotent: guarded
-- on pg_publication_tables so re-running this file is a no-op rather than
-- an "already a member" error.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'coop_tasks'
  ) then
    alter publication supabase_realtime add table public.coop_tasks;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'coop_targets'
  ) then
    alter publication supabase_realtime add table public.coop_targets;
  end if;
end $$;
