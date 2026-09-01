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

TOKEN="${VERCEL_TOKEN:-}"
[ "${1:-}" = "--token" ] && TOKEN="${2:-}"
[ -n "$TOKEN" ] || TOKEN="$(grep -E '^VERCEL_TOKEN=' .env.local 2>/dev/null | cut -d= -f2-)"
[ -n "$TOKEN" ] || { echo "no vercel token (VERCEL_TOKEN env, --token, or .env.local)" >&2; exit 2; }

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
npx vercel --prod --yes --token "$TOKEN"
RC=$?
[ $RC -eq 0 ] && echo "deployed $SHA" || echo "DEPLOY FAILED (exit $RC) — nothing was aliased" >&2
exit $RC
