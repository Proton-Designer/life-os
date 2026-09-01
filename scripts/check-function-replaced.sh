#!/bin/bash
# check-function-replaced.sh — verify a CREATE OR REPLACE FUNCTION migration
# actually replaced the function, and didn't silently drop a prior fix.
#
# WHY THIS EXISTS (2026-09-01, docs/specs/convergence-coverage.md §6, ULM repo)
#
# `submit_review` has been redefined five times (078 -> 080 -> 081 -> 085 ->
# 088), each time additively. Verifying a redefinition landed correctly is
# harder than it looks — a hand-written marker query failed at it three
# separate ways in one afternoon:
#
#   1. A loose substring marker (`ilike '%deleted%'`) matched a COMMENT
#      explaining a fix, not just the fix itself — a body where only the
#      comment survived would still read PRESENT.
#   2. `where proname = 'x'` returns one row per OVERLOAD. If a redefinition
#      shifts the signature (CREATE OR REPLACE cannot replace across a
#      signature change — it overloads), a second function can hide behind
#      the first one's row.
#   3. 🔴 THE WORST ONE: every marker, the count, the arity — all of it reads
#      exactly as PASSING against the OLD body if the migration silently
#      never ran, or ran and no-op'd. A no-op passes every assertion that
#      only checks "are the good parts still there." Verifying a replacement
#      needs one assertion that the body actually CHANGED, not only that the
#      prior fixes survived.
#
# THE FIX: a two-phase snapshot/verify workflow. Take an md5 of the function
# body BEFORE applying a migration; after applying, assert the md5 DIFFERS
# (case 3), assert exactly one function exists (case 2), and assert every
# required marker string is present (case 1, using a marker specific enough
# not to appear in a comment explaining it — see convergence-coverage.md §6
# on choosing `%book_is_deleted%` over `%deleted%`).
#
# Usage:
#   check-function-replaced.sh <db-url> <fn-name> --snapshot
#     Prints `snapshot: <fn-name> md5=<md5> arity=<n>`. Run BEFORE applying
#     the migration. Save the md5 (e.g. into a shell variable) for --verify.
#
#   check-function-replaced.sh <db-url> <fn-name> --verify <prior-md5> [--must-contain <str>]...
#     Run AFTER applying the migration. Fails (exit 1) if: more than one
#     function of that name exists; the new md5 equals <prior-md5> (the
#     no-op case); or any --must-contain string is missing from the body.
#     Prints the new md5 and arity on success.
#
#   check-function-replaced.sh --self-test <db-url>
#     Injects a throwaway function, replaces it with a byte-identical body
#     (must report NO-OP — this is the failure mode nothing else caught),
#     then with a genuinely different body (must report CHANGED), then an
#     overloaded second signature (must report NOT-EXACTLY-ONE), all in one
#     session, rolled back at the end. See _function-replaced-selftest.sql.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

usage() {
  echo "usage:" >&2
  echo "  check-function-replaced.sh <db-url> <fn-name> --snapshot" >&2
  echo "  check-function-replaced.sh <db-url> <fn-name> --verify <prior-md5> [--must-contain <str>]..." >&2
  echo "  check-function-replaced.sh --self-test <db-url>" >&2
  exit 2
}

query() { psql "$1" -X -q -t -A </dev/null -c "$2"; }

if [ "${1:-}" = "--self-test" ]; then
  URL="${2:-}"
  [ -n "$URL" ] || usage
  echo "SELF-TEST: injecting a throwaway function, then a byte-identical redefinition (must"
  echo "report NO-OP), then a genuinely different one (must report CHANGED), then an"
  echo "overloaded second signature (must report NOT-EXACTLY-ONE) — one session, rolled back."
  OUT="$(psql "$URL" -X -q -t -A -f scripts/_function-replaced-selftest.sql </dev/null 2>&1)"
  FAIL=0
  if echo "$OUT" | grep -q '^NOOP: DETECTED$'; then
    echo "  OK  no-op redefinition (identical body) correctly detected — this is the case a plain marker check cannot see."
  else
    echo "  FAIL  no-op redefinition was NOT detected — the exact failure mode this script exists to catch." >&2
    FAIL=1
  fi
  if echo "$OUT" | grep -q '^CHANGE: DETECTED$'; then
    echo "  OK  a genuinely different body correctly detected as changed."
  else
    echo "  FAIL  a genuinely different body was NOT detected as changed." >&2
    FAIL=1
  fi
  if echo "$OUT" | grep -q '^MUST_CONTAIN_PRESENT: DETECTED$'; then
    echo "  OK  a marker actually present in the new body is correctly found."
  else
    echo "  FAIL  a marker actually present in the new body was NOT found." >&2
    FAIL=1
  fi
  if echo "$OUT" | grep -q '^MUST_CONTAIN_MISSING: DETECTED$'; then
    echo "  OK  a marker NOT present in the new body is correctly reported missing."
  else
    echo "  FAIL  a marker not present in the new body was NOT flagged as missing." >&2
    FAIL=1
  fi
  if echo "$OUT" | grep -q '^OVERLOAD: DETECTED$'; then
    echo "  OK  a second, differently-signatured function of the same name is correctly detected (count <> 1)."
  else
    echo "  FAIL  an overloaded second function was NOT detected." >&2
    FAIL=1
  fi
  if [ "$FAIL" -eq 0 ]; then
    echo "SELF-TEST PASSED — all five failure modes are detectable. It is now safe to trust a green from this script."
    exit 0
  fi
  echo "SELF-TEST FAILED — see above. This check cannot be trusted until every case is detected." >&2
  echo "$OUT" >&2
  exit 1
fi

URL="${1:-}"
FN="${2:-}"
MODE="${3:-}"
[ -n "$URL" ] && [ -n "$FN" ] && [ -n "$MODE" ] || usage

case "$MODE" in
  --snapshot)
    COUNT="$(query "$URL" "select count(*) from pg_proc where proname = '$FN'")"
    if [ "$COUNT" != "1" ]; then
      echo "SNAPSHOT FAILED: expected exactly 1 function named $FN, found $COUNT" >&2
      exit 1
    fi
    MD5="$(query "$URL" "select md5(pg_get_functiondef(oid)) from pg_proc where proname = '$FN'")"
    ARITY="$(query "$URL" "select pronargs from pg_proc where proname = '$FN'")"
    echo "snapshot: $FN md5=$MD5 arity=$ARITY"
    ;;

  --verify)
    PRIOR_MD5="${4:-}"
    [ -n "$PRIOR_MD5" ] || usage
    shift 4 || usage
    MUST_CONTAIN=()
    while [ $# -gt 0 ]; do
      case "${1:-}" in
        --must-contain)
          [ -n "${2:-}" ] || usage
          MUST_CONTAIN+=("$2")
          shift 2
          ;;
        *) usage ;;
      esac
    done

    COUNT="$(query "$URL" "select count(*) from pg_proc where proname = '$FN'")"
    if [ "$COUNT" != "1" ]; then
      echo "FAIL: expected exactly 1 function named $FN, found $COUNT" >&2
      echo "  -> CREATE OR REPLACE overloads rather than replaces when the signature shifts;" >&2
      echo "     a second function of this name means a caller resolving the old signature" >&2
      echo "     can still reach the old body." >&2
      exit 1
    fi

    DEF="$(query "$URL" "select pg_get_functiondef(oid) from pg_proc where proname = '$FN'")"
    NEW_MD5="$(query "$URL" "select md5(pg_get_functiondef(oid)) from pg_proc where proname = '$FN'")"
    ARITY="$(query "$URL" "select pronargs from pg_proc where proname = '$FN'")"

    FAIL=0
    if [ "$NEW_MD5" = "$PRIOR_MD5" ]; then
      echo "FAIL: $FN's body is IDENTICAL to the pre-migration snapshot (md5=$NEW_MD5)." >&2
      echo "  -> the migration did not actually run, or ran and made no change. A no-op" >&2
      echo "     passes every other assertion this script makes — this is the one check" >&2
      echo "     that catches it." >&2
      FAIL=1
    fi
    for needle in "${MUST_CONTAIN[@]:-}"; do
      [ -n "$needle" ] || continue
      if ! printf '%s' "$DEF" | grep -qF -- "$needle"; then
        echo "FAIL: $FN is missing required marker: $needle" >&2
        FAIL=1
      fi
    done
    if [ "$FAIL" -eq 1 ]; then
      exit 1
    fi
    echo "OK: $FN replaced (md5 $PRIOR_MD5 -> $NEW_MD5), arity=$ARITY, all ${#MUST_CONTAIN[@]} marker(s) present."
    ;;

  *) usage ;;
esac
