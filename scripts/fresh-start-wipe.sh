#!/usr/bin/env bash
# R7 — Ayman's "fresh start" wipe, 2026-08-26.
#
# He asked for this explicitly and specifically, listing what goes and what
# stays. It is IRREVERSIBLE and it targets his REAL production account, in a
# database that has no staging copy. So this script takes a pg_dump FIRST.
#
#   ./scripts/fresh-start-wipe.sh            # dry run: counts only, no writes
#   ./scripts/fresh-start-wipe.sh --execute  # backup, then delete
#
# SCOPE — his account ONLY. SEED is deliberately untouched: it is the test
# account the e2e suite runs against, and wiping it would undermine the
# post-deploy verification this wipe is supposed to precede.

set -euo pipefail
cd "$(dirname "$0")/.."
set -a && . ./.env.local && set +a

REAL_USER='f503c9b6-a0ad-4c4e-8af4-451fb065d61a'
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="./.fresh-start-backup-${STAMP}.sql"
EXECUTE="${1:-}"

# Deleted. Every one of these is tracking/progress data he named, or data whose
# only alternative is showing him a history he did not live.
WIPE_TABLES=(
  weekly_goals                 # "All current and past weekly goals"
  prayers sunnah_logs          # "all past prayer data including finished prayers"
  reflection_entries           # "remove all reflection counts"
  deen_habit_logs deen_weekly_focus deen_habits   # "remove all habits and their insights and progress"
  habit_logs custom_habits     # same, the non-Deen habit tables
  kill_list_items              # "Remove all past kill list data as well so that restarts"
  session_sets workout_sessions body_metrics fitness_benchmarks fitness_cycle_anchor
                               # "remove past fitness data ... just not the progress" — PROGRESS only
  adhkar_logs quran_sessions   # Deen daily tracking; same class as prayers/reflections
  checkin_allocations checkins # check-in history, all of it development-era
  distraction_events           # tracking. NOTE: distraction_triggers are KEPT (configuration, not history)
  coop_targets coop_tasks      # business targets + their tasks; same "restart" intent as the kill list
  work_sessions                # deep work / deep study session history
  notification_reads notification_log  # development-era notification noise
)

# KEPT — named by him, or structural. Counted after the wipe to prove untouched.
KEEP_TABLES=(
  classes class_assessments schedule_events schedule_event_cancellations schedule_event_overrides
  workout_plans plan_sessions plan_session_exercises plan_micro_exercises active_workout_plans
  rep_goals workouts workout_exercises workout_schedule exercises
  distraction_triggers tasks profiles push_subscriptions
)

echo "=== BEFORE (real account) ==="
for t in "${WIPE_TABLES[@]}"; do
  n=$(psql "$DATABASE_URL" -t -c "select count(*) from public.$t where user_id='$REAL_USER'" 2>/dev/null | tr -d ' ' || echo "?")
  [ "${n:-0}" != "0" ] && echo "  WIPE  $t = $n"
done
for t in "${KEEP_TABLES[@]}"; do
  n=$(psql "$DATABASE_URL" -t -c "select count(*) from public.$t where user_id='$REAL_USER'" 2>/dev/null | tr -d ' ' || echo "?")
  [ "${n:-0}" != "0" ] && echo "  keep  $t = $n"
done

if [ "$EXECUTE" != "--execute" ]; then
  echo
  echo "DRY RUN — nothing written. Re-run with --execute to back up and delete."
  exit 0
fi

echo
echo "=== BACKUP -> $BACKUP ==="
DUMP_ARGS=()
for t in "${WIPE_TABLES[@]}"; do DUMP_ARGS+=(--table="public.$t"); done
pg_dump "$DATABASE_URL" --data-only --no-owner --no-privileges "${DUMP_ARGS[@]}" > "$BACKUP"
echo "  $(wc -l < "$BACKUP") lines, $(du -h "$BACKUP" | cut -f1)"
[ -s "$BACKUP" ] || { echo "ERROR: backup is empty — refusing to delete."; exit 1; }

echo
echo "=== DELETE (single transaction) ==="
{
  echo "begin;"
  for t in "${WIPE_TABLES[@]}"; do
    echo "delete from public.$t where user_id='$REAL_USER';"
  done
  # The qada counter is a column, not a table — "the qada log" in his words.
  echo "update public.profiles set qada_owed = 0 where user_id='$REAL_USER';"
  # THE POINT OF THE WHOLE EXERCISE. Without this, resolvePrayerStatuses derives
  # 'missed' from every empty day back to profiles.created_at (2026-08-10) —
  # 16 days x 5 prayers = 80 fabricated misses, which is precisely the false
  # history he asked us to remove. Migration 051 + computeTrackingFloorDateStr.
  echo "update public.profiles set tracking_started_on = date '2026-08-26' where user_id='$REAL_USER';"
  echo "commit;"
} | psql "$DATABASE_URL" -v ON_ERROR_STOP=1

echo
echo "=== AFTER ==="
for t in "${WIPE_TABLES[@]}"; do
  n=$(psql "$DATABASE_URL" -t -c "select count(*) from public.$t where user_id='$REAL_USER'" 2>/dev/null | tr -d ' ' || echo "?")
  [ "${n:-0}" != "0" ] && echo "  !! STILL PRESENT  $t = $n"
done
echo "  (no 'STILL PRESENT' lines above means every wipe target is empty)"
for t in "${KEEP_TABLES[@]}"; do
  n=$(psql "$DATABASE_URL" -t -c "select count(*) from public.$t where user_id='$REAL_USER'" 2>/dev/null | tr -d ' ' || echo "?")
  [ "${n:-0}" != "0" ] && echo "  kept  $t = $n"
done
psql "$DATABASE_URL" -c "select tracking_started_on, qada_owed from public.profiles where user_id='$REAL_USER';"
echo
echo "Backup retained at $BACKUP (gitignored). Do not delete it tonight."
