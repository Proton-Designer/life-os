# Orphaned code — verified inventory, awaiting Ayman's call

**Author:** Opus Lead, 2026-08-18
**Status:** informational. Nothing here has been deleted.

Dead code has been accumulating across several refactors and the standing rule has been to leave
orphans in place and flag them. This is the first verified inventory of what that now amounts to.

**Method and its limits.** Automated detection produced false positives twice, so every entry below
was checked by hand:

- An early pass missed `export async function` entirely and reported four live modules as dead
  (`getHomeExtras`, `getWeeklyCompletion`, `getInsightsKpis`, `getCheckinOptions`). All four are in
  active use.
- `lib/supabase/middleware.ts` was flagged because it is imported from `proxy.ts` at the repo root,
  outside the searched directories. **It is live and load-bearing** — it is the auth check on every
  request.
- `components/home/priority-list.tsx` was *missed* by the automated pass because three other files
  mention it **in comments**. It is genuinely orphaned.

Comment mentions are why this can't be trusted to a grep. Anything deleted from this list should be
re-verified at the time, not taken on faith from this file.

## Verified orphaned — no importers

| File | Lines | Became orphaned |
|---|---|---|
| `components/home/priority-list.tsx` | 118 | 2026-08-18, Home day-shape restructure |
| `components/home/domain-peek-cards.tsx` (+ `domain-peek-card.tsx`) | 177 + 60 | earlier Home rebuild |
| `components/home/pulse-strip.tsx` | 43 | earlier Home rebuild |
| `components/home/weekly-summary-strip.tsx` | 42 | earlier Home rebuild |
| `components/shell/top-nav.tsx` | 86 | shell refactor |
| `components/deen/adhkar-strip.tsx` | 53 | Adhkar removed from the product |
| `components/deen/traveling-toggle.tsx` | 33 | Traveling mode never wired up |
| `components/deen/qada-counter.tsx` | 43 | superseded by the qada backlog list |
| `components/business/weekly-goal-card.tsx` | 50 | superseded by the shared `GoalCard` |
| `components/checkin/checkin-scheduler.tsx` + `checkin-scheduler-loader.tsx` | ~120 | never mounted |
| `components/shared/section-skeleton.tsx` | 17 | loading boundaries removed 2026-08-17 |
| `components/ui/segmented-control.tsx` | 54 | unused primitive |

Roughly **900 lines**, plus their test files, which still run on every suite invocation.

## Why it matters, modestly

The cost is not runtime — none of this ships to the browser, since nothing imports it. The cost is
that it is indistinguishable from live code when reading the repo, and its tests contribute to a
passing suite while covering nothing anyone uses.

Two of these are worth separating from the rest:

- **`checkin-scheduler.tsx` / `checkin-scheduler-loader.tsx`** were built to prompt check-ins outside
  a Lock-In session and were never mounted. That is arguably an unfinished feature rather than dead
  code, and deleting it discards work rather than tidying up.
- **`traveling-toggle.tsx`** is the UI for `profiles.traveling_mode`, which still exists in the
  schema and is read nowhere. Travel affects prayer obligations materially — shortened and combined
  prayers — so this is a real product gap the prayer-window work has now made more visible, not just
  a stray file.

The other ten are straightforwardly superseded.

## Recommendation

Delete the ten superseded files and their tests in one commit. Keep the check-in scheduler and the
traveling toggle pending a decision on whether those features are wanted — they are unfinished, not
obsolete, and that is a different question.
