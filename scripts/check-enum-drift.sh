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
# SECOND HALF ADDED 2026-09-10/11 (the idempotency-audit/docs pass): PAIRS
# below is a hand-maintained list, and a hand-maintained list of "columns to
# check" drifts the exact same way the thing it's checking drifts — silently.
# `mcp_widgets.kind` proved this the expensive way: a real CHECK constraint
# existed, `lib/widgets/validate.ts`'s WIDGET_KINDS genuinely disagreed with
# it (3 kinds passed every app-level check and then failed at the database),
# and this script had no way to notice, because nobody had written that
# column's line into PAIRS yet. The pairwise check below can only ever be as
# complete as PAIRS is — it was NEVER going to catch a column it didn't know
# to look for.
#
# So `catalog_scan()` (below) walks `pg_constraint` directly for every
# single-column, value-set-shaped CHECK constraint in the public schema —
# enumerated from the database, not from a list anyone maintains — and
# reports any such column with no PAIRS entry as UNMAPPED. This is reported,
# always, in full, every run (never silently dropped) — but does NOT by
# itself fail the script. That is a deliberate, stated choice, not an
# oversight: at the moment this landed, 36 real columns fit this shape with
# no PAIRS entry (prayers.status, mcp_scheduled_actions.tool_name, and
# mcp_widgets.status among them) — none individually triaged. Failing the
# build on all 36 on day one would make preflight permanently red for a
# backlog nobody has reviewed yet, which is exactly the "a check that's
# always red gets ignored" failure mode this codebase has already paid for
# once. A column a human has looked at and either mapped (added to PAIRS) or
# explicitly excluded (a comment here, same as checkin_allocations.domain's
# existing exclusion note) stops being reported; everything else stays
# visible, unmissably, until one of those two things happens to it.
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
#
# class_assessments.type's file path was ITSELF stale (found running this
# script for the first time in a while, 2026-09-11): it pointed at
# app/(app)/school/class-actions.ts, which no longer contains the
# AssessmentType literals at all -- they live in lib/school/actions-core.ts
# now, moved there by an earlier core(supabase, userId, ...) extraction pass.
# The pairwise check reported a false "database allows values TypeScript does
# not name" for weeks, not because the database drifted, but because THIS
# SCRIPT's own reference to where the mirror lives went stale. Fixed below.
# The lesson generalizes: a PAIRS entry is itself a claim that can go stale
# exactly like the thing it monitors, and nothing catches that automatically
# either -- re-verify a FAIL here against the actual current file before
# assuming the database is the one that moved.
PAIRS="work_sessions.kind:lib/business/work-session-kind.ts
distraction_triggers.domain:lib/home/types.ts
coop_tasks.status:lib/coop/tasks.ts
workout_plans.kind:lib/fitness/plan-types.ts
plan_micro_exercises.goal_type:lib/fitness/plan-types.ts
tasks.task_type:lib/tasks/task-type.ts
class_assessments.type:lib/school/actions-core.ts
user_domains.key:app/(app)/onboarding/actions.ts
user_subdomains.kind:app/(app)/onboarding/actions.ts
user_api_keys.provider:lib/ai/providers.ts
user_domains.weight:lib/business/domain-classification.ts
user_domains.depth:lib/deen/faith-depth.ts
mcp_widgets.kind:lib/widgets/validate.ts"

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
  if [ -z "$db" ]; then
    # Distinguish "the column does not exist yet" from "it exists with no CHECK".
    # The first is a PENDING MIGRATION -- the pair was committed alongside a
    # migration that has not been applied to this database yet, which is correct
    # practice and must not read as drift. The second is a real finding.
    #
    # Without this split the check emits a permanent "?" between a migration
    # being committed and applied, and this script's own header warns that
    # permanent noise trains a reader to skim -- which is worse than no check.
    local exists
    exists="$(psql "$URL" -X -q -t -A </dev/null -c "
      select count(*) from information_schema.columns
       where table_schema='public' and table_name='$table' and column_name='$col';" 2>/dev/null | tr -d ' ')"
    # R70: a connection failure lands in `exists` as psql's error text, and the
  # old code fell through to "column EXISTS but has no CHECK (may have become
  # an enum)" — reporting SCHEMA DRIFT for a wrong password. A misdiagnosis is
  # worse than a bare failure: it sends someone to look at the right table for
  # the wrong reason.
  case "$exists" in
    ''|*[!0-9]*)
      echo "  CANNOT MEASURE $tc — the connection did not return a count:" >&2
      printf '%s\n' "$exists" | head -2 >&2
      return 1
      ;;
  esac
  if [ "$exists" = "0" ]; then
      echo "  ~ $tc — column not on this database yet (migration pending); not drift"
      return 0
    fi
    echo "  ? $tc — column EXISTS but has no CHECK (may have become an enum); review manually"
    return 1
  fi
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

# catalog_scan() -> newline-separated "table.column" for every single-column,
# value-set-shaped CHECK constraint in the public schema, enumerated directly
# from pg_constraint/pg_attribute -- not filtered to PAIRS, not filtered to
# anything a human decided to look at first. Uses conkey (the constraint's
# real key-column OIDs) to name the column, not text-parsing the constraint
# definition -- robust against compound constraints that happen to MENTION a
# column's values inline (e.g. work_session_objectives' three-way XOR check,
# which is NOT this column's real value-set definition and has more than one
# key column, so array_length(conkey,1)=1 correctly excludes it) without
# needing a hand-tuned regex per shape of compound constraint.
catalog_scan() {
  psql "$URL" -X -q -t -A </dev/null -c "
    select distinct conrelid::regclass::text || '.' || a.attname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'c'
      and c.connamespace = 'public'::regnamespace
      and array_length(c.conkey, 1) = 1
      and pg_get_constraintdef(c.oid) ~ ''''
    order by 1;
  " 2>/dev/null | grep -v '^$'
}

# report_unmapped() -> prints every catalog_scan() result with no PAIRS entry.
# Always prints in full (no truncation, no "N more"); never fails the script
# by itself -- see this file's header for why that's a stated choice, not an
# omission.
report_unmapped() {
  local all known unmapped n
  all="$(catalog_scan)"
  if [ -z "$all" ]; then
    echo "  CANNOT MEASURE — the catalog scan returned no rows at all, which is itself" >&2
    echo "  suspicious (this database has dozens of CHECK constraints); treating as a" >&2
    echo "  connection problem, not 'a database with nothing constrained.'" >&2
    return 1
  fi
  known="$(echo "$PAIRS" | sed 's/:.*//' | sort -u)"
  unmapped="$(comm -23 <(echo "$all" | sort -u) <(echo "$known"))"
  if [ -z "$unmapped" ]; then
    echo "  none — every single-column value-set CHECK constraint in the public schema has a PAIRS entry."
    return 0
  fi
  n="$(echo "$unmapped" | grep -c .)"
  echo "  $n column(s) below have a real, single-column, value-set CHECK constraint and NO entry in PAIRS."
  echo "  This is a coverage gap this script cannot resolve on its own -- each one needs a human decision:"
  echo "$unmapped" | sed 's/^/    ? /'
  echo "  -> for each: either add \"table.column:path/to/file.ts\" to PAIRS above (a real TS mirror exists"
  echo "     or should), or add a one-line exclusion comment near PAIRS explaining why no mirror is expected"
  echo "     (the same way checkin_allocations.domain's exclusion is already documented there). Until one of"
  echo "     those happens, this list reprints every run -- an absence here is exactly the bug class this"
  echo "     pass exists to close, so it is never silently dropped, even though it doesn't fail the build."
  return 1
}

if [ "$MODE" = "selftest" ]; then
  echo "SELF-TEST 1/2: widening work_sessions.kind in a rolled-back transaction so the PAIRED-DRIFT check MUST go red."
  # Payload lives in scripts/_enum-drift-selftest.sql and DERIVES the canary
  # constraint from whatever is currently in place rather than restating the
  # allowed set literally. See that file: an earlier hardcoded version went
  # stale the moment migration 077 added 'learn', and the detector drifted in
  # exactly the way it exists to detect.
  OUT="$(psql "$URL" -X -q -t -A -f "$(dirname "${BASH_SOURCE[0]}")/_enum-drift-selftest.sql" </dev/null 2>&1)"
  if echo "$OUT" | grep -q canary_kind; then
    echo "  PASSED — the reader saw the injected value ('canary_kind'), so pairwise drift is detectable."
  else
    echo "SELF-TEST FAILED (1/2) — the injected value was not observed. This check cannot see paired drift." >&2
    echo "$OUT" >&2
    exit 1
  fi

  echo "SELF-TEST 2/2: creating a brand-new, PAIRS-unaware CHECK constraint in a rolled-back transaction so the CATALOG SCAN must see it."
  # Proves the OTHER failure mode -- a column with a real CHECK constraint
  # that was never added to PAIRS at all, which is what actually happened to
  # mcp_widgets.kind. Payload: scripts/_enum-drift-selftest-unmapped.sql.
  OUT2="$(psql "$URL" -X -q -t -A -f "$(dirname "${BASH_SOURCE[0]}")/_enum-drift-selftest-unmapped.sql" </dev/null 2>&1)"
  if echo "$OUT2" | grep -q "_enum_drift_selftest_canary.val"; then
    echo "  PASSED — the reader saw the canary table's own constraint, so an unmapped column cannot go unnoticed."
    echo "SELF-TEST PASSED (2/2) — both transactions rolled back; nothing on the real schema was touched."
    exit 0
  fi
  echo "SELF-TEST FAILED (2/2) — the canary constraint was not observed. A brand-new constrained column could go unnoticed forever." >&2
  echo "$OUT2" >&2
  exit 1
fi

echo "enum/union drift check (pairwise, against PAIRS)"
FAIL=0
for spec in $PAIRS; do check_pair "$spec" || FAIL=1; done
[ "$FAIL" -eq 0 ] && echo "OK — every CHECK-constrained value set THIS SCRIPT KNOWS TO WATCH is named in TypeScript."

echo
echo "catalog coverage (every single-column value-set CHECK constraint that exists, mapped or not)"
report_unmapped

[ "$FAIL" -eq 0 ] && exit 0
exit 1
