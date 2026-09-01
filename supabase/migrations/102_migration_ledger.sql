-- A ledger of which migrations are actually on THIS database.
--
-- WHY (D-046, 2026-09-01) — this closes a hole that produced a live exploit.
--
-- Production deploys and migration applies are gated on one person (me). That
-- rule is correct and the other tracks held it exactly. What nothing supplied
-- was a SIGNAL FOR "IS THE QUEUE DRAINED?" — so ULM's 086, which fixed a
-- proven cross-tenant denial of service, sat scratch-verified and unapplied for
-- hours while I worked on other things. Nobody was careless. The state simply
-- was not observable: I found it by accident, auditing something else.
--
-- `supabase_migrations.schema_migrations` exists but is VESTIGIAL here — 34
-- rows, last written 2026-08-20, because we apply by hand with psql rather than
-- through the Supabase CLI. Reading it would have said "nothing new since
-- August 20th" on a database that had taken 30 migrations since. A stale ledger
-- is worse than none: it answers confidently and wrongly. It is deliberately
-- left alone here (it belongs to the CLI) rather than back-filled.
--
-- WHAT GOES IN: filename, the file's md5 at apply time, and when. The md5 is
-- what makes this more than a checklist — it detects a migration EDITED AFTER
-- APPLYING, where the file in git no longer describes the database it
-- supposedly produced. That is the same drift class as `pg_get_functiondef`
-- vs. the migration file, and as `database.types.ts` generated against scratch:
-- an artifact that looks authoritative and describes something that isn't there.
--
-- BACKFILL HONESTY: entries below are recorded as `backfilled`, not `applied`,
-- because their md5 is the file as it stands TODAY and cannot be re-derived for
-- an apply that happened weeks ago. Six were spot-checked against real database
-- objects before backfilling (016 tasks.completed_at, 017 sunnah_logs,
-- 056 user_domains, 057 counts_toward_hours, 083 books policies,
-- 085 p_confidence) — all present. Everything from 099 onward was applied by me
-- today and is recorded as `applied`.
--
-- DELIBERATELY ABSENT, and both absences are correct:
--   000_baseline.sql  — reconstructs this schema from empty for a fresh
--                       database. Production predates it and must never run it.
--   093..097          — the School migrations. Verified NOT applied:
--                       school_risk_inputs, school_grade_inputs, questions and
--                       attempts do not exist on production. They are also
--                       uncommitted, pending Ayman's go-ahead.

create table if not exists public.migration_ledger (
  filename   text primary key,
  md5        text not null,
  status     text not null default 'applied'
             check (status in ('applied', 'backfilled', 'skipped')),
  note       text,
  applied_at timestamptz not null default now()
);

comment on table public.migration_ledger is
  'Which migration files are on THIS database. Maintained by scripts/apply-migration.sh; '
  'audited by scripts/check-migrations-applied.sh. NOT supabase_migrations.schema_migrations, '
  'which is the CLI''s and is stale here because we apply by hand.';

-- The ledger is operational metadata, not user data: no user_id, so RLS is
-- enabled with no policy at all. That denies every anon/authenticated request
-- (RLS with zero policies fails closed) while the service role bypasses it.
-- check-rls.sh flags "RLS on but no policy" as a finding, so this is recorded
-- here as the one deliberate instance.
alter table public.migration_ledger enable row level security;

insert into public.migration_ledger (filename, md5, status, note) values
  ('000_baseline.sql', 'n/a', 'skipped',
   'Rebuilds the schema from empty for a fresh database. Production predates it; must never run here.')
on conflict (filename) do nothing;
