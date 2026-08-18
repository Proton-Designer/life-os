-- Additive, nullable: needed for School/Co-op's "Completed this week" KPI
-- (2026-08-15 structural refactor, Phase F). Set on completion, cleared on
-- un-completion; historical rows stay null and are excluded from any
-- trend — no fabricated backfill.
--
-- Applied directly via psql on 2026-08-16 (Supabase MCP was unauthenticated
-- this session) rather than through apply_migration, so unlike migrations
-- 001-015 this one was NOT recorded in Supabase's own migration-history
-- table at apply time. This file is that missing record on the repo side.
-- REGISTERED 2026-08-16 in supabase_migrations.schema_migrations as version
-- 20260816071500. This comment previously still read as pending and was not
-- updated after registration -- which misled the Opus Lead into asserting the
-- opposite on 2026-08-18. Engineer 2 checked the table directly and was right.
-- Lesson worth keeping: the database is the source of truth for what is
-- applied and registered; a comment is a claim about the past.
alter table public.tasks
  add column completed_at timestamptz;
