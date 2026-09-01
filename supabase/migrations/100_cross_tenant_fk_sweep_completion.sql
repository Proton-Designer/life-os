-- Complete the cross-tenant composite-FK sweep begun in 058/059.
--
-- PROVENANCE, AND THE PART THAT MATTERS MOST (2026-09-01)
--
-- 058 converted ten parent/child pairs after a cross-tenant DoS was proven
-- against `save_trigger_plan`. It was not wrong. It was INCOMPLETE, and the
-- incompleteness had two separate causes that are worth separating, because
-- only one of them was excusable:
--
--   (a) Pairs nobody had enumerated. Found by ULM's engineer (ow9rlnds) via a
--       systematic sweep of all 118 FKs in the merged schema — 63 trivial
--       (user_id -> auth.users), 17 already composite, and all 38 remaining
--       single-column FKs evaluated individually by joining pg_indexes AND
--       pg_constraint and reading each guarding trigger's actual function body
--       rather than trusting its name. "How much of this schema has been
--       checked" now has an answer, which it did not before.
--
--   (b) Pairs 058 excluded ON A FALSE PREMISE. Its own footer reads:
--
--           session_sets.exercise_id -> exercises(id)   exercises is a shared
--           plan_sessions.workout_id -> workouts(id)    catalogue, not
--                                                       user-scoped.
--
--       Both tables have `user_id uuid NOT NULL`. `exercises` currently holds
--       4 rows across 2 distinct owners. **Neither is a shared catalogue and
--       neither ever was.** That sentence was not a judgement call a later
--       reader should defer to — it was a false statement of fact, written by
--       me, inside a security migration, in the section explicitly headed "so
--       the omissions read as decisions rather than misses." It made nine real
--       gaps read as considered exclusions for a day.
--
--       This is the failure mode AGENTS.md already names twice — a check that
--       examines nothing reports success — in its least visible form: a
--       DOCUMENTED exclusion. A gap nobody looked at gets found by the next
--       sweep. A gap with a confident reason beside it does not.
--
-- SECTION 1 — EXPLOITABLE. Cross-tenant denial of service, same shape as the
-- trigger_action_plans squat 058 was written for and as ULM's own sources.class_id
-- (086): single-column FK to a user-scoped parent, PLUS a uniqueness constraint
-- on the child that includes the FK column but NOT user_id. A squats a row on
-- B's parent; B's own legitimate row then fails the unique constraint; B cannot
-- see or delete A's row under RLS. B's insert keeps failing with a constraint
-- error naming a row that, to them, does not exist.
--
--   CONFIRMED BY DIRECT EXPLOIT (two genuine users, real `authenticated` role,
--   real JWT sub claims, positive control each time):
--     checkin_allocations.checkin_id -> checkins        unique(checkin_id, domain)
--     workout_exercises.workout_id   -> workouts        unique(workout_id, position)
--
--   IDENTICAL MECHANISM, NOT INDEPENDENTLY RE-TESTED. Recorded as inferred
--   rather than confirmed because "six confirmed exploits" and "two confirmed
--   plus four of the same shape" are different claims and only one is true:
--     plan_micro_exercises.plan_id      -> workout_plans   unique(plan_id, position)
--     plan_session_exercises.session_id -> plan_sessions   unique(session_id, position)
--     schedule_event_cancellations.event_id -> schedule_events unique(event_id, date)
--     schedule_event_overrides.event_id     -> schedule_events unique(event_id, date)
--
-- SECTION 2 — INTEGRITY GAP ONLY, no squat surface (no non-user-scoped
-- uniqueness touching the FK column). These are the (b) pairs. Fixed for the
-- reason 059 already gave: a known gap should not survive because the exploit
-- needs a second user who does not exist yet — and additionally here because
-- the recorded reason for skipping them was untrue.
--
-- SEVERITY, stated consistently with 086 and not inflated: LifeOS is
-- effectively single-tenant today, so every one of these needs a second real
-- user to exploit. Practical impact right now is near zero, and all are denial
-- of service, not data exposure.
--
-- PREFLIGHT RUN AGAINST PRODUCTION IMMEDIATELY BEFORE WRITING THIS: all 12
-- cross-tenant counts returned 0. Every FK below is NARROWED, never widened —
-- any row satisfying the new composite key already satisfied the old one — so
-- this fails loudly rather than silently accepting a violation.
--
-- DELETE SEMANTICS READ FROM pg_constraint, NOT ASSUMED, for every single
-- constraint below. 059 records why: its first draft turned a SET NULL into a
-- CASCADE on a guess, which would have destroyed schedule events on class
-- deletion. Section 2 here is a mix of CASCADE, SET NULL and NO ACTION — the
-- exact situation where a uniform "fix" corrupts three tables quietly.
--
-- COLUMN ORDER IS (user_id, id) AND MUST MATCH THE PARENT INDEX EXACTLY.
-- No index covers the reversed pair, so a flipped composite fails at ALTER
-- time (per 097's header, CollegeOS, who lost time to precisely this).

-- ---------------------------------------------------------------------------
-- 1. Composite-FK targets on the parents. `id` is already the primary key, so
--    these add no uniqueness — they exist solely to be referenced.
--    Queried with pg_indexes, NOT pg_constraint: 058 created these as unique
--    INDEXes, which are valid FK targets and INVISIBLE to a constraint-only
--    query. workout_plans already has one from 058 and is deliberately absent.
-- ---------------------------------------------------------------------------
create unique index if not exists checkins_user_id_id_key        on public.checkins (user_id, id);
create unique index if not exists workouts_user_id_id_key        on public.workouts (user_id, id);
create unique index if not exists plan_sessions_user_id_id_key   on public.plan_sessions (user_id, id);
create unique index if not exists schedule_events_user_id_id_key on public.schedule_events (user_id, id);
create unique index if not exists exercises_user_id_id_key       on public.exercises (user_id, id);

-- ---------------------------------------------------------------------------
-- SECTION 1 — the exploitable six. All six originals are ON DELETE CASCADE.
-- checkin_allocations first: check-ins are the highest-frequency write in the
-- product and the input Signal:Noise coverage is computed from, so a locked-out
-- user loses the mechanism the whole domain model rests on.
-- ---------------------------------------------------------------------------
alter table public.checkin_allocations drop constraint if exists checkin_allocations_checkin_id_fkey;
alter table public.checkin_allocations add constraint checkin_allocations_checkin_same_user
  foreign key (user_id, checkin_id) references public.checkins (user_id, id) on delete cascade;

alter table public.workout_exercises drop constraint if exists workout_exercises_workout_id_fkey;
alter table public.workout_exercises add constraint workout_exercises_workout_same_user
  foreign key (user_id, workout_id) references public.workouts (user_id, id) on delete cascade;

alter table public.plan_micro_exercises drop constraint if exists plan_micro_exercises_plan_id_fkey;
alter table public.plan_micro_exercises add constraint plan_micro_exercises_plan_same_user
  foreign key (user_id, plan_id) references public.workout_plans (user_id, id) on delete cascade;

alter table public.plan_session_exercises drop constraint if exists plan_session_exercises_session_id_fkey;
alter table public.plan_session_exercises add constraint plan_session_exercises_session_same_user
  foreign key (user_id, session_id) references public.plan_sessions (user_id, id) on delete cascade;

alter table public.schedule_event_cancellations drop constraint if exists schedule_event_cancellations_event_id_fkey;
alter table public.schedule_event_cancellations add constraint schedule_event_cancellations_event_same_user
  foreign key (user_id, event_id) references public.schedule_events (user_id, id) on delete cascade;

alter table public.schedule_event_overrides drop constraint if exists schedule_event_overrides_event_id_fkey;
alter table public.schedule_event_overrides add constraint schedule_event_overrides_event_same_user
  foreign key (user_id, event_id) references public.schedule_events (user_id, id) on delete cascade;

-- ---------------------------------------------------------------------------
-- SECTION 2 — the pairs 058 excluded on the false "shared catalogue" premise.
-- Integrity gaps, no squat surface. Delete semantics differ per constraint and
-- are preserved exactly as read from pg_constraint.
-- ---------------------------------------------------------------------------

-- -> exercises. ON DELETE SET NULL (nullable columns; MATCH SIMPLE leaves
--    existing NULL-exercise rows unchecked).
alter table public.session_sets drop constraint if exists session_sets_exercise_id_fkey;
alter table public.session_sets add constraint session_sets_exercise_same_user
  foreign key (user_id, exercise_id) references public.exercises (user_id, id) on delete set null;

-- -> exercises. NO ACTION (no ON DELETE clause on the originals). Preserved as
--    NO ACTION rather than "tidied" to CASCADE: deleting an exercise still in
--    use should fail loudly, which is the existing behaviour.
alter table public.workout_exercises drop constraint if exists workout_exercises_exercise_id_fkey;
alter table public.workout_exercises add constraint workout_exercises_exercise_same_user
  foreign key (user_id, exercise_id) references public.exercises (user_id, id);

alter table public.plan_micro_exercises drop constraint if exists plan_micro_exercises_exercise_id_fkey;
alter table public.plan_micro_exercises add constraint plan_micro_exercises_exercise_same_user
  foreign key (user_id, exercise_id) references public.exercises (user_id, id);

alter table public.plan_session_exercises drop constraint if exists plan_session_exercises_exercise_id_fkey;
alter table public.plan_session_exercises add constraint plan_session_exercises_exercise_same_user
  foreign key (user_id, exercise_id) references public.exercises (user_id, id);

alter table public.fitness_benchmarks drop constraint if exists fitness_benchmarks_exercise_id_fkey;
alter table public.fitness_benchmarks add constraint fitness_benchmarks_exercise_same_user
  foreign key (user_id, exercise_id) references public.exercises (user_id, id);

alter table public.rep_goals drop constraint if exists rep_goals_exercise_id_fkey;
alter table public.rep_goals add constraint rep_goals_exercise_same_user
  foreign key (user_id, exercise_id) references public.exercises (user_id, id);

-- -> workouts. All three ON DELETE SET NULL.
alter table public.plan_sessions drop constraint if exists plan_sessions_workout_id_fkey;
alter table public.plan_sessions add constraint plan_sessions_workout_same_user
  foreign key (user_id, workout_id) references public.workouts (user_id, id) on delete set null;

alter table public.workout_sessions drop constraint if exists workout_sessions_workout_id_fkey;
alter table public.workout_sessions add constraint workout_sessions_workout_same_user
  foreign key (user_id, workout_id) references public.workouts (user_id, id) on delete set null;

alter table public.workout_schedule drop constraint if exists workout_schedule_workout_id_fkey;
alter table public.workout_schedule add constraint workout_schedule_workout_same_user
  foreign key (user_id, workout_id) references public.workouts (user_id, id) on delete set null;

-- ---------------------------------------------------------------------------
-- STILL NOT CONVERTED, and this time the reason is checked rather than asserted:
--   *_user_id_fkey -> auth.users(id)   the ownership anchor itself.
--   class_assessments.task_id -> tasks(id)  nullable, ON DELETE SET NULL; the
--     one pair 058 deferred for shape reasons that remains outstanding.
-- Independently confirmed by ULM's sweep: class_assessments.class_id carries no
-- non-user-scoped uniqueness, so 058's composite FK there was correct hardening
-- on principle — NOT, as I had wondered aloud, an accidental fix of a live squat.
-- ---------------------------------------------------------------------------
