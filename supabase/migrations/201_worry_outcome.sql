-- P2-12: Monday Anti-Worry Hour. Adds ONE column, no new table — same
-- discipline `lib/night-plan/worries.ts`'s own header already applied to
-- "handled" (`tasks.completed`/`completed_at`, never a second table or a
-- parallel status column): a worry's lifecycle is `tasks.dump_source =
-- 'worry'` rows, and `completed`/`completed_at` already answer "is it
-- open." `worry_outcome` answers a DIFFERENT, genuinely new question —
-- not THAT a worry was resolved, but HOW — which the existing binary
-- cannot represent and the Anti-Worry Hour's whole point is to record.
--
-- Nullable, and stays null forever for a worry marked "Handled" from the
-- plain Worry List (app/(app)/worries/actions.ts's existing
-- markWorryHandled) outside the Monday flow — recording an outcome is
-- only ever the Anti-Worry Hour panel's own act, never implied by
-- "handled" alone. Three values, chosen to mirror the classic CBT
-- "worry time" technique this feature is modeled on: a worry either
-- turned out not to be a real concern any more (resolved), got turned
-- into a real next step elsewhere in the app (took_action), or is
-- consciously being let go of for now without either of those (let_go).
-- Not scoped to dump_source='worry' by a CROSS-COLUMN CHECK (Postgres
-- CHECK constraints can reference other columns on the same row, but a
-- worry_outcome value on a non-worry task is meaningless, not unsafe —
-- app/(app)/worries/actions.ts's own findWorry already enforces
-- dump_source='worry' before any write reaches this column, the same
-- defense-in-depth shape that file's header describes for `completed`).
alter table public.tasks
  add column worry_outcome text,
  add constraint tasks_worry_outcome_check
    check (worry_outcome is null or worry_outcome in ('resolved', 'took_action', 'let_go'));
