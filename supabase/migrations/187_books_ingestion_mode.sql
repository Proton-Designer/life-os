-- P2-14, overnight run 2026-09-15, Sonnet ENG 1 (Team A).
--
-- Batch-mode ingestion, selectable per book. `standard` (default) is
-- today's unchanged per-chunk/per-lesson behaviour -- every existing book
-- and every book uploaded without opting in keeps its current cost and
-- call shape exactly as-is. `batch` opts a book's extracting_lessons and
-- generating_cards stages (lib/self-mastery/ingestion/worker-stages.ts)
-- into combining several chunks/lessons into one gatewayChat call each,
-- at a lower total cost per book. verifying_grounding is deliberately
-- NEVER batched regardless of this column -- see that stage's own header
-- ("a hallucination firewall gate, not a place to economize").
--
-- Opus Lead's design approval, 2026-09-15: no real async provider batch
-- API exists behind any provider this pipeline calls (DeepSeek via
-- gatewayChat, Ollama, the dev shim) -- see this run's OPEN_QUESTIONS.md
-- "[P2-14]" entry for the full reasoning. This is the "larger-batching"
-- branch of the acceptance criteria's "provider batch API where
-- supported, or cheaper tier + larger batching," not the former.
--
-- Set at upload time (app/(app)/personal/self-mastery-actions.ts's
-- uploadBook), never changed mid-ingest -- a book's mode is fixed for the
-- run that processes it, so a stage handler reading it once per
-- invocation can never see it flip under a job already in flight.
--
-- No begin;/commit; -- the runner owns the transaction.

alter table public.books
  add column ingestion_mode text not null default 'standard'
    check (ingestion_mode in ('standard', 'batch'));

comment on column public.books.ingestion_mode is
  'P2-14: ''standard'' (default) is today''s unchanged one-chunk/one-lesson-per-model-call ingestion. ''batch'' combines several chunks/lessons into one gatewayChat call in extracting_lessons/generating_cards for lower cost -- never applied to verifying_grounding. Set once at upload, read by lib/self-mastery/ingestion/worker-stages.ts.';
