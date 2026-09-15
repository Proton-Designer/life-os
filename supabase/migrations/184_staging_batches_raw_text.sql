-- P2-07, overnight run 2026-09-15, Sonnet ENG 1 (Team A).
--
-- `staging_batches` (migration 167) was already designed with
-- `source in ('syllabus', 'announcement')` from the start -- 167's own
-- header: "one row per upload/paste (source: syllabus PDF or pasted
-- announcement text)". What it never had a place for is the pasted text
-- ITSELF: a syllabus batch's source is a PDF (never persisted -- read for
-- text only, see syllabus-extraction-actions.ts's own header), but P2-07's
-- "per-course announcement history list" needs the actual pasted
-- announcement text to show back to the user later.
--
-- NULLABLE, POPULATED ONLY FOR source='announcement': a syllabus batch
-- never sets this (there is no raw text to store -- the PDF bytes are
-- deliberately never persisted, same reasoning that already applies to
-- the syllabus file itself). Not a CHECK-enforced pairing with `source`
-- (a CHECK requiring raw_text IS NOT NULL for announcement batches would
-- reject a legitimate one-line/whitespace-only paste that still produced
-- zero extracted items -- #19's "nothing schedulable found" state, which
-- this repo's own convention treats as a confident success, not an error
-- to make unrepresentable at the schema layer).
--
-- BOUNDED LENGTH: an announcement paste is expected to be short (unlike a
-- multi-page syllabus PDF); capped generously at 10,000 chars, matching
-- the order of magnitude syllabus-extraction.ts's own MAX_SYLLABUS_CHARS
-- (20,000) uses for the AI call itself -- this column stores what the
-- user actually pasted, which the action layer already truncates before
-- the AI call, so storing more than that bound here would silently keep
-- text nothing downstream ever reads past.
--
-- No RLS change: staging_batches_own_row (167) already covers every
-- column on this table for the owning user, full CRUD.
--
-- No begin;/commit; -- the runner owns the transaction.

alter table public.staging_batches
  add column raw_text text null
    constraint staging_batches_raw_text_length check (raw_text is null or length(raw_text) <= 10000);

comment on column public.staging_batches.raw_text is
  'P2-07: the pasted announcement text, for the per-course announcement history list. Only ever set for source=''announcement'' batches -- a syllabus batch''s source PDF is never persisted anywhere, so this stays null for those. Capped at 10,000 chars, matching the order of magnitude the AI extraction call itself bounds to.';
