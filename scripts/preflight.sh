#!/bin/bash
# preflight.sh — every DURABLE check, in one command, before a deploy.
#
# WHY THIS EXISTS (D-041, 2026-09-01)
#
# The convergence produced a great deal of excellent verification that ran
# exactly once and left nothing behind: append-only proven across four roles
# including service_role, concurrent duplicate submits resolved with two
# genuinely parallel psql processes, constraint boundaries checked against real
# seeded rows, a generated column proven unwritable by application code. All
# real. None of it will ever run again.
#
# The moment someone edits the code those proofs covered, none of them re-run —
# and that is exactly the moment nobody thinks to re-verify by hand.
#
# So the rule this script encodes: **a proof that cannot re-run is a
# demonstration, not a regression signal.** Anything worth proving twice belongs
# here or in the unit/e2e suites. Anything genuinely one-off should be *called*
# one-off, out loud, rather than quietly assumed to be covered.
#
# HONEST SCOPE — what this does NOT cover, stated so nobody mistakes a green
# here for "everything is verified":
#   * The core-loop SQL RPCs (start_session, submit_review, complete_session).
#     ULM's smoke harnesses are the right home for those and are being ported.
#   * Anything requiring a real browser — that is `npx playwright test`, run
#     separately and against a PRODUCTION build (see below).
#
# Usage:
#   ./scripts/preflight.sh                       # code checks only
#   ./scripts/preflight.sh "<postgres-url>"      # code + database checks

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
DB_URL="${1:-}"
FAILED=()

step() { printf "\n\033[1m== %s ==\033[0m\n" "$1"; }
record() { if [ "$1" -eq 0 ]; then echo "  PASS"; else echo "  FAIL"; FAILED+=("$2"); fi; }

step "typecheck"
# NOT piped to head/tail. `npx tsc | head` reports HEAD's exit code, which is
# always 0 — that mistake was made twice today and reported as "tsc clean" both
# times. Capture the real status.
npx tsc --noEmit </dev/null > /tmp/preflight-tsc.log 2>&1
record $? "tsc"
grep -c "error TS" /tmp/preflight-tsc.log | sed 's/^/  errors: /'

step "unit tests"
npx vitest run </dev/null > /tmp/preflight-vitest.log 2>&1
record $? "vitest"
grep -E "Test Files|Tests " /tmp/preflight-vitest.log | tail -2 | sed 's/^/  /'
# A green suite is also what you get when tests are silently skipped.
if grep -qE "[0-9]+ skipped" /tmp/preflight-vitest.log; then
  echo "  WARNING: skipped tests present — a green with skips is not a green"
  FAILED+=("vitest-skips")
fi

step "production build (the ONLY check that sees RSC boundary violations)"
npx next build </dev/null > /tmp/preflight-build.log 2>&1
record $? "next build"

if [ -n "$DB_URL" ]; then
  step "row-level security (self-tested first)"
  ./scripts/check-rls.sh --self-test "$DB_URL" </dev/null >/dev/null 2>&1
  if [ $? -ne 0 ]; then echo "  FAIL: the RLS check cannot detect an unprotected table"; FAILED+=("rls-selftest");
  else echo "  self-test fires"; ./scripts/check-rls.sh "$DB_URL" </dev/null | sed 's/^/  /'; record ${PIPESTATUS[0]} "check-rls"; fi

  step "enum / union drift (self-tested first)"
  ./scripts/check-enum-drift.sh --self-test "$DB_URL" </dev/null >/dev/null 2>&1
  if [ $? -ne 0 ]; then echo "  FAIL: the drift check cannot see injected drift"; FAILED+=("drift-selftest");
  else echo "  self-test fires"; ./scripts/check-enum-drift.sh "$DB_URL" </dev/null | sed 's/^/  /'; record ${PIPESTATUS[0]} "check-enum-drift"; fi
else
  step "database checks"
  echo "  SKIPPED — no postgres url given. This is NOT a pass."
fi

printf "\n\033[1m== result ==\033[0m\n"
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "All preflight checks passed."
  echo
  echo "STILL REQUIRED BEFORE DEPLOY, and not covered here:"
  echo "  npx playwright test        <- run against a PRODUCTION build, not next dev."
  echo "     next dev compiles routes on demand; under two browser projects that"
  echo "     exceeds the 30s timeout and produces goto/ERR_ABORTED failures that"
  echo "     look exactly like regressions. Build, next start, then run."
  exit 0
fi
echo "FAILED: ${FAILED[*]}"
exit 1
