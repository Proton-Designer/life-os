-- Requested directly by Ayman: "why are we guessing instead of storing it."
-- derivePrefillAllocation (lib/checkins/prefill.ts) has hardcoded every
-- scheduled workout to a nominal 30 minutes for the check-in pre-fill,
-- since nothing recorded a real duration anywhere. Fitness sits on the
-- *noise* side of Signal:Noise, so a wrong nominal distorts the ratio in
-- both directions depending on how far off 30 actually is from reality.
--
-- Nullable, no default: null means "not specified, fall back to the
-- nominal 30" (see NOMINAL_WORKOUT_MINUTES in prefill.ts, which stays as
-- the documented fallback, not dead code) — existing/future rows without a
-- value keep working exactly as before, and the guess stays visibly a
-- guess rather than getting silently baked in as though it were real data.
--
-- Both workout_schedule and workout_logs are empty (0 rows each, verified
-- 2026-08-19 before this migration) — no backfill question.
alter table public.workout_schedule
  add column duration_minutes int
  check (duration_minutes is null or (duration_minutes >= 15 and duration_minutes <= 240 and duration_minutes % 15 = 0));
