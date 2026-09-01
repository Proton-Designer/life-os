-- Finish the composite-FK sweep: the last two single-column references to
-- `classes`. Companion to 058.
--
-- WHY THESE WERE LEFT OUT OF 058, AND WHY THEY ARE BEING DONE NOW
--
-- 058 fixed ten parent/child pairs after a cross-tenant denial of service was
-- proven against `save_trigger_plan`. `tasks.class_id` and
-- `schedule_events.class_id` were deliberately deferred there — both are
-- nullable with different delete semantics, and I wanted 058 to be one shape.
--
-- The ULM lead's engineer then checked whether these two are exploitable the
-- same way. **They are not**, and the reason is precise and worth recording:
--
--   The `sources` / `trigger_action_plans` exploit needed BOTH halves — a
--   cross-tenant FK reference AND a uniqueness constraint that is not
--   user-scoped. The squatter has to occupy a slot the victim needs.
--
--   `pg_indexes` on both tables shows a primary key on `id` and **no unique
--   index touching class_id at all**. So A can attach their own task to B's
--   class_id, but nothing of B's is blocked — A's row occupies nothing.
--   Referential-integrity gap, not a DoS.
--
-- Fixing them anyway, for the reason the CollegeOS lead gave when they shipped
-- the equivalent for `questions`/`attempts` despite confirming no exploit: the
-- stated posture is defence in depth on a database that is single-tenant
-- *today*, and **a known gap should not survive because the exploit needs a
-- second user who does not exist yet.** That assumption is exactly what M2/M3
-- are in the process of changing.
--
-- NULLABLE COLUMNS ARE SAFE HERE: both class_id columns are nullable (a task or
-- a schedule event need not belong to a class). Postgres FKs default to MATCH
-- SIMPLE, so a row with a NULL class_id is not checked at all — existing
-- class-less rows are unaffected. Preflight against production: 0 cross-tenant
-- rows in either table.
--
-- DELETE SEMANTICS PRESERVED EXACTLY as they were on the original constraints —
-- read from pg_constraint rather than assumed, because silently changing a
-- CASCADE into a SET NULL (or the reverse) during a "security fix" is precisely
-- the kind of collateral change nobody reviews for.
--
-- METHODOLOGICAL NOTE, and it nearly cost a broken migration elsewhere today:
-- when auditing for this class, query **`pg_indexes`, not `pg_constraint`**.
-- 058 created `classes_user_id_id_key` as a unique INDEX, which is a perfectly
-- valid FK target and is INVISIBLE to a `pg_constraint` query. Two leads
-- checked, disagreed, and both believed they had asked the whole question.
-- The disagreement itself was the signal that one query was narrower than the
-- question.

alter table public.tasks drop constraint if exists tasks_class_id_fkey;
alter table public.tasks add constraint tasks_class_same_user
  foreign key (user_id, class_id) references public.classes (user_id, id) on delete set null;

alter table public.schedule_events drop constraint if exists schedule_events_class_id_fkey;
alter table public.schedule_events add constraint schedule_events_class_same_user
  foreign key (user_id, class_id) references public.classes (user_id, id) on delete set null;

-- Both are ON DELETE SET NULL, read from pg_constraint immediately before
-- writing this. The first draft of this file said CASCADE for schedule_events
-- on the assumption that a schedule event without its class is meaningless —
-- which is a reasonable-sounding guess and was wrong. Deleting a class would
-- have silently destroyed its schedule events instead of orphaning them. That
-- is the exact collateral change the note above warns about, made by the person
-- who wrote the warning, one paragraph later.
