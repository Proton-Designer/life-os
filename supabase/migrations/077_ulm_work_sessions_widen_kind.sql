-- ULM: widen `work_sessions.kind` to admit `'learn'` — the retrieval
-- session kind. This is the migration `057_work_sessions_counts_toward_hours.sql`
-- was written to precede: that file added `counts_toward_hours` as a
-- GENERATED column (deep_work/deep_study/exam_prep only) specifically so
-- there is never a window where 'learn' is storable but uncounted-for. This
-- file is what makes 'learn' storable at all — landing after 057, never
-- before it.
--
-- The CHECK is dropped and re-added in the SAME statement group (same
-- migration, same transaction) — there is no window where `kind` is
-- unconstrained. Only `'learn'` is admitted, not `anti_worry` or
-- `exam_prep`: there are no rows of those kinds today, and widening a CHECK
-- for kinds nothing produces is how a CHECK stops meaning anything.
--
-- `cards_reviewed`/`new_cards_introduced` are the retrieval-specific
-- counters ULM's own `sessions` table used to carry. `work_sessions_learn_counters`
-- makes it impossible for a non-'learn' row to carry them — not a
-- convention, a database fact, same pattern as `sources`' `num_nonnulls`
-- and `card_states`/`reviews`' ownership triggers throughout this batch.
-- `counts_toward_hours` is NOT touched here: it already resolves `'learn'`
-- to `false` via its existing generated expression the moment the CHECK
-- admits the value — no second write path, no new column, exactly per the
-- Opus Lead's instruction not to add a competing source of truth.

alter table public.work_sessions
  drop constraint work_sessions_kind_check,
  add constraint work_sessions_kind_check
    check (kind in ('deep_work', 'deep_study', 'learn'));

alter table public.work_sessions
  add column cards_reviewed       int,
  add column new_cards_introduced int,
  add constraint work_sessions_learn_counters
    check (kind = 'learn' or (cards_reviewed is null and new_cards_introduced is null));
