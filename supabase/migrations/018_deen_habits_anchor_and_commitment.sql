-- Additive, nullable, no default: implementation-intention support for
-- Habit Builder (2026-08-18 redesign proposal, approved by Ayman via the
-- Lead overnight). anchor_cue is the "X" in "After X, I will [name]" — the
-- existing `name` column already serves as the "Y", so no second column is
-- needed for the response half. commitment_note is the optional
-- self-commitment device (Ariely & Wertenbroch precommitment research,
-- see docs/superpowers/research/2026-08-18-habit-formation-research.md §7)
-- captured at habit creation.
--
-- Both genuinely nullable with NO default: existing habits have no anchor
-- or commitment note, and a default empty string would make "never set"
-- indistinguishable from "cleared" — the redesign proposal (§1) requires
-- graceful degradation to the bare habit name when anchor_cue is null,
-- which only works if null and "" are kept distinct.
--
-- Applied directly via psql on 2026-08-18 (Supabase MCP unauthenticated
-- this session, same as migrations 016/017). REGISTERED 2026-08-18 in
-- supabase_migrations.schema_migrations as version 20260818053500, together
-- with 017. 016 was already registered on 2026-08-16; its own header comment
-- had gone stale saying otherwise, which is worth remembering -- the database
-- is the source of truth for what is applied, a comment is a claim about it.
alter table public.deen_habits
  add column anchor_cue text,
  add column commitment_note text;
