-- DRAFT — NOT a numbered migration. Per supabase/migrations/ALLOCATIONS.md's
-- rule ("Numbers are allocated by the LifeOS lead only. Nobody
-- self-assigns"), this file lives OUTSIDE supabase/migrations/ so it can
-- never be mistaken for an applied or pending migration. File it as
-- supabase/migrations/<N>_book_sections_summary.sql once a number is
-- allocated, then delete this draft. (ALLOCATIONS.md shows `144` as next
-- free as of this writing -- not claimed, just noted.)
--
-- L9 (docs/ai-connector/PROGRAM-PLAN.md, R6): the book summariser's data
-- half. `book_sections` currently has zero rows and no summary column --
-- this is the gap behind the owner's requirement that a per-chapter summary,
-- never the raw text itself, is what MCP exposes. Read surface
-- (`self_mastery.book_section`) already exists (lib/mcp/registry.ts,
-- commit 787b56f); this migration is what gives it something real to read.
--
-- WHAT THIS DOES NOT DO: it does not populate a single row, run the
-- summariser, or wire anything automatic. Structure population
-- (lib/self-mastery/ingestion/persist-sections.ts) reuses `parseStructure()`,
-- already computed and already discarded today inside `chunkingStage`
-- (worker-stages.ts) -- see this migration's companion PR for the
-- reasoning on why that's a parsing/heuristic job, never a model call.
-- Summarization (lib/self-mastery/ingestion/summarize-sections.ts) is a
-- manually invoked function, never wired to a route or a cron -- the lead's
-- explicit instruction: a background job that spends the owner's metered
-- DeepSeek credits without him asking is not a feature.
--
-- `summary text null` -- nullable, no default. NULL means "not summarised
-- yet," the overwhelmingly common state for the foreseeable future (nothing
-- calls the summariser automatically). Never backfilled with a placeholder
-- string -- an absent summary must read as absent, not as a fabricated
-- empty one.
--
-- `summarized_by public.extracted_by` -- REUSES the enum `lessons.
-- extracted_by` already defined (084_ulm_lessons_extracted_by.sql), rather
-- than minting a near-duplicate type. That column's three values map onto
-- this one's real cases with no loss of meaning: 'model' = a real DeepSeek
-- call produced this summary; 'heuristic' = the deterministic keyless
-- fallback ran (HeuristicProvider's own `summarizeSection`, built
-- specifically so the orchestration logic has a real, testable path with
-- no API key configured); 'seed' is unused here today but costs nothing to
-- leave available rather than defining a second enum that differs from the
-- first by one unused value. NULL means "unknown / not yet summarised" --
-- same semantics 084 already established, not reinvented.
--
-- `summary_model text null` -- the SPECIFIC model string (e.g.
-- "deepseek-v4-flash"), one level more precise than `summarized_by`'s
-- coarse class. Deliberately plain text, not a CHECK-constrained or enum
-- value: `lib/ai/providers.ts`'s own header notes DeepSeek has already
-- renamed its default model once ("deepseek-chat" isn't a real model
-- anymore) -- a rigid constraint on a live vendor's model name is a
-- migration waiting to be needed the next time they rename it. This column
-- is provenance to look AT, not a value this schema enforces.
--
-- `summary_source_chunk_ids uuid[] null` -- which `source_chunks` rows fed
-- this summary, in the order they were sent. Plain array, no FK (Postgres
-- cannot FK-constrain an array's elements without a trigger, and this is
-- advisory provenance for "what did the model actually see," not a
-- tenancy-critical reference RLS or ownership depends on -- same posture
-- `rep_goals.active_days` already takes for a different array column in
-- this schema).
--
-- `summarized_at timestamptz null` -- deliberately SEPARATE from
-- `updated_at` below, even though a summary write is currently the only
-- thing that will ever update this row: `updated_at` is a generic "this row
-- changed for some reason" signal (MCP's own visibility-registry
-- convention, lib/mcp/registry.ts), while `summarized_at` answers the one
-- specific question "when was the summary itself last (re)computed" even
-- if a future unrelated edit (retitling a section, correcting its page
-- range) ever updates the row for a different reason. Explicit over
-- inferred, same reasoning `reviews.state_before`/`state_after` already
-- uses rather than making a caller derive one from the other.
--
-- `created_at`/`updated_at` -- this table had NEITHER (062_ulm_book_sections.sql).
-- Added now, with `touch_updated_at()` (074) wired from day one, not
-- retrofitted later the way 133/135/136/137/138 each had to be -- per the
-- explicit instruction and the lesson those five migrations exist to teach.
-- No backfill: table is genuinely empty in production (0 rows, confirmed by
-- the lead) as of this writing.

alter table public.book_sections
  add column summary                 text,
  add column summarized_by           public.extracted_by,
  add column summary_model           text,
  add column summary_source_chunk_ids uuid[],
  add column summarized_at           timestamptz,
  add column created_at              timestamptz not null default now(),
  add column updated_at              timestamptz not null default now();

-- The pair moves together or not at all -- a summary with no record of
-- which generator produced it is exactly the "urgent retroactively"
-- unrecoverable case 084's own header warns about for extracted_by.
alter table public.book_sections
  add constraint book_sections_summary_provenance_pair
  check ((summary is null) = (summarized_by is null));

create trigger book_sections_touch_updated_at
  before update on public.book_sections
  for each row execute function public.touch_updated_at();
