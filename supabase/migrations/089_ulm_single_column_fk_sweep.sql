-- ULM: convert all 16 of ULM's remaining single-column FKs to composite,
-- completing the same hardening `058` (LifeOS, 10 pairs), `097` (CollegeOS, 2
-- pairs), `086`/`087` (ULM's `sources`, 2 pairs), and `100` (LifeOS, the
-- pairs excluded on `058`'s false "shared catalogue" premise) have each
-- already done on their own tables. One migration, not sixteen.
--
-- 🔴 NONE OF THIS WAS EXPLOITABLE. Say so plainly, because a reader who finds
-- a 16-pair security migration and skips this paragraph will conclude ULM
-- shipped 16 live vulnerabilities today. We shipped two (`sources.book_id`,
-- `sources.class_id`, both found and fixed in `086`/`087`). Every pair below
-- was independently classified SAFE by the complete FK/uniqueness audit run
-- against the whole merged schema earlier today (`docs/specs/convergence-
-- coverage.md` §10, ULM repo): 11 of the 16 are guarded today by a
-- `SECURITY INVOKER` fail-closed ownership trigger (`set_user_id_from_book`,
-- `card_states_derive_and_check`, `set_review_owner_from_card`,
-- `check_review_session_owner`); the other 5 are integrity-gap-only — no
-- uniqueness on the child column for a squatter to occupy, so a cross-tenant
-- reference is possible but nobody is ever locked out of anything.
--
-- WHY CONVERT SOMETHING ALREADY SAFE. The trigger protection is real but
-- INCIDENTAL: it is a `SECURITY INVOKER` function's own behaviour, refactorable
-- by anyone who touches it without knowing it's load-bearing for this — the
-- exact distinction `087` proved by disabling `books_create_source` and
-- watching the FK alone hold. A composite FK is STRUCTURAL: it cannot be
-- forgotten, only deliberately dropped. Having argued that distinction for
-- `sources`, it does not hold to leave 16 more of ULM's own FKs resting on a
-- trigger's continued correctness.
--
-- DELETE SEMANTICS READ PER-CONSTRAINT FROM pg_constraint, NOT ASSUMED. `100`
-- found a uniform rule would have quietly corrupted three of LifeOS's tables;
-- the same check here found 11 CASCADE (all on NOT NULL columns) and 5
-- SET NULL (all on nullable columns: `lessons.section_id`,
-- `lessons.source_chunk_id`, `reviews.session_id`,
-- `self_explanations.session_id`, `source_chunks.section_id`). Every
-- constraint below preserves its existing `ON DELETE` exactly — only the
-- referenced columns change, from single-column to composite.
--
-- PREFLIGHT run against the scratch DB immediately before writing this: all
-- 16 cross-tenant counts (`select count(*) from child c join parent p on
-- p.id = c.<fk_col> where p.user_id <> c.user_id`, `c.<fk_col> is not null`
-- guard on the 5 nullable ones) returned 0. Every FK below is NARROWED, never
-- widened — any row satisfying the new composite key already satisfied the
-- old one — so this fails loudly rather than silently accepting a violation
-- if that preflight turns out to have been stale by the time this runs.
-- Per the LifeOS lead's own caution: that preflight is DIAGNOSTIC, not a
-- safety gate — its job is explaining why an ALTER failed, not licensing a
-- skim past the error if one occurs.
--
-- work_sessions.session_id PAIRS (reviews, self_explanations): unblocked by
-- the LifeOS lead's own `101`, which created `work_sessions_user_id_id_key`
-- and bound a real composite FK against it in a rolled-back transaction
-- before reporting it usable, rather than stopping at "the index exists."
-- Their preflight on PRODUCTION for both pairs: 0 cross-tenant rows, both
-- `ON DELETE SET NULL`, both columns nullable — matches this migration's own
-- scratch preflight and delete-semantics read exactly.
--
-- SCRATCH IS CURRENTLY BEHIND PRODUCTION on LifeOS's `100`/`101` (applied to
-- production, not yet replayed onto the shared scratch container) — verified
-- and stated precisely here rather than assumed clean: this migration's own
-- verification below was run on scratch, which lacked `100`/`101` at the
-- time. That drift does not affect this migration's own 16 pairs (ULM's
-- tables only, unrelated to LifeOS's), but the claim "verified against
-- scratch" is scoped to that fact and no further.
--
-- COLUMN ORDER IS (user_id, id) AND MUST MATCH THE PARENT INDEX EXACTLY, per
-- `097`'s own header (CollegeOS, who lost time to precisely this) and this
-- platform's now-consistent convention.

-- ---------------------------------------------------------------------------
-- 1. Composite-FK targets on the parents. `id` is already each parent's
--    primary key, so these add no uniqueness — they exist solely to be
--    referenced by a composite FK. `books_user_id_id_key` already exists
--    (`087`); the rest are genuinely missing on ULM's tables, checked
--    directly via `pg_indexes` (not `pg_constraint` — a unique index is a
--    valid FK target and invisible to a constraint-only query, per today's
--    running lesson) before writing this. `work_sessions_user_id_id_key` is
--    `create ... if not exists` deliberately: it already exists on
--    production (LifeOS's `101`) but not yet on the scratch container this
--    migration was verified against (see the drift note above) — idempotent
--    either way.
-- ---------------------------------------------------------------------------
create unique index if not exists cards_user_id_id_key ON public.cards (user_id, id);
create unique index if not exists lessons_user_id_id_key ON public.lessons (user_id, id);
create unique index if not exists book_sections_user_id_id_key ON public.book_sections (user_id, id);
create unique index if not exists source_chunks_user_id_id_key ON public.source_chunks (user_id, id);
create unique index if not exists work_sessions_user_id_id_key ON public.work_sessions (user_id, id);

-- ---------------------------------------------------------------------------
-- 2. Replace each single-column FK with its composite equivalent. ON DELETE
--    preserved exactly per-constraint, read from pg_constraint above, never
--    assumed uniform.
-- ---------------------------------------------------------------------------

-- -> books. All five CASCADE (all NOT NULL columns).
alter table public.book_sections drop constraint if exists book_sections_book_id_fkey;
alter table public.book_sections add constraint book_sections_book_id_fkey
  foreign key (user_id, book_id) references public.books (user_id, id) on delete cascade;

alter table public.card_states drop constraint if exists card_states_book_id_fkey;
alter table public.card_states add constraint card_states_book_id_fkey
  foreign key (user_id, book_id) references public.books (user_id, id) on delete cascade;

alter table public.cards drop constraint if exists cards_book_id_fkey;
alter table public.cards add constraint cards_book_id_fkey
  foreign key (user_id, book_id) references public.books (user_id, id) on delete cascade;

alter table public.ingestion_jobs drop constraint if exists ingestion_jobs_book_id_fkey;
alter table public.ingestion_jobs add constraint ingestion_jobs_book_id_fkey
  foreign key (user_id, book_id) references public.books (user_id, id) on delete cascade;

alter table public.lessons drop constraint if exists lessons_book_id_fkey;
alter table public.lessons add constraint lessons_book_id_fkey
  foreign key (user_id, book_id) references public.books (user_id, id) on delete cascade;

alter table public.reviews drop constraint if exists reviews_book_id_fkey;
alter table public.reviews add constraint reviews_book_id_fkey
  foreign key (user_id, book_id) references public.books (user_id, id) on delete cascade;

alter table public.source_chunks drop constraint if exists source_chunks_book_id_fkey;
alter table public.source_chunks add constraint source_chunks_book_id_fkey
  foreign key (user_id, book_id) references public.books (user_id, id) on delete cascade;

-- -> cards. CASCADE (card_states.card_id, reviews.card_id, both NOT NULL);
--    cards.lesson_id -> lessons is CASCADE too (NOT NULL).
alter table public.card_states drop constraint if exists card_states_card_id_fkey;
alter table public.card_states add constraint card_states_card_id_fkey
  foreign key (user_id, card_id) references public.cards (user_id, id) on delete cascade;

alter table public.reviews drop constraint if exists reviews_card_id_fkey;
alter table public.reviews add constraint reviews_card_id_fkey
  foreign key (user_id, card_id) references public.cards (user_id, id) on delete cascade;

alter table public.cards drop constraint if exists cards_lesson_id_fkey;
alter table public.cards add constraint cards_lesson_id_fkey
  foreign key (user_id, lesson_id) references public.lessons (user_id, id) on delete cascade;

-- -> lessons. self_explanations.lesson_id is CASCADE (NOT NULL).
alter table public.self_explanations drop constraint if exists self_explanations_lesson_id_fkey;
alter table public.self_explanations add constraint self_explanations_lesson_id_fkey
  foreign key (user_id, lesson_id) references public.lessons (user_id, id) on delete cascade;

-- -> book_sections. Both SET NULL (nullable columns; MATCH SIMPLE leaves
--    existing NULL-section rows correctly unchecked).
alter table public.lessons drop constraint if exists lessons_section_id_fkey;
alter table public.lessons add constraint lessons_section_id_fkey
  foreign key (user_id, section_id) references public.book_sections (user_id, id) on delete set null;

alter table public.source_chunks drop constraint if exists source_chunks_section_id_fkey;
alter table public.source_chunks add constraint source_chunks_section_id_fkey
  foreign key (user_id, section_id) references public.book_sections (user_id, id) on delete set null;

-- -> source_chunks. SET NULL (nullable column).
alter table public.lessons drop constraint if exists lessons_source_chunk_id_fkey;
alter table public.lessons add constraint lessons_source_chunk_id_fkey
  foreign key (user_id, source_chunk_id) references public.source_chunks (user_id, id) on delete set null;

-- -> work_sessions. Both SET NULL (nullable columns) -- unblocked by the
--    LifeOS lead's own work_sessions_user_id_id_key (101).
alter table public.reviews drop constraint if exists reviews_session_id_fkey;
alter table public.reviews add constraint reviews_session_id_fkey
  foreign key (user_id, session_id) references public.work_sessions (user_id, id) on delete set null;

alter table public.self_explanations drop constraint if exists self_explanations_session_id_fkey;
alter table public.self_explanations add constraint self_explanations_session_id_fkey
  foreign key (user_id, session_id) references public.work_sessions (user_id, id) on delete set null;
