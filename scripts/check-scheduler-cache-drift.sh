#!/bin/bash
# check-scheduler-cache-drift.sh — verify `card_states` (a DERIVED CACHE, per
# R1.5) still agrees with what FSRS replay over `reviews` (the source of
# truth) says it should be.
#
# WHY THIS EXISTS (R1.5/R1.6, 2026-09-01/02)
#
# R1.5 demotes `card_states` to a rebuildable cache. Two proofs preceded the
# migration (R1.6): a positive replay against real production data (23/23
# first-grade reviews matched), and a synthetic multi-review proof on scratch
# that found a REAL bug — submit_review's own `lapses` formula increments on
# ANY Again rating, but ts-fsrs only counts a lapse as Again FROM 'review'
# state. Production data could never have shown this: every real review to
# date is a card's first, and none is rating=1. That is exactly why this
# script exists as a STANDING instrument, not a one-off proof: the bug class
# that hid successfully for two whole proof rounds is precisely the one a
# uniform sample of "mostly untouched decks" will keep missing forever.
#
# THREE LABELLED MODES — never report one mode's result as another's. Each
# catches a DIFFERENT failure class; a script that averages them together
# hides which one actually broke.
#
#   MODE 1 — REBUILD-vs-cache. Derives stability/difficulty/due_at/reps/
#     lapses purely from stored `reviews` columns (scheduled_days,
#     stability_after, difficulty_after, state_before + rating for lapses —
#     see the .ts file's header for why `state` itself is NOT rebuilt this
#     way) and compares to the live `card_states` row. Retention-independent.
#     Catches: the cache having drifted from its own log (a bad write, a
#     missed update, manual DB surgery).
#
#   MODE 2 — RECOMPUTE-vs-stored-after-values. Replays the FULL history
#     through the real scheduler (ts-fsrs via lib/self-mastery/
#     fsrs-scheduler.ts — the same functions production drives, never a
#     reimplementation) and compares the recomputed numbers to what
#     `reviews` actually stored. Catches: a scheduler regression (ts-fsrs
#     version bump, a config change, a bug in computeNextState's caller).
#
#   MODE 3 — HISTORY CONSISTENCY. For every review after a card's first,
#     recomputes that ONE step from its immediate predecessor's stored
#     after-values and that review's own real `reviewed_at` (never "now" —
#     see the .ts file for why this specific case is the whole reason this
#     mode exists) and compares to what that row actually stored. This is
#     OUTSIDE cache fidelity by construction — `card_states` only ever holds
#     the current/final row — and it is exactly where a scheduler regression
#     can hide while Modes 1 and 2's final-row comparison still looks clean.
#
# SAMPLING IS NOT UNIFORM. A uniform sample of production today is ~94% 'new'
# rows (353 of 376 card_states) and 100% single-review where reviewed at all
# (23 of 23 reviews are a card's first) — a uniform sample mostly compares
# untouched caches to untouched replays and calls that coverage. This script
# targets cards with 2+ reviews specifically (required for Mode 3, most
# informative for Modes 1/2) and reports the multi-review population size
# every run, loudly, as its own line — not folded into a pass/fail count —
# because "0 multi-review cards existed to sample" must never read the same
# as "N were sampled and 0 diverged."
#
# `lapses` is NEVER replayed through the scheduler, in any mode — count
# `rating = 1 AND state_before = 'review'` from stored rows. That is the R1.6
# finding, adopted as a ruling: ts-fsrs itself only increments lapses on
# Again-from-review (verified against node_modules/ts-fsrs source), and the
# now-fixed submit_review formula matches that exactly.
#
# Usage:  ./scripts/check-scheduler-cache-drift.sh "<postgres-url>" [--mode=1|2|3] [--limit=N]
#         ./scripts/check-scheduler-cache-drift.sh --self-test "<postgres-url>"
#
# --self-test writes real fixture rows and a real corruption, so it is
# documented for SCRATCH, not production — see the .ts file's own guard,
# which refuses to run unless the URL looks like scratch (localhost) or the
# caller passes --i-know-this-writes explicitly. Production is read-only
# always; this script issues no writes outside --self-test.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

exec npx tsx scripts/check-scheduler-cache-drift.ts "$@"
