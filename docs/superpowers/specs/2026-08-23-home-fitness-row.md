# Home "Now" fitness row — spec

**Status:** ready to implement. Owner: Engineer B.
**Parent:** docs/superpowers/plans/2026-08-22-fitness-system.md (Phase 4, previously suspended).

## Goal

Home's "Now" panel gains a single fitness row naming today's workout. Ayman's words:

> "just displays the icon, domain title, and whatever the complete workout for
> today is, it just lists the name/title of the workout."

That is the whole feature. Not progress bars, not rep entry, not a checkbox.

## Why this exists

`Now` is Home's "what I owe today" list, and its `Domain` union has always included
`fitness` — the branch was built and never wired. So Now has been reporting
"You're all clear" while a full day's training sat unlogged. Fitness was also the
only domain with its own competing panel on Home; that panel is now gone, and this
row is what replaces it.

## The row

Exactly one fitness row, matching Now's existing one-item-per-domain rule
(`selectNextActionPerDomain`).

**Title, in priority order:**

| Condition | Title |
|---|---|
| A routine session is scheduled today and unconfirmed | the session's name (e.g. `Push Day A`) |
| Otherwise, micro goals are scheduled today and unmet | the active micro plan's name (e.g. `Starter Reps`) |
| Neither | **no row at all** |

A session outranks micro goals — it's the larger commitment and the thing with a
fixed shape. Never render two fitness rows, and never concatenate both names.

**Scope of "workout":** sessions and micro goals only. Daily checks (protein,
steps), body metrics, and cycle benchmarks do NOT produce a Home row. They are
Fitness-screen concerns; Ayman asked for the workout's name, nothing else.

**Completion:** the row disappears once today's workout work is done — session
confirmed, and micro targets met. There is no "completed" styling; it simply
leaves the list, which is how every other Now row already behaves.

## Interaction — this row does not toggle

Every other Now row completes with one tap on a checkbox. **This one must not.**
Confirming fitness with a bare tap is forbidden (fitness spec §2.1: a blind tap
produces rubber-stamped data), and rep goals aren't binary anyway.

The row navigates to `/fitness`. Render a chevron or similar affordance where
other rows render their checkbox — it must not look tappable-to-complete.

## Implementation

**`lib/home/types.ts`** — extend the union:
```ts
export type ActionType =
  | "toggle_prayer" | "toggle_kill_list" | "toggle_task"
  | "toggle_habit"  | "toggle_adhkar"
  | "open_fitness";              // navigates; never toggles
```
No other field changes. `title` carries the name; `domain: "fitness"` already exists.

**`lib/home/get-priority-items.ts`** — emit at most one fitness `PriorityItem`.

Do NOT re-derive fitness state here. Reuse `lib/fitness/daily-log.ts`:
`buildDailyLog(inputs)` then `pendingDailyLog(items)`, and read the title off the
first pending `session` item, else the active micro plan's name when any pending
`micro_total`/`micro_freq` exists. Those functions already encode completion and
scheduling; a second implementation will drift from the Fitness screen and the two
surfaces will disagree about whether today is done.

Set `dueAt: null` (no hard deadline — renders as "Today"), `windowEndAt: null`,
`urgencyBucket: "later_today"`, `actionType: "open_fitness"`.

**`components/home/next-actions.tsx`** — branch on `actionType === "open_fitness"`:
render the row as a link to `/fitness` instead of a checkbox button. Everything
else about the row — icon chip, domain label, title, relative time — is unchanged.

**`app/(app)/actions.ts`** — `toggleItem` must handle `open_fitness` by throwing,
not by silently doing nothing. If a future change ever routes a fitness row into
the toggle path, it should fail loudly rather than half-work.

## Constraints

- **RSC boundary.** `app/(app)/page.tsx` is where function-prop serialization has
  bitten this project twice. Server Actions via `.bind(null, arg)`; never a plain
  function or inline arrow. `tsc` and vitest cannot catch it — load Home in a real
  browser and check the console.
- **Shared tree.** `git diff HEAD -- <path>` on every file before staging; full
  unfiltered `git status --short`; pathspec-limited commits. Ayman edits Home too.
- Do not touch anything else in Home. This is one row.

## Verification

1. Unit: fitness item emitted with a session scheduled; with micro only; with both
   (session wins); with neither (no item); with everything already complete (no item).
2. `toggleItem` throws for `open_fitness`.
3. Live browser at `/`: zero console errors, row renders, tapping navigates to
   `/fitness` and does not mark anything complete.
4. **Against Ayman's real configuration** — micro-only, Starter Reps active. His row
   must read `Starter Reps`. A micro-only account rendering no row is the exact
   blindness this project already shipped once in This Week; do not repeat it.
5. Confirm "You're all clear" no longer appears while fitness work is outstanding.
