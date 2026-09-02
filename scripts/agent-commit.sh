#!/usr/bin/env bash
# Serialized commit for a shared working tree.
#
# WHY THIS EXISTS
# ---------------
# Several agents edit ONE working tree with ONE .git directory, which means
# they share ONE index. Both obvious commit strategies race:
#
#   git commit -m "msg" -- <paths>     ignores the index entirely and commits
#                                      WORKING-TREE state, so another agent's
#                                      unsaved edit to a file you own rides
#                                      along. (Incident: 87119ee.)
#
#   git add <paths>; git commit        reads the index at commit time. Another
#                                      agent staging in the gap between your
#                                      `git add` and your `git commit` puts
#                                      THEIR files in YOUR commit.
#                                      (Incident: 631a921 swept day-ribbon.tsx.)
#
# The second is strictly better but still not safe, because the index is shared
# mutable state. The fix is to make stage+commit ATOMIC with respect to other
# agents. This script does that with a mkdir-based mutex (atomic on every POSIX
# filesystem; macOS has no flock).
#
# USAGE
#   scripts/agent-commit.sh "commit message" path [path...]
#
#   EXPLICIT FILE PATHS ONLY. Never a directory.
#
# CORRECTED 2026-09-02. This header previously read: "It will refuse to commit
# if the staged set does not exactly match the paths you asked for — that is
# the whole point, so do not 'fix' that check."
#
# THAT CHECK DID NOT EXIST. The script computed the staged set and asserted only
# that it was non-empty. Found by the CollegeOS lead reading the source and
# proving it in a throwaway repo rather than reasoning about it.
#
# The promise was not harmless. A directory argument (`lib/`) expands under
# `git add --`, sweeping every changed file beneath it — including another
# agent's in-flight work — into your commit. That is precisely incident
# 631a921, the thing this script was written to prevent, and the mutex cannot
# help: the other agent's edit is already in the shared WORKING TREE, not in
# the index we serialise access to.
#
# Worse than a missing check: a comment asserting a guarantee is a claim a
# careful reader stops and relies on. It spends the attention of exactly the
# person who was trying to be careful. A claim about behaviour belongs in a
# test or an assertion — never in prose nobody re-runs.
#
# The check is now implemented below and this header describes what it does.

set -euo pipefail

LOCK_DIR="$(git rev-parse --git-dir)/agent-commit.lock"
TIMEOUT_SECONDS=120

if [ "$#" -lt 2 ]; then
  echo "usage: $0 \"commit message\" path [path...]" >&2
  exit 2
fi

MESSAGE="$1"
shift
PATHS=("$@")

# Reject directories BEFORE taking the lock or touching the index — a refused
# invocation must leave the shared index exactly as it found it. `git add -- lib/`
# stages every changed file underneath, which is how another agent's in-flight
# work ends up inside your commit (incident 631a921).
for _p in "${PATHS[@]}"; do
  if [ -d "$_p" ]; then
    echo "REFUSING: '$_p' is a directory." >&2
    echo "  Pass explicit FILE paths. A directory stages every changed file beneath" >&2
    echo "  it, including work belonging to other agents in this shared tree." >&2
    exit 2
  fi
done

waited=0
until mkdir "$LOCK_DIR" 2>/dev/null; do
  if [ "$waited" -ge "$TIMEOUT_SECONDS" ]; then
    echo "ERROR: could not acquire commit lock after ${TIMEOUT_SECONDS}s." >&2
    echo "Another agent may have died holding it. Check, then: rmdir '$LOCK_DIR'" >&2
    exit 1
  fi
  sleep 1
  waited=$((waited + 1))
done
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

# Nobody else can stage or commit between here and the commit below.

# Start from a clean index so a previous agent's leftover staging cannot ride
# along. This touches the INDEX ONLY — it never modifies the working tree, so
# no one's uncommitted edits are at risk.
git reset --quiet

git add -- "${PATHS[@]}"

STAGED="$(git diff --cached --name-only | sort)"
if [ -z "$STAGED" ]; then
  echo "Nothing staged for: ${PATHS[*]}" >&2
  exit 1
fi

# The check the header used to promise: the staged set must be exactly the
# requested set. Catches a glob that matched more than intended, a rename
# staging both sides, and anything else that expands past what was asked for.
REQUESTED="$(printf '%s\n' "${PATHS[@]}" | sed 's#^\./##' | sort -u)"
EXTRA="$(comm -23 <(printf '%s\n' "$STAGED") <(printf '%s\n' "$REQUESTED") || true)"
if [ -n "$EXTRA" ]; then
  echo "REFUSING: the staged set does not match the paths you asked for." >&2
  echo "  Staged but not requested:" >&2
  printf '%s\n' "$EXTRA" | sed 's/^/    + /' >&2
  echo "  In a shared working tree this is usually another agent's work." >&2
  echo "  Re-run with explicit file paths. Index left staged for inspection." >&2
  exit 3
fi

echo "--- staged (exactly what will be committed) ---"
git diff --cached --stat
echo "----------------------------------------------"

git commit --quiet -m "$MESSAGE"
git --no-pager log --oneline -1
