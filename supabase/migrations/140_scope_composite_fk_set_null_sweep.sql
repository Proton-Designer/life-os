-- 140: THE SWEEP. Eighteen composite tenancy FKs still carry an unqualified
-- `ON DELETE SET NULL`, which is the bug migration 129 fixed on exactly two.
--
-- WHAT THE BUG IS. `ON DELETE SET NULL` with no column list nulls **every**
-- column of the referencing key -- including `user_id`, which is NOT NULL on
-- every one of these tables. So deleting the parent row does not clear the
-- reference; it raises, and the delete is **unreachable**. Not slow, not
-- awkward: impossible.
--
-- 129 fixed `active_workout_plans`' two FKs after "delete your active workout
-- plan" had been silently impossible in production for weeks. Its own commit
-- message said to sweep for the rest. **That sweep was never run** -- it went
-- onto a Day-2 list and stayed there. This is it, and it found eighteen more.
--
-- PROVEN ON PRODUCTION, not inferred, in a rolled-back transaction:
--
--   insert into classes (user_id, code) values (..., '__FKPROBE__');
--   insert into tasks (user_id, title, class_id) values (..., <that class>);
--   delete from classes where code='__FKPROBE__';
--   => ERROR: null value in column "user_id" of relation "tasks"
--             violates not-null constraint
--
-- i.e. **a class with any task attached cannot be deleted.** The same shape
-- applies to the other seventeen: deleting a work session, an exercise, a
-- workout, a reflection entry, a kill-list item, a rep goal, a book section, a
-- source chunk, a class, a plan session or a lesson promotion is blocked
-- wherever a child row still points at it.
--
-- THE FIX is the same one 129 used and is mechanical: scope the SET NULL to the
-- referenced column only, leaving the tenant column intact. Postgres 15+ takes
-- a column list; this server is 17.6.
--
-- WHY NOT RELAX THE NOT NULL INSTEAD -- the tempting alternative, and it is
-- wrong for the same reason it was wrong in 129: a row whose `user_id` is null
-- belongs to nobody, is invisible to every RLS policy, and accumulates
-- unreachable. The key must stay whole; only the reference may be cleared.
--
-- The tenancy guarantee is UNCHANGED. These stay composite FKs against
-- `(user_id, id)`, so a row referencing another user's data remains
-- structurally unrepresentable -- that property is what migration 100's sweep
-- established and this migration preserves it exactly.
--
-- Generated from the live catalog rather than hand-written, so the set is
-- complete by construction and no constraint definition was retyped.

alter table public.checkins
  drop constraint checkins_work_session_same_user;
alter table public.checkins
  add constraint checkins_work_session_same_user
  FOREIGN KEY (user_id, work_session_id) REFERENCES work_sessions(user_id, id) ON DELETE SET NULL (work_session_id);

alter table public.class_assessments
  drop constraint class_assessments_task_same_user;
alter table public.class_assessments
  add constraint class_assessments_task_same_user
  FOREIGN KEY (user_id, task_id) REFERENCES tasks(user_id, id) ON DELETE SET NULL (task_id);

alter table public.distraction_events
  drop constraint distraction_events_reflection_same_user;
alter table public.distraction_events
  add constraint distraction_events_reflection_same_user
  FOREIGN KEY (user_id, reflection_entry_id) REFERENCES reflection_entries(user_id, id) ON DELETE SET NULL (reflection_entry_id);

alter table public.lessons
  drop constraint lessons_section_id_fkey;
alter table public.lessons
  add constraint lessons_section_id_fkey
  FOREIGN KEY (user_id, section_id) REFERENCES book_sections(user_id, id) ON DELETE SET NULL (section_id);

alter table public.lessons
  drop constraint lessons_source_chunk_id_fkey;
alter table public.lessons
  add constraint lessons_source_chunk_id_fkey
  FOREIGN KEY (user_id, source_chunk_id) REFERENCES source_chunks(user_id, id) ON DELETE SET NULL (source_chunk_id);

alter table public.plan_sessions
  drop constraint plan_sessions_workout_same_user;
alter table public.plan_sessions
  add constraint plan_sessions_workout_same_user
  FOREIGN KEY (user_id, workout_id) REFERENCES workouts(user_id, id) ON DELETE SET NULL (workout_id);

alter table public.reviews
  drop constraint reviews_session_id_fkey;
alter table public.reviews
  add constraint reviews_session_id_fkey
  FOREIGN KEY (user_id, session_id) REFERENCES work_sessions(user_id, id) ON DELETE SET NULL (session_id);

alter table public.schedule_events
  drop constraint schedule_events_class_same_user;
alter table public.schedule_events
  add constraint schedule_events_class_same_user
  FOREIGN KEY (user_id, class_id) REFERENCES classes(user_id, id) ON DELETE SET NULL (class_id);

alter table public.self_explanations
  drop constraint self_explanations_session_id_fkey;
alter table public.self_explanations
  add constraint self_explanations_session_id_fkey
  FOREIGN KEY (user_id, session_id) REFERENCES work_sessions(user_id, id) ON DELETE SET NULL (session_id);

alter table public.session_sets
  drop constraint session_sets_exercise_same_user;
alter table public.session_sets
  add constraint session_sets_exercise_same_user
  FOREIGN KEY (user_id, exercise_id) REFERENCES exercises(user_id, id) ON DELETE SET NULL (exercise_id);

alter table public.source_chunks
  drop constraint source_chunks_section_id_fkey;
alter table public.source_chunks
  add constraint source_chunks_section_id_fkey
  FOREIGN KEY (user_id, section_id) REFERENCES book_sections(user_id, id) ON DELETE SET NULL (section_id);

alter table public.tasks
  drop constraint tasks_class_same_user;
alter table public.tasks
  add constraint tasks_class_same_user
  FOREIGN KEY (user_id, class_id) REFERENCES classes(user_id, id) ON DELETE SET NULL (class_id);

alter table public.work_sessions
  drop constraint work_sessions_kill_list_item_fkey;
alter table public.work_sessions
  add constraint work_sessions_kill_list_item_fkey
  FOREIGN KEY (user_id, kill_list_item_id) REFERENCES kill_list_items(user_id, id) ON DELETE SET NULL (kill_list_item_id);

alter table public.work_sessions
  drop constraint work_sessions_promotion_fkey;
alter table public.work_sessions
  add constraint work_sessions_promotion_fkey
  FOREIGN KEY (user_id, promotion_id) REFERENCES lesson_promotions(user_id, id) ON DELETE SET NULL (promotion_id);

alter table public.work_sessions
  drop constraint work_sessions_rep_goal_fkey;
alter table public.work_sessions
  add constraint work_sessions_rep_goal_fkey
  FOREIGN KEY (user_id, rep_goal_id) REFERENCES rep_goals(user_id, id) ON DELETE SET NULL (rep_goal_id);

alter table public.workout_schedule
  drop constraint workout_schedule_workout_same_user;
alter table public.workout_schedule
  add constraint workout_schedule_workout_same_user
  FOREIGN KEY (user_id, workout_id) REFERENCES workouts(user_id, id) ON DELETE SET NULL (workout_id);

alter table public.workout_sessions
  drop constraint workout_sessions_plan_session_same_user;
alter table public.workout_sessions
  add constraint workout_sessions_plan_session_same_user
  FOREIGN KEY (user_id, plan_session_id) REFERENCES plan_sessions(user_id, id) ON DELETE SET NULL (plan_session_id);

alter table public.workout_sessions
  drop constraint workout_sessions_workout_same_user;
alter table public.workout_sessions
  add constraint workout_sessions_workout_same_user
  FOREIGN KEY (user_id, workout_id) REFERENCES workouts(user_id, id) ON DELETE SET NULL (workout_id);

