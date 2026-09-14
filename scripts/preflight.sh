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
VITEST_JSON=/tmp/preflight-vitest.json
rm -f "$VITEST_JSON"
npx vitest run --reporter=default --reporter=json --outputFile.json="$VITEST_JSON" </dev/null > /tmp/preflight-vitest.log 2>&1
record $? "vitest"
grep -E "Test Files|Tests " /tmp/preflight-vitest.log | tail -2 | sed 's/^/  /'

# A green suite is also what you get when tests are silently skipped -- but an
# ACCIDENTAL new skip and a single NAMED, deliberately-gated one (an explicit env
# var a human turned off on purpose, documented at its own describe.skipIf) are not
# the same failure and must not be reported as if they were. Distinguish them by
# EXACT identity (file :: full test name), never a loose pattern or a bare count --
# a fuzzy match here is exactly the "assertion that checks the things you thought to
# name" shape this repo has already been burned by.
#
# Add an entry below ONLY for a skip a human has reviewed and decided is safe to
# leave un-run by default (see the test's own comment for why). Every entry names
# exactly ONE test. A skip appearing ANYWHERE else still fails this script.
ALLOWED_SKIPS=(
  "lib/ai/__tests__/dev-provider-injection.test.ts::R22 gate 1 — a document cannot act on this machine produces no file, shell or network effect"
)

if [ ! -f "$VITEST_JSON" ]; then
  echo "  FAIL: no JSON report at $VITEST_JSON -- cannot audit for skips, so this does not count as a pass"
  FAILED+=("vitest-skip-audit-missing")
else
  node -e '
    const fs = require("fs");
    const reportPath = process.argv[1];
    const root = process.argv[2].endsWith("/") ? process.argv[2] : process.argv[2] + "/";
    const allowed = new Set(process.argv.slice(3));
    let report;
    try {
      report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    } catch (e) {
      console.log("  FAIL: could not parse vitest JSON report: " + e.message);
      process.exit(1);
    }
    const skipped = [];
    for (const file of report.testResults || []) {
      const rel = file.name.startsWith(root) ? file.name.slice(root.length) : file.name;
      for (const t of file.assertionResults || []) {
        if (t.status === "skipped" || t.status === "pending" || t.status === "todo") {
          skipped.push(rel + "::" + t.fullName);
        }
      }
    }
    if (skipped.length === 0) {
      console.log("  no skipped tests");
      process.exit(0);
    }
    console.log("  skipped test(s) found:");
    for (const s of skipped) console.log("    " + s);
    const unexpected = skipped.filter((s) => !allowed.has(s));
    if (unexpected.length > 0) {
      console.log("  FAIL: unexpected skip(s), not on the ALLOWED_SKIPS list in this script:");
      for (const s of unexpected) console.log("    " + s);
      process.exit(1);
    }
    console.log("  all skip(s) are named on the allowlist (reviewed, deliberate)");
    process.exit(0);
  ' "$VITEST_JSON" "$(pwd)" "${ALLOWED_SKIPS[@]}"
  record $? "vitest-skips"
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

  step "applied-migration tracking, on disk and in git (self-tested first)"
  ./scripts/check-applied-migrations-tracked.sh --self-test "$DB_URL" </dev/null >/dev/null 2>&1
  if [ $? -ne 0 ]; then echo "  FAIL: this check cannot detect an applied-but-untracked migration file"; FAILED+=("applied-migrations-tracked-selftest");
  else echo "  self-test fires"; ./scripts/check-applied-migrations-tracked.sh "$DB_URL" </dev/null | sed 's/^/  /'; record ${PIPESTATUS[0]} "check-applied-migrations-tracked"; fi

  step "FK tenancy -- single-column FKs to user-scoped parents (self-tested first)"
  ./scripts/check-fk-tenancy.sh --self-test "$DB_URL" </dev/null >/dev/null 2>&1
  if [ $? -ne 0 ]; then echo "  FAIL: this check cannot detect a single-column FK to a user-scoped parent"; FAILED+=("fk-tenancy-selftest");
  else echo "  self-test fires"; ./scripts/check-fk-tenancy.sh "$DB_URL" </dev/null | sed 's/^/  /'; record ${PIPESTATUS[0]} "check-fk-tenancy"; fi

  step "lesson_promotions.retired_at vs. lesson_verdicts (self-tested first)"
  ./scripts/check-retired-at-drift.sh --self-test "$DB_URL" </dev/null >/dev/null 2>&1
  if [ $? -ne 0 ]; then echo "  FAIL: this check cannot detect injected retired_at drift"; FAILED+=("retired-at-drift-selftest");
  else echo "  self-test fires"; ./scripts/check-retired-at-drift.sh "$DB_URL" </dev/null | sed 's/^/  /'; record ${PIPESTATUS[0]} "check-retired-at-drift"; fi

  step "cards.suspended_at vs. lesson_verdicts (self-tested first)"
  ./scripts/check-suspension-drift.sh --self-test "$DB_URL" </dev/null >/dev/null 2>&1
  if [ $? -ne 0 ]; then echo "  FAIL: this check cannot detect injected suspension drift"; FAILED+=("suspension-drift-selftest");
  else echo "  self-test fires"; ./scripts/check-suspension-drift.sh "$DB_URL" </dev/null | sed 's/^/  /'; record ${PIPESTATUS[0]} "check-suspension-drift"; fi

  step "scarcity indexes are actually UNIQUE, not just present (self-tested first)"
  ./scripts/check-scarcity-indexes.sh --self-test "$DB_URL" </dev/null >/dev/null 2>&1
  if [ $? -ne 0 ]; then echo "  FAIL: this check cannot detect a non-unique index wearing a scarcity index's name"; FAILED+=("scarcity-indexes-selftest");
  else echo "  self-test fires"; ./scripts/check-scarcity-indexes.sh "$DB_URL" </dev/null | sed 's/^/  /'; record ${PIPESTATUS[0]} "check-scarcity-indexes"; fi

  step "vocabulary drift -- two DB objects encoding one concept with different spellings (self-tested first)"
  ./scripts/check-vocabulary-drift.sh --self-test "$DB_URL" </dev/null >/dev/null 2>&1
  if [ $? -ne 0 ]; then echo "  FAIL: this check cannot detect a planted near-identical value-set pair"; FAILED+=("vocabulary-drift-selftest");
  else echo "  self-test fires"; ./scripts/check-vocabulary-drift.sh "$DB_URL" </dev/null | sed 's/^/  /'; record ${PIPESTATUS[0]} "check-vocabulary-drift"; fi

  step "scheduler cache (card_states) vs. FSRS replay over reviews -- NO self-test here, on purpose"
  # check-scheduler-cache-drift.sh's own --self-test writes REAL fixture rows
  # (auth.users/books/lessons/cards/reviews/card_states) and refuses to run
  # against anything that doesn't look like scratch/localhost unless forced
  # with --i-know-this-writes -- Mode 3's corruption is a real INSERT into the
  # append-only `reviews` log that the script itself says is never cleaned up.
  # Every other self-test in this section proves itself inside a rolled-back
  # transaction; this one cannot, so it stays a manual, scratch-only tool and
  # only the read-only live replay runs here.
  ./scripts/check-scheduler-cache-drift.sh "$DB_URL" </dev/null | sed 's/^/  /'; record ${PIPESTATUS[0]} "check-scheduler-cache-drift"

  # NOT wired, reported to the Lead instead of wired red-on-day-one:
  #   check-migrations-applied.sh    -- currently FAILS on this database (a real
  #                                      unapplied migration found live); wiring
  #                                      a check that's red from the start trains
  #                                      everyone to ignore preflight.
  #   check-function-replaced.sh     -- self-test passes, but it has no generic
  #                                      "check the whole schema" mode: it is a
  #                                      per-migration snapshot/verify tool that
  #                                      needs a function name and a prior md5,
  #                                      supplied by whoever wrote that migration.
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
