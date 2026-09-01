#!/bin/bash
# check-migrations-applied.sh — answer two questions nobody could answer today:
#   1. Which migrations on disk are NOT on this database?  ("is the queue drained?")
#   2. Do two databases have the same migrations applied?   ("is scratch a proxy for prod?")
#
# WHY BOTH (2026-09-01)
#
# (1) ULM's 086 fixed a PROVEN cross-tenant denial of service. It sat
#     scratch-verified and unapplied on production for hours, because deploys
#     gate on one person and nothing reported the backlog. It was found by
#     accident while auditing something else. Nobody was careless — the state
#     was not observable.
#
# (2) Later the same afternoon the drift reversed: 100/101 went to production
#     and not to scratch, silently breaking the equivalence that ULM's entire
#     "verified against scratch" claim rested on. Every check still passed on
#     both, because the divergence touched tables their checks didn't cover.
#     Same shape as a stale build or types generated against the wrong database:
#     the artifact is accurate about a DIFFERENT WORLD, and stays convincing
#     because it isn't wrong about anything you'd think to check.
#
# NOT supabase_migrations.schema_migrations — that is the CLI's, and it is
# vestigial here (34 rows, last written 2026-08-20) because we apply by hand.
# It would have answered "nothing new since August 20th" on a database that had
# taken thirty migrations since. A stale ledger answers confidently and wrongly.
#
# Usage: ./scripts/check-migrations-applied.sh <url> [--compare <url2>]
#        ./scripts/check-migrations-applied.sh --self-test <url>

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

SELFTEST=0
if [ "${1:-}" = "--self-test" ]; then SELFTEST=1; shift; fi
URL="${1:-}"; shift || true
OTHER=""
[ "${1:-}" = "--compare" ] && { OTHER="${2:-}"; }
[ -n "$URL" ] || { echo "usage: check-migrations-applied.sh <url> [--compare <url2>]" >&2; exit 2; }

md5of() { md5 -q "$1" 2>/dev/null || md5sum "$1" | cut -d' ' -f1; }

if [ "$SELFTEST" = "1" ]; then
  # Create a REAL migration file that is genuinely not applied, and confirm the
  # checker reports it. A checker that cannot see an unapplied migration is the
  # exact failure this tool exists to prevent, and it would look identical to a
  # clean run.
  CANARY="supabase/migrations/999_selftest_canary.sql"
  echo "-- self-test canary; never applied" > "$CANARY"
  OUT="$("$0" "$URL" 2>&1)"
  rm -f "$CANARY"
  if echo "$OUT" | grep -q '999_selftest_canary.sql'; then
    echo "SELF-TEST PASSED — an unapplied migration is detected. Canary removed."; exit 0
  fi
  echo "SELF-TEST FAILED — an unapplied migration was NOT detected." >&2
  echo "$OUT" >&2; exit 1
fi

LEDGER="$(psql "$URL" -X -q -t -A </dev/null -c \
  "select filename||' '||md5||' '||status from public.migration_ledger;" 2>/dev/null)"
if [ -z "$LEDGER" ]; then
  echo "No migration_ledger on this database (migration 102 not applied?)." >&2; exit 2
fi

FAIL=0
echo "migration ledger check"

UNAPPLIED=""; EDITED=""
for f in supabase/migrations/*.sql; do
  n="$(basename "$f")"
  row="$(echo "$LEDGER" | grep "^$n " || true)"
  if [ -z "$row" ]; then UNAPPLIED="$UNAPPLIED$n\n"; continue; fi
  echo "$row" | grep -q " skipped$" && continue
  [ "$(echo "$row" | awk '{print $2}')" = "$(md5of "$f")" ] || EDITED="$EDITED$n\n"
done

if [ -n "$UNAPPLIED" ]; then
  echo "  UNAPPLIED — on disk, not on this database:"
  printf "$UNAPPLIED" | sed 's/^/    + /'
  echo "    -> apply with ./scripts/apply-migration.sh, or record as 'skipped' with a reason."
  FAIL=1
fi
if [ -n "$EDITED" ]; then
  echo "  EDITED AFTER APPLY — the file no longer matches what built this database:"
  printf "$EDITED" | sed 's/^/    ! /'
  echo "    -> write a NEW migration. Never re-run an edited one."
  FAIL=1
fi

if [ -n "$OTHER" ]; then
  echo "  parity with second database:"
  A="$(psql "$URL"   -X -q -t -A </dev/null -c "select filename from public.migration_ledger where status<>'skipped' order by 1;" 2>/dev/null)"
  B="$(psql "$OTHER" -X -q -t -A </dev/null -c "select filename from public.migration_ledger where status<>'skipped' order by 1;" 2>/dev/null)"
  ONLY_A="$(comm -23 <(echo "$A") <(echo "$B") | grep -v '^$' || true)"
  ONLY_B="$(comm -13 <(echo "$A") <(echo "$B") | grep -v '^$' || true)"
  if [ -z "$ONLY_A" ] && [ -z "$ONLY_B" ]; then
    echo "    in sync — both databases have the same migrations applied."
  else
    [ -n "$ONLY_A" ] && { echo "    only on FIRST:";  echo "$ONLY_A"  | sed 's/^/      < /'; }
    [ -n "$ONLY_B" ] && { echo "    only on SECOND:"; echo "$ONLY_B" | sed 's/^/      > /'; }
    echo "    -> the two have diverged. 'Verified on one' implies nothing about the other."
    FAIL=1
  fi
fi

[ "$FAIL" -eq 0 ] && { echo "  OK — every migration on disk is accounted for."; exit 0; }
exit 1
