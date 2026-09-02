#!/bin/bash
# check-suspension-drift.sh — assert cards.suspended_at is non-null IFF that
# card's lesson has an `adopted` verdict.
#
# WHY THIS EXISTS (R64, migration 126)
#
# `cards.suspended_at` is a DERIVED value. The append-only `lesson_verdicts`
# log already records that a lesson was adopted; this column duplicates that
# fact onto the card so `get_session_queue` can filter on the hot path without
# joining the log on every build. Two copies of one fact can disagree, which is
# the `book_memory_strength` defect in miniature.
#
# It ships under the same condition its sibling `lesson_promotions.retired_at`
# ships under, and the condition is the whole point: NO CHECK, NO COLUMN. This
# script is that check. Delete it and the column should go with it.
# See scripts/check-retired-at-drift.sh — same shape, same reasoning, other
# half of Phase C.
#
# TWO DIRECTIONS, neither implied by the other:
#   missed_suspension — the lesson was adopted, the card is still in the deck.
#                       The user told us they now DO this and we kept asking.
#                       Three separate mechanisms exist to prevent it (the
#                       verdict trigger, the born-suspended trigger on card
#                       insert, and 126's backfill) precisely because it has
#                       three separate ways to happen.
#   orphan_suspension — the card is out of the deck with no adopted verdict
#                       anywhere to account for it. A card silently stops being
#                       asked and nothing can say why. This is the worse one:
#                       the user cannot see it happen.
#
# WHAT IS DELIBERATELY NOT ASSERTED: the VALUE of suspended_at. The trigger
# writes the verdict's own timestamp and the backfill writes the earliest
# adopted verdict for the lesson; they agree on first adoption, which is the
# only case that can arise. A drifting timestamp would be wrong but would not
# put a card back in or out of the deck, and a check that asserts more than it
# can justify gets disabled the first time it is noisy.
#
# Usage:
#   ./scripts/check-suspension-drift.sh "<postgres-url>"
#   ./scripts/check-suspension-drift.sh --self-test "<postgres-url>"
#
# --self-test proves it can FAIL before anyone trusts it passing: it injects one
# row of each direction inside a transaction it ROLLS BACK, and reports how many
# rows each injection touched. A zero-touched injection is a COVERAGE GAP and
# exits 1 — an unfired check is not evidence of anything.
set -uo pipefail

MODE="check"
if [ "${1:-}" = "--self-test" ]; then MODE="selftest"; shift; fi
URL="${1:-}"
[ -n "$URL" ] || { echo "usage: check-suspension-drift.sh [--self-test] <postgres-url>" >&2; exit 2; }

query() { psql "$URL" -X -q -t -A -F'|' -c "$1" </dev/null 2>&1; }

# `adopted_lessons` is the authority both directions are measured against: the
# log, never the column being checked. A check whose control is derived from
# its own subject is not a check.
DRIFT_SQL="
  with adopted_lessons as (
    select distinct p.user_id, p.lesson_id
      from public.lesson_promotions p
      join public.lesson_verdicts v on v.promotion_id = p.id and v.user_id = p.user_id
     where v.verdict = 'adopted'
  )
  select
    (select count(*) from public.cards c
      join adopted_lessons a on a.user_id = c.user_id and a.lesson_id = c.lesson_id
     where c.suspended_at is null),
    (select count(*) from public.cards c
      where c.suspended_at is not null
        and not exists (select 1 from adopted_lessons a
                         where a.user_id = c.user_id and a.lesson_id = c.lesson_id)),
    (select count(*) from public.cards);"

report() {
  echo "  ${4}: cards=${3} missed_suspension=${1} orphan_suspension=${2}"
}

if [ "$MODE" = "selftest" ]; then
  echo "check-suspension-drift --self-test: proving both directions can go RED."
  OUT=$(psql "$URL" -X -q -t -A -F'|' -v ON_ERROR_STOP=1 </dev/null 2>&1 <<SQL
begin;

-- Direction 1: an adopted lesson whose card is back in the deck. Reproduces
-- the re-ingest hole (a card recreated for an adopted lesson) rather than
-- pretending the triggers are absent.
with inj as (
  update public.cards c set suspended_at = null, suspended_reason = null
   where c.id = (select c2.id from public.cards c2 where c2.suspended_at is not null
     and exists (select 1 from public.lesson_promotions p
                  join public.lesson_verdicts v on v.promotion_id = p.id and v.user_id = p.user_id
                 where p.user_id = c2.user_id and p.lesson_id = c2.lesson_id and v.verdict = 'adopted')
     limit 1)
   returning 1)
select 'missed_injected=' || count(*) from inj;

-- Direction 2: a card out of the deck with nothing in the log to account for
-- it. Both columns are written together because cards_suspension_pair refuses
-- a half-set pair -- the CHECK is doing its job even inside the self-test.
with inj as (
  update public.cards c set suspended_at = now(), suspended_reason = 'promotion_adopted'
   where c.id = (select c2.id from public.cards c2 where c2.suspended_at is null
     and not exists (select 1 from public.lesson_promotions p
                      join public.lesson_verdicts v on v.promotion_id = p.id and v.user_id = p.user_id
                     where p.user_id = c2.user_id and p.lesson_id = c2.lesson_id and v.verdict = 'adopted')
     limit 1)
   returning 1)
select 'orphan_injected=' || count(*) from inj;

${DRIFT_SQL}
rollback;
SQL
)
  echo "$OUT" | grep -E '^(orphan|missed)_injected=' | sed 's/^/  /'
  MISSED_IN=$(echo "$OUT" | sed -n 's/^missed_injected=//p' | tail -1)
  ORPHAN_IN=$(echo "$OUT" | sed -n 's/^orphan_injected=//p' | tail -1)
  LINE=$(echo "$OUT" | grep -E '^[0-9]+\|[0-9]+\|[0-9]+$' | tail -1)
  MISSED=$(echo "$LINE" | cut -d'|' -f1); ORPHAN=$(echo "$LINE" | cut -d'|' -f2); TOTAL=$(echo "$LINE" | cut -d'|' -f3)
  report "${MISSED:-?}" "${ORPHAN:-?}" "${TOTAL:-?}" "with drift injected (rolled back)"

  if [ "${MISSED_IN:-0}" -lt 1 ] || [ "${ORPHAN_IN:-0}" -lt 1 ]; then
    echo "SELF-TEST INCONCLUSIVE: this database could not supply both injections" >&2
    echo "  (missed_injected=${MISSED_IN:-0} orphan_injected=${ORPHAN_IN:-0})." >&2
    echo "  That is a COVERAGE GAP, not a pass. It needs at least one card on an" >&2
    echo "  adopted lesson AND one card on a lesson with no adopted verdict." >&2
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
  echo "  Subject: cards.suspended_at" >&2
  echo "  Raw output follows -- a missing table or column reads as a query error here," >&2
  echo "  which is the honest result; it is not a pass." >&2
  query "$DRIFT_SQL" | sed 's/^/    /' >&2
  exit 1
fi

if [ "${TOTAL:-0}" -eq 0 ]; then
  echo "NOTE: zero cards exist. A clean result about an EMPTY table is not" >&2
  echo "  evidence the invariant holds under data. Re-run once cards exist." >&2
  exit 0
fi
if [ "${MISSED:-1}" -eq 0 ] && [ "${ORPHAN:-1}" -eq 0 ]; then
  echo "OK: suspension agrees with the verdict log in both directions."
  exit 0
fi
echo "DRIFT: cards.suspended_at disagrees with lesson_verdicts. See this file's header for what each direction means." >&2
exit 1
