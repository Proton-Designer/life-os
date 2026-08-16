-- Additive, nullable: needed for School/Co-op's "Completed this week" KPI
-- (2026-08-15 structural refactor, Phase F). Set on completion, cleared on
-- un-completion; historical rows stay null and are excluded from any
-- trend — no fabricated backfill.
--
-- Applied directly via psql on 2026-08-16 (Supabase MCP was unauthenticated
-- this session) rather than through apply_migration, so unlike migrations
-- 001-015 this one was NOT recorded in Supabase's own migration-history
-- table at apply time. This file is that missing record on the repo side.
-- Register it in Supabase's history too once MCP auth is available (Phase
-- H) so both sides agree again.
alter table public.tasks
  add column completed_at timestamptz;
