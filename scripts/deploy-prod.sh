#!/bin/bash
# deploy-prod.sh — deploy the COMMITTED state, not the working tree.
#
# WHY (2026-09-01, after a failed production deploy)
#
# `vercel --prod` uploads the WORKING DIRECTORY. It does not care what is
# committed, what is staged, or what branch you are on. In a shared working
# tree — several agents editing one checkout — that means **deploying
# everyone's half-finished work**.
#
# It happened exactly that way: a deploy of my own commit failed on
#   lib/self-mastery/seed-meditations-deck.ts(44,46): error TS2345
# a file that was UNTRACKED, belonged to another agent, and was never in my
# commit. `tsc` and `next build` had both passed locally — because they also
# read the working tree, and the tree had the in-flight file plus the
# regenerated types it needed. **Three green checks, all reading the same dirty
# state, none of them describing what would actually ship.**
#
# This is the deploy-side twin of scripts/agent-commit.sh. The git index is not
# the only shared mutable resource; the working tree itself is one, and it is
# the thing `vercel` actually reads.
#
# So: check HEAD out into a throwaway worktree and deploy THAT. What ships is
# then exactly what is in git, which is the only version anyone can review,
# revert, or reason about.
#
# Usage: ./scripts/deploy-prod.sh [--token <vercel-token>]

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO="$PWD"

# Token precedence: explicit flag, then the PROJECT's own .env.local, then the
# ambient environment LAST.
#
# The first version of this script read $VERCEL_TOKEN first and failed with
# "Could not retrieve Project Settings" — because a STALE VERCEL_TOKEN is
# exported in the shell profile and silently outranked the project's real one.
# The same deploy run by hand, with the token pasted, worked. Two runs, two
# different credentials, and the failure message named the project rather than
# the auth, which sent me looking at .vercel/project.json instead.
#
# Ambient environment is the least trustworthy source here precisely because it
# is invisible: .env.local can be read, a flag is right there in the command,
# and an exported variable is neither.
TOKEN=""
[ "${1:-}" = "--token" ] && TOKEN="${2:-}"
[ -n "$TOKEN" ] || TOKEN="$(grep -E '^VERCEL_TOKEN=' .env.local 2>/dev/null | cut -d= -f2- | tr -d '"'"'"'\r')"
[ -n "$TOKEN" ] || TOKEN="${VERCEL_TOKEN:-}"
[ -n "$TOKEN" ] || { echo "no vercel token (--token, .env.local, or VERCEL_TOKEN)" >&2; exit 2; }

SHA="$(git rev-parse --short HEAD)"
DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"
echo "deploying HEAD $SHA"
[ "$DIRTY" != "0" ] && echo "  note: $DIRTY uncommitted path(s) in the tree — deliberately NOT shipping them."

WT="$(mktemp -d)/deploy-$SHA"
git worktree add --detach "$WT" HEAD >/dev/null 2>&1 || { echo "could not create worktree" >&2; exit 1; }
cleanup() { cd "$REPO"; git worktree remove --force "$WT" >/dev/null 2>&1; }
trap cleanup EXIT

# .env.local and .vercel are gitignored, so the clean checkout has neither.
cp "$REPO/.env.local" "$WT/" 2>/dev/null
cp -r "$REPO/.vercel" "$WT/" 2>/dev/null

cd "$WT"

# WORKING-TREE VERIFICATION IS MEANINGLESS HERE — read this before adding a gate.
#
# In a shared tree where engineers are told to write a FAILING TEST FIRST, a
# lead's `vitest`/`tsc` run reads the working tree, which legitimately contains
# other agents' deliberate reds. On 2026-09-02 a full-suite run showed
# "6 failed" and `next build` exited 1 — all of it one engineer's in-flight red
# for the sentinel split, none of it in HEAD, which passed 12/12 clean.
#
# The danger is not the noise. It is that the noise is indistinguishable from a
# real regression, so the honest reading of a red tree is "I cannot tell" while
# the tempting reading is "probably someone else's."
#
# I ADDED A tsc GATE HERE AND REMOVED IT AGAIN, which is worth recording:
# a fresh worktree has no `.next/types`, so `LayoutProps` is undefined and tsc
# fails on a perfectly healthy HEAD. A gate that cannot tell "HEAD is broken"
# from "the worktree lacks generated types" is worse than no gate — it produces
# a red nobody can act on, and it gets disabled the first time it blocks
# someone. Same shape as every false instrument in 05-HOW-THIS-TEAM-WORKS.md,
# built by the person who wrote that file, an hour after writing it.
#
# THE REAL HEAD GATE ALREADY EXISTS AND IS REMOTE: Vercel builds and typechecks
# the uploaded commit. A broken HEAD fails there and is never aliased, which is
# why the failed deploy earlier today never reached production. Don't duplicate
# it badly here. To check HEAD locally, build in a worktree (generating types)
# rather than typechecking one.

OUT="$(mktemp)"
npx vercel --prod --yes --token "$TOKEN" 2>&1 | tee "$OUT"
RC=${PIPESTATUS[0]}

# A NON-ZERO EXIT HERE DOES NOT MEAN THE DEPLOY FAILED.
#
# The CLI starts the build, then POLLS for completion. If that poll times out
# (`read ETIMEDOUT` against api.vercel.com) the CLI exits non-zero while the
# build carries on server-side and goes live. The first version of this script
# printed "DEPLOY FAILED — nothing was aliased" over a deployment that was
# already Ready in Production. That is a check reporting failure on a complete
# success — worse than a missing check, because it invites re-running a deploy
# that already happened, and it teaches the reader to distrust the red.
#
# So: never report the CLI's exit code as the outcome. Ask what actually
# shipped.
DEP="$(grep -oE 'https://[a-z0-9-]+-aymans-projects-[a-z0-9]+\.vercel\.app' "$OUT" | head -1)"
if [ $RC -ne 0 ] && [ -n "$DEP" ]; then
  echo "CLI exited $RC — checking whether the deployment actually shipped..."
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    STATE="$(npx vercel inspect "$DEP" --token "$TOKEN" 2>&1 | grep -iE '^\s*status' | head -1)"
    case "$STATE" in
      *Ready*)  echo "deployment is READY despite the CLI error: $DEP"; RC=0; break;;
      *Error*|*Canceled*) echo "deployment genuinely failed: $STATE" >&2; break;;
    esac
    sleep 10
  done
fi
rm -f "$OUT"
if [ $RC -eq 0 ]; then
  echo "deployed $SHA"
else
  echo "DEPLOY FAILED (exit $RC) — nothing was aliased" >&2
  echo "  READ THE BUILD OUTPUT ABOVE BEFORE TOUCHING CREDENTIALS." >&2
  echo "  This hint used to say the message 'means the TOKEN'. On 2026-09-02 that" >&2
  echo "  sent the operator to check a token that was perfectly valid: the real" >&2
  echo "  cause was a tsc error in an obsolete script, which failed the BUILD." >&2
  echo "  Both causes produce 'Could not retrieve Project Settings'." >&2
  echo "    build failure  -> look for 'error TS' / 'Failed to compile' above" >&2
  echo "    stale token    -> npx vercel whoami --token <t>   (fails if bad)" >&2
  echo "  A diagnostic that names ONE cause for a symptom with two is worse than" >&2
  echo "  no diagnostic: it does not merely fail to help, it misdirects." >&2
fi
exit $RC
