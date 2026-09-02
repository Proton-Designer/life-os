#!/usr/bin/env bash
# check-scarcity-indexes.sh — assert that every index whose JOB is to make
# something scarce is actually UNIQUE on the target database.
#
# WHY THIS EXISTS, AND WHY A MIGRATION'S OWN SELF-CHECK WAS NOT ENOUGH.
# Migration 113's `do $$` block asserts that tasks_mit_rank_per_day_idx exists
# AND that its definition carries the partial predicate. ULM Eng 2, verifying
# it cold, swapped in a NON-UNIQUE index with the identical name, identical
# columns and identical WHERE clause, and ran the block verbatim against it.
# **It passed.** A second crown went straight through while the file's own
# self-verification reported success.
#
# That is one level deeper than the gap the block was written to close, and it
# is the same shape: an assertion that checks the things you thought to name
# and is silent about the property that actually does the work. Existence is
# not the guarantee. The predicate is not the guarantee. `indisunique` is.
#
# It lives here rather than in a corrected migration because a `do $$` block
# runs ONCE, at apply time, and 113 is already applied — editing it now would
# change a file the ledger has hashed and would re-verify nothing on this
# database. A standing instrument re-checks the property after every apply,
# forever, including after a restore, a manual fix, or a rebuild.
#
# Usage:  ./scripts/check-scarcity-indexes.sh "<postgres-url>"
#         ./scripts/check-scarcity-indexes.sh --self-test "<postgres-url>"
set -uo pipefail

MODE="check"
if [ "${1:-}" = "--self-test" ]; then MODE="selftest"; shift; fi
URL="${1:-}"
[ -n "$URL" ] || { echo "usage: check-scarcity-indexes.sh [--self-test] <postgres-url>" >&2; exit 2; }

query() { psql "$URL" -X -q -t -A </dev/null -c "$1" 2>&1; }

# Every index that exists to REFUSE a second row, with what it protects.
# Add a line whenever a migration introduces a scarcity guarantee.
SCARCITY_INDEXES="
tasks_mit_rank_per_day_idx|one crowned/starred rank per user per planned day (Night Plan, 113)
user_domains_user_key_unique|one row per domain key per user
card_states_card_user_key|one card state per card per user (111)
card_states_question_user_key|one question state per question per user (111)
"

echo "scarcity-index check"
FAIL=0
CHECKED=0
while IFS='|' read -r idx why; do
  [ -z "$idx" ] && continue
  CHECKED=$((CHECKED + 1))
  row="$(query "select coalesce((select i.indisunique::text from pg_index i join pg_class c on c.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace where c.relname = '$idx' and n.nspname = 'public'), 'ABSENT');")"
  case "$row" in
    true)   printf '  ok     %-32s UNIQUE — %s\n' "$idx" "$why" ;;
    false)  printf '  FAIL   %-32s EXISTS BUT IS NOT UNIQUE — %s\n' "$idx" "$why"
            echo   "         A duplicate would be accepted silently. Nothing renders an error;"
            echo   "         the guarantee is simply gone."
            FAIL=1 ;;
    ABSENT) printf '  FAIL   %-32s ABSENT — %s\n' "$idx" "$why"
            FAIL=1 ;;
    *)      printf '  ?      %-32s could not read: %s\n' "$idx" "$row"; FAIL=1 ;;
  esac
done <<< "$SCARCITY_INDEXES"

if [ "$MODE" = "selftest" ]; then
  echo
  echo "SELF-TEST: creating a NON-UNIQUE index with a scarcity name so the check must go RED."
  query "create table if not exists public._scarcity_canary (user_id uuid, planned_date date, mit_rank smallint);" >/dev/null
  query "drop index if exists public._scarcity_canary_idx;" >/dev/null
  query "create index _scarcity_canary_idx on public._scarcity_canary (user_id, planned_date, mit_rank) where mit_rank is not null;" >/dev/null
  seen="$(query "select coalesce((select i.indisunique::text from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = '_scarcity_canary_idx'), 'ABSENT');")"
  query "drop table if exists public._scarcity_canary cascade;" >/dev/null
  if [ "$seen" = "false" ]; then
    echo "SELF-TEST PASSED — a same-shaped non-unique index reads as indisunique=false, so this check can see the defect."
    exit 0
  fi
  echo "SELF-TEST FAILED — the reader did not observe indisunique=false (got '$seen'). This check is decoration." >&2
  exit 1
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "OK — all $CHECKED scarcity indexes exist and are UNIQUE."
  exit 0
fi
echo "FAILED — a scarcity guarantee is not enforced by the database." >&2
exit 1
