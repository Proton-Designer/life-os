#!/usr/bin/env bash
# check-applied-migrations-tracked.sh — every APPLIED migration must exist on
# disk AND be tracked in git.
#
# WHY THIS EXISTS. On 2026-09-02 migration `112` was applied to production and
# lived on exactly one machine's disk, untracked, for over an hour. The ledger
# referenced a file nobody else had; losing that laptop would have left
# production in a state whose migration could not be read.
#
# Nothing could see it. `apply-migration.sh` records the ledger row and does not
# care about git. `git status` shows it as one `??` line among many legitimate
# in-flight files. And the check its author reached for -- `git diff <file>` --
# prints NOTHING for an untracked file, so it read as clean: vacuous in the
# PASSING direction, the same shape as an UPDATE matching zero rows.
#
# The cause was mundane: agent-commit.sh takes explicit paths, which is right
# for a shared tree, and a path you forget is a path that silently does not go
# in. The commit succeeds, the diff looks correct, and the file it was about is
# absent.
#
# Usage:  ./scripts/check-applied-migrations-tracked.sh "<postgres-url>"
#         ./scripts/check-applied-migrations-tracked.sh --self-test "<postgres-url>"
set -uo pipefail

MODE="check"
if [ "${1:-}" = "--self-test" ]; then MODE="selftest"; shift; fi
URL="${1:-}"
[ -n "$URL" ] || { echo "usage: check-applied-migrations-tracked.sh [--self-test] <postgres-url>" >&2; exit 2; }

REPO="$(git rev-parse --show-toplevel)"
cd "$REPO"

APPLIED="$(psql "$URL" -X -q -t -A </dev/null -c "select filename from public.migration_ledger order by filename;" 2>&1)"
case "$APPLIED" in *ERROR*|"") echo "could not read the ledger: $APPLIED" >&2; exit 2;; esac

echo "applied-migration tracking check"
FAIL=0
COUNT=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  COUNT=$((COUNT + 1))
  path="supabase/migrations/$f"
  if [ ! -f "$path" ]; then
    printf '  FAIL %-52s APPLIED but MISSING FROM DISK\n' "$f"; FAIL=1; continue
  fi
  if ! git ls-files --error-unmatch "$path" >/dev/null 2>&1; then
    printf '  FAIL %-52s APPLIED but UNTRACKED — exists only on this disk\n' "$f"; FAIL=1; continue
  fi
done <<< "$APPLIED"

if [ "$MODE" = "selftest" ]; then
  echo
  echo "SELF-TEST: an applied-but-untracked file must be detected."
  probe="supabase/migrations/_selftest_untracked_probe.sql"
  printf -- '-- self-test probe\n' > "$probe"
  # Simulate: a ledger name that exists on disk but is not in git.
  if git ls-files --error-unmatch "$probe" >/dev/null 2>&1; then
    echo "SELF-TEST INCONCLUSIVE — probe is tracked" >&2; rm -f "$probe"; exit 1
  fi
  rm -f "$probe"
  echo "SELF-TEST PASSED — `git ls-files --error-unmatch` reports non-zero for an untracked path,"
  echo "which is the predicate this check is built on."
  exit 0
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "OK — all $COUNT applied migrations are on disk and tracked in git."
  exit 0
fi
echo "FAILED — an applied migration is not reproducible from the repository." >&2
exit 1
