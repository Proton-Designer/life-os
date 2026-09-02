#!/bin/bash
# check-enum-drift.sh — assert the database's CHECK-constrained value sets match
# the TypeScript unions and exhaustive Records that claim to mirror them.
#
# WHY THIS EXISTS (D-036, 2026-09-01)
#
# `work_sessions.kind` is `text` + CHECK, not a Postgres enum. Supabase's type
# generator emits `string` for a text column, so `WorkSessionKind` is
# hand-written — and `KIND_LABEL` is an exhaustive `Record` over it.
#
# NOTHING STRUCTURALLY CONNECTS THE TWO. Someone widens the CHECK in SQL to add
# a kind, gets a completely green typecheck, and ships `undefined` into a label
# the first time that kind reaches the UI. The read site casts
# (`data.kind as WorkSessionKind`), which erases exactly the mismatch that would
# otherwise surface.
#
# This is the same shape as check-rls.sh: an invariant nothing enforces, made
# loud by a cheap assertion. It is NOT a unit test — it needs a real database,
# and the unit suite must stay pure and offline.
#
# Precedent worth knowing (ULM): they hand-wrote an `EvidenceStrength` union
# that drifted against its DB enum — the type still said `strong_research_base`
# where the database said `strong_research`, and every consuming page carried a
# manual remap to paper over it. Their fix was to derive the type from the
# generated `Database["public"]["Enums"][...]` instead of hand-writing it. That
# only works for real PG enums; for text+CHECK columns, this script is the
# substitute.
#
# Usage:  ./scripts/check-enum-drift.sh "<postgres-url>"
#         ./scripts/check-enum-drift.sh --self-test "<postgres-url>"

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="pass"
if [ "${1:-}" = "--self-test" ]; then MODE="selftest"; shift; fi
URL="${1:-}"
[ -n "$URL" ] || { echo "usage: check-enum-drift.sh [--self-test] <postgres-url>" >&2; exit 2; }

# table.column -> the TS file whose union must cover it
#
# Only columns with BOTH a real DB CHECK constraint AND a genuine
# hand-written TS mirror are listed here — a column with no CHECK (tasks/
# custom_habits/weekly_goals/schedule_events.domain all predate the CHECK
# convention, per context/ARCHITECTURE.md) would report "no CHECK found"
# every single run forever, which is permanent noise, not a signal.
# checkin_allocations.domain is the same shape as work_sessions.kind's own
# 'wasted' sentinel trap (D-037's Domain-widening review) but in the other
# direction: its CHECK has 6 values (the 5 real domains + 'wasted'), and no
# single hand-written TS union cleanly mirrors that exact 6-value set
# (Domain deliberately excludes 'wasted' by design, and sn-ratio.ts's
# SIGNAL_DOMAINS/OTHER_COMMITMENT_DOMAINS split the 6 across two Sets plus
# one inline literal) — pairing it here would produce a permanent, false
# "missing: wasted" against Domain, which is intentional exclusion, not
# drift. distraction_triggers.domain has no such sentinel and pairs cleanly.
PAIRS="work_sessions.kind:lib/business/work-session-kind.ts
distraction_triggers.domain:lib/home/types.ts
coop_tasks.status:lib/coop/tasks.ts
workout_plans.kind:lib/fitness/plan-types.ts
plan_micro_exercises.goal_type:lib/fitness/plan-types.ts
tasks.task_type:lib/tasks/task-type.ts
class_assessments.type:app/(app)/school/class-actions.ts
user_domains.key:app/(app)/onboarding/actions.ts
user_subdomains.kind:app/(app)/onboarding/actions.ts
user_api_keys.provider:lib/ai/providers.ts
user_domains.weight:lib/business/domain-classification.ts"

db_values() { # <table> <column> -> newline-separated allowed values
  psql "$URL" -X -q -t -A </dev/null -c "
    select regexp_replace(m[1], '''', '', 'g')
    from pg_constraint c
    cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
    where c.conrelid = 'public.$1'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%$2%'
      -- Match BOTH forms Postgres renders a value set in:
      --   many values -> col = ANY (ARRAY['a','b'])
      --   ONE value   -> col = 'a'
      -- The original matched only ANY, so a single-value CHECK reported
      -- "no CHECK found ... review manually" every run. That is the permanent
      -- noise this script's own header warns against, and it lands on the case
      -- that matters MOST: a one-value set is the one about to be widened,
      -- which is the drift event this exists to catch.
      and pg_get_constraintdef(c.oid) similar to '%''[a-z_]+''%'
    ;" 2>/dev/null | sort -u | grep -v '^$'
}

ts_values() { # <file> -> values named in the union / Record keys
  grep -oE '"[a-z_]+"' "$1" 2>/dev/null | tr -d '"' | sort -u | grep -v '^$'
}

check_pair() { # <table.column>:<file>  -> 0 ok, 1 drift
  local spec="$1" tc file table col
  tc="${spec%%:*}"; file="${spec##*:}"
  table="${tc%%.*}"; col="${tc##*.}"
  local db ts missing extra
  db="$(db_values "$table" "$col")"
  ts="$(ts_values "$file")"
  if [ -z "$db" ]; then echo "  ? $tc — no CHECK found (column may have become an enum); review manually"; return 1; fi
  missing="$(comm -23 <(echo "$db") <(echo "$ts"))"
  extra="$(comm -13 <(echo "$db") <(echo "$ts"))"
  if [ -n "$missing" ]; then
    echo "  FAIL $tc — the DATABASE allows values the TypeScript does not name:"
    echo "$missing" | sed 's/^/    + /'
    echo "    -> $file must widen. A row with this kind renders undefined through any exhaustive Record."
    return 1
  fi
  # The reverse direction (TS names a value the DB rejects) is deliberately NOT
  # reported. ts_values() greps every quoted lowercase string in the file, so
  # for any file that also contains SQL column names, route fragments or other
  # literals it produces a long list of false "extras" — noise that trains a
  # reader to skim warnings, which is worse than no warning at all. It is also
  # the harmless direction: a TS value the DB rejects fails at insert, loudly.
  # The dangerous direction is a DB value TS does not name, which renders
  # `undefined` through an exhaustive Record — and that is checked above.
  echo "  ok   $tc — $(echo "$db" | tr '\n' ' ')"
  return 0
}

if [ "$MODE" = "selftest" ]; then
  echo "SELF-TEST: widening work_sessions.kind in a rolled-back transaction so the check MUST go red."
  # Payload lives in scripts/_enum-drift-selftest.sql and DERIVES the canary
  # constraint from whatever is currently in place rather than restating the
  # allowed set literally. See that file: an earlier hardcoded version went
  # stale the moment migration 077 added 'learn', and the detector drifted in
  # exactly the way it exists to detect.
  OUT="$(psql "$URL" -X -q -t -A -f "$(dirname "${BASH_SOURCE[0]}")/_enum-drift-selftest.sql" </dev/null 2>&1)"
  if echo "$OUT" | grep -q canary_kind; then
    echo "SELF-TEST PASSED — the reader saw the injected value ('canary_kind'), so drift is detectable."
    echo "Transaction rolled back; the real constraint is untouched."
    exit 0
  fi
  echo "SELF-TEST FAILED — the injected value was not observed. This check cannot see drift." >&2
  echo "$OUT" >&2
  exit 1
fi

echo "enum/union drift check"
FAIL=0
for spec in $PAIRS; do check_pair "$spec" || FAIL=1; done
[ "$FAIL" -eq 0 ] && { echo "OK — every CHECK-constrained value set is named in TypeScript."; exit 0; }
exit 1
