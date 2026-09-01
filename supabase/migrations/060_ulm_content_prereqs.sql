-- ULM content tables, batch 1 of N (Opus leads' convergence plan, D-029/D-031;
-- our numbered range is 060-089). This file: the shared prerequisites for the
-- five content tables that follow (books, book_sections, source_chunks,
-- lessons, cards) — the pgvector extension and the enum types more than one
-- of those tables needs. Adapted from ULM's own
-- `supabase/migrations/20260815040000_l1a_schema.sql` (that repo's baseline
-- schema before the merge), not copy-pasted: this file carries over only the
-- extension + enum subset that batch 1 actually needs, in this repo's
-- incremental-migration style (plain `create`, no `if not exists` — unlike
-- 000_baseline.sql, these are only ever applied once, in order, never
-- replayed).
--
-- Scope note: user_settings/user_stats/sessions collisions with whatever
-- CollegeOS's 057-062 batch lands are NOT this file's concern — nothing here
-- touches those tables or reserves those names. Step-zero collision check
-- (against 000_baseline.sql, cc374b4) confirmed zero collisions for all five
-- content tables and everything defined in this file.

create extension if not exists "vector";

create type public.book_status as enum ('uploading', 'processing', 'ready', 'failed');

create type public.ingest_stage as enum (
  'queued', 'extracting_text', 'parsing_structure', 'chunking', 'embedding',
  'extracting_lessons', 'merging', 'generating_cards', 'finalizing', 'done', 'failed'
);

create type public.lesson_status as enum ('active', 'archived', 'rejected');

create type public.evidence_strength as enum ('author_anecdote', 'single_study', 'strong_research');

create type public.prompt_type as enum ('free_recall', 'application', 'cloze', 'why');
