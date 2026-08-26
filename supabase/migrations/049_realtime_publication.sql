-- Cross-device live sync (2026-08-25/26 batch 2, item 2). Ayman: "when i
-- have the app open on my laptop and my phone, and i make a change on my
-- phone, it doesnt display at all on my macbook, and vice versa... this
-- relates to when it comes to logging prayers and logging tasks from
-- pretty much any screen and domain."
--
-- Root cause (Ruling R1): a mutation calls revalidatePath(), which busts
-- the SERVER's cache — but each device holds its own independent CLIENT
-- Router Cache (next.config.ts's staleTimes.dynamic), which keeps serving
-- its own stale snapshot for up to an hour and has no way to know a
-- write happened elsewhere. revalidatePath cannot reach another device.
--
-- Fix: Supabase Realtime. The `supabase_realtime` publication was EMPTY
-- (verified live, zero tables) — nothing was ever wired to stream
-- anywhere. This adds the specific, deliberately-scoped set of tables a
-- cross-device "I just logged X on my phone" moment actually touches.
--
-- Every table added here is a stream of postgres_changes events to every
-- connected client (filtered client-side to the signed-in user_id, but
-- still a subscription cost) — this is NOT "every mutable table," it's
-- the write-heavy, user-facing LOGGING tables his own words describe:
--
--   prayers            — "logging prayers," his literal example
--   sunnah_logs         — pairs with prayers; same screen, same moment
--   tasks               — "logging tasks," his literal example (School + Work)
--   kill_list_items     — Business domain's own daily completion list
--   deen_habit_logs     — Deen Habit Builder's daily check-off
--   habit_logs          — the general/fitness custom-habit completion table
--   body_metrics        — fitness weight/waist logging (kept loggable
--                         on-demand from Cycle Progress checks as of
--                         tonight's item 3 — exactly the kind of "log on
--                         my phone at the gym, see it on my laptop" case)
--   workout_sessions,
--   session_sets        — the actual fitness workout log (confirming a
--                         session's sets/reps) — the other half of
--                         "fitness logging" alongside body_metrics
--
-- Deliberately NOT included yet (narrower, less central to his complaint,
-- easy to add later without touching app code): coop_tasks/coop_targets
-- (Work's separate legacy task system), adhkar_logs/reflection_entries/
-- quran_sessions (Deen extras beyond prayers/habits), work_sessions
-- (Focus/Lock-In — Home's own live timer already polls, not dependent on
-- this), distraction_triggers/distraction_events, checkins/
-- checkin_allocations, schedule_event_cancellations, active_workout_plans.
-- Adding more later is a one-line migration; a client already flooded
-- with irrelevant events is a harder problem to walk back.
alter publication supabase_realtime add table
  public.prayers,
  public.sunnah_logs,
  public.tasks,
  public.kill_list_items,
  public.deen_habit_logs,
  public.habit_logs,
  public.body_metrics,
  public.workout_sessions,
  public.session_sets;
