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
# It will refuse to commit if the staged set does not exactly match the paths
# you asked for — that is the whole point, so do not "fix" that check.

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

echo "--- staged (exactly what will be committed) ---"
git diff --cached --stat
echo "----------------------------------------------"

git commit --quiet -m "$MESSAGE"
git --no-pager log --oneline -1
