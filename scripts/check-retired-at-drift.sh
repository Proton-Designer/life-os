#!/bin/bash
# check-retired-at-drift.sh — assert lesson_promotions.retired_at is non-null
# IFF a terminal verdict exists for that promotion.
#
# WHY THIS EXISTS (R64, 2026-09-02)
#
# `retired_at` is a DERIVED value. It duplicates a fact the append-only
# `lesson_verdicts` log already carries: whether a promotion has received an
# `adopted` or `abandoned` verdict. Duplicating a fact means the two copies can
# disagree, which is the `book_memory_strength` defect in miniature — two
# implementations of one quantity, diverging quietly until a user sees two
# different truths.
#
# The column ships anyway, because the alternative (computing activeness from
# the log on every read) cannot back a partial unique index, and
# `lesson_promotions_active_per_lesson` is what makes "one live experiment per
# lesson" an invariant rather than a hope.
#
# So it ships under a condition stated when it was authored and enforced here:
# NO CHECK, NO COLUMN. This script is that check. If it is deleted, the column
# should be deleted with it.
#
# TWO DIRECTIONS, both real, neither implied by the other:
#   missed_retirement — a terminal verdict exists, retired_at is NULL. The
#                       trigger did not fire, or fired and lost. The promotion
#                       stays "active" forever and blocks re-promotion of that
#                       lesson via the partial unique index.
#   orphan_retirement — retired_at is set with NO terminal verdict. Something
#                       other than the trigger wrote it. The promotion vanishes
#                       from the active set with nothing in the log explaining
#                       why — a retirement no one can account for.
#
# `still_testing` is NOT terminal. A promotion with only still_testing verdicts
# must have a NULL retired_at, and this script treats a retirement on such a
# promotion as an orphan.
#
# PROVEN ON SCRATCH (container 55101, 2026-09-02), all inside rolled-back txns:
#   - self-test injects both directions and the check reports both (1/1);
#     without injection the same query on the same database reports 0/0.
#     The control and the subject differ only in the injection.
#   - inserting a `still_testing` verdict does NOT retire the promotion
#     (trigger ignores it) and creates no orphan: 0.
#   - retiring a promotion whose only verdict is `still_testing` IS reported
#     as an orphan: 1. still_testing is not terminal, here and in the trigger.
#
# Usage:
#   ./scripts/check-retired-at-drift.sh "<postgres-url>"
#   ./scripts/check-retired-at-drift.sh --self-test "<postgres-url>"
#
# --self-test proves the check can FAIL before you trust it passing. It injects
# ONE row of each drift direction inside a transaction it then ROLLS BACK, so
# it never leaves residue. An unfired check is not evidence of anything.
set -uo pipefail

MODE="check"
if [ "${1:-}" = "--self-test" ]; then MODE="selftest"; shift; fi
URL="${1:-}"
[ -n "$URL" ] || { echo "usage: check-retired-at-drift.sh [--self-test] <postgres-url>" >&2; exit 2; }

query() { psql "$URL" -X -q -t -A -F'|' -c "$1" </dev/null 2>&1; }

DRIFT_SQL="
  select
    (select count(*) from public.lesson_promotions p
      where p.retired_at is null
        and exists (select 1 from public.lesson_verdicts v
                     where v.promotion_id = p.id
                       and v.verdict in ('adopted','abandoned'))),
    (select count(*) from public.lesson_promotions p
      where p.retired_at is not null
        and not exists (select 1 from public.lesson_verdicts v
                         where v.promotion_id = p.id
                           and v.verdict in ('adopted','abandoned'))),
    (select count(*) from public.lesson_promotions);"

report() {
  local missed="$1" orphan="$2" total="$3" label="$4"
  echo "  ${label}: promotions=${total} missed_retirement=${missed} orphan_retirement=${orphan}"
}

if [ "$MODE" = "selftest" ]; then
  echo "check-retired-at-drift --self-test: proving both directions can go RED."
  #
  # The injection runs inside ONE transaction that is ROLLED BACK. Nothing
  # survives it.
  #
  # ORDER IS LOAD-BEARING, and the reason is worth stating because it cost a
  # first attempt: `lesson_promotions_active_per_lesson` is UNIQUE on
  # (user_id, lesson_id) WHERE retired_at IS NULL. Clearing a retired_at is
  # therefore an INSERT into that index and can collide with a sibling
  # promotion on the same lesson -- which is exactly what happened on the
  # scratch container. So the ORPHAN direction is injected first: retiring a
  # row REMOVES it from the partial index and frees the slot the MISSED
  # direction then needs.
  #
  # That collision is also a real, narrow piece of structural protection worth
  # naming: while a competing active promotion exists for the same lesson, the
  # database will not let a missed retirement be represented at all. It is not
  # a general guarantee -- a promotion with no competitor drifts freely -- so
  # it does not remove the need for this check.
  #
  # Each injection reports the rows it touched. Zero touched rows is a COVERAGE
  # GAP, not a pass: the check was never given anything to find.
  OUT=$(psql "$URL" -X -q -t -A -F'|' -v ON_ERROR_STOP=1 </dev/null 2>&1 <<SQL
begin;

-- Direction 2 first (see above). A promotion with no terminal verdict, given a
-- retirement no entry in the log can account for.
with inj as (
  update public.lesson_promotions p set retired_at = now()
   where p.id = (
     select p2.id from public.lesson_promotions p2
      where p2.retired_at is null
        and not exists (select 1 from public.lesson_verdicts v
                         where v.promotion_id = p2.id
                           and v.verdict in ('adopted','abandoned'))
      limit 1)
   returning 1)
select 'orphan_injected=' || count(*) from inj;

-- Direction 1. A promotion that DID receive a terminal verdict, with its
-- retirement removed: the trigger did not fire, or fired and lost. Restricted
-- to lessons with no active promotion left, so the partial unique index has a
-- free slot.
with inj as (
  update public.lesson_promotions p set retired_at = null
   where p.id = (
     -- EXACTLY ONE row. An earlier version updated every qualifying row and
     -- collided with ITSELF once a lesson had two retired promotions: both
     -- passed the "no active sibling" test and then both became active.
     select p2.id from public.lesson_promotions p2
      where p2.retired_at is not null
        and exists (select 1 from public.lesson_verdicts v
                     where v.promotion_id = p2.id
                       and v.verdict in ('adopted','abandoned'))
        and not exists (select 1 from public.lesson_promotions o
                         where o.user_id = p2.user_id and o.lesson_id = p2.lesson_id
                           and o.id <> p2.id and o.retired_at is null)
      limit 1)
   returning 1)
select 'missed_injected=' || count(*) from inj;

${DRIFT_SQL}
rollback;
SQL
)
  echo "$OUT" | grep -E '^(orphan|missed)_injected=' | sed 's/^/  /'
  ORPHAN_IN=$(echo "$OUT" | sed -n 's/^orphan_injected=//p' | tail -1)
  MISSED_IN=$(echo "$OUT" | sed -n 's/^missed_injected=//p' | tail -1)
  LINE=$(echo "$OUT" | grep -E '^[0-9]+\|[0-9]+\|[0-9]+$' | tail -1)
  MISSED=$(echo "$LINE" | cut -d'|' -f1); ORPHAN=$(echo "$LINE" | cut -d'|' -f2); TOTAL=$(echo "$LINE" | cut -d'|' -f3)
  report "${MISSED:-?}" "${ORPHAN:-?}" "${TOTAL:-?}" "with drift injected (rolled back)"

  if [ "${MISSED_IN:-0}" -lt 1 ] || [ "${ORPHAN_IN:-0}" -lt 1 ]; then
    echo "SELF-TEST INCONCLUSIVE: this database could not supply both injections" >&2
    echo "  (orphan_injected=${ORPHAN_IN:-0} missed_injected=${MISSED_IN:-0})." >&2
    echo "  That is a COVERAGE GAP, not a pass. Seed one promotion with a terminal" >&2
    echo "  verdict and one without, then re-run." >&2
    echo "$OUT" | grep -i 'error' >&2
    exit 1
  fi
  if [ "${MISSED:-0}" -ge 1 ] && [ "${ORPHAN:-0}" -ge 1 ]; then
    echo "SELF-TEST PASS: both injections applied and both were detected. The check can go red."
    exit 0
  fi
  echo "SELF-TEST FAIL: drift was injected but the check did not report it" >&2
  echo "  (missed=${MISSED:-?} orphan=${ORPHAN:-?}). The query is blind -- fix it before trusting a green." >&2
  exit 1
fi

LINE=$(query "$DRIFT_SQL" | grep -E '^[0-9]+\|[0-9]+\|[0-9]+$' | tail -1)
MISSED=$(echo "$LINE" | cut -d'|' -f1); ORPHAN=$(echo "$LINE" | cut -d'|' -f2); TOTAL=$(echo "$LINE" | cut -d'|' -f3)
report "${MISSED:-?}" "${ORPHAN:-?}" "${TOTAL:-?}" "live"

# A query that did not come back as three integers is a FAILED CHECK, never a
# zero. Before this guard the live path exited 0 against a database where the
# column did not exist yet: the SQL errored, LINE was empty, TOTAL defaulted to
# 0, and the "empty table" branch reported success. A check that passes when its
# subject is ABSENT is worse than no check, because it is quoted as evidence.
if ! echo "${LINE:-}" | grep -qE '^[0-9]+\|[0-9]+\|[0-9]+$'; then
  echo "CHECK FAILED TO RUN: the drift query did not return three integers." >&2
  echo "  Subject: lesson_promotions/lesson_verdicts" >&2
  echo "  Raw output follows -- a missing table or column reads as a query error here," >&2
  echo "  which is the honest result; it is not a pass." >&2
  query "$DRIFT_SQL" | sed 's/^/    /' >&2
  exit 1
fi

if [ "${TOTAL:-0}" -eq 0 ]; then
  echo "NOTE: zero promotions exist. This is a clean result about an EMPTY table," >&2
  echo "  not evidence the invariant holds under data. Re-run once promotions exist." >&2
  exit 0
fi
if [ "${MISSED:-1}" -eq 0 ] && [ "${ORPHAN:-1}" -eq 0 ]; then
  echo "OK: retired_at agrees with the verdict log in both directions."
  exit 0
fi
echo "DRIFT: retired_at disagrees with lesson_verdicts. See the two directions in this file's header." >&2
exit 1
