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
-- this session, same as migrations 016/017) — NOT yet registered in
-- Supabase's own migration-history table. 016, 017, and this one all need
-- registering together once MCP auth is available.
alter table public.deen_habits
  add column anchor_cue text,
  add column commitment_note text;
