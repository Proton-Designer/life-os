# 2026-08-26 afternoon batch — status board

Statuses: `BACKLOG` → `DEV` → `TEST` → `VERIFY` (live browser) → `ITERATE` → `DONE`.
Scope authority: `2026-08-26-class-view-VERBATIM.md`. Rulings R1–R7 live there.

**Nothing reaches DONE on `tsc` + `vitest` alone.** VERIFY means loaded at
`/school` in a real browser with the console open. Last night a component was
built, unit-tested, handed over, never wired in — every automated check green.

## Items

| # | Item (his words, compressed) | Owner | Status |
|---|---|---|---|
| L0 | `formatShortDate` — "Sep. 3rd" not "2026-09-03" | Lead | **DONE** `7c8f08d` |
| L1 | Verbatim spec + rulings captured | Lead | **DONE** `b9682e6` |
| A1 | Reorder class cards: Prob & Stats, DSA, Lin Alg, Ameri Studies, Phys, Phys Lab | A | **DONE** `e897d2e` — VERIFIED live (e2e + prod query) |
| A2 | Kill the open-dialog load waterfall (server-side prefetch) | A | **DONE** `e897d2e` — data layer; B's consumption pending |
| L2 | Class card's own upcoming-test date rendered raw | Lead | **DONE** `129814f` |
| L3 | e2e coverage for the integration seams | Lead | **DONE** `32c1f7f`, `db3fd18` |
| A3 | Cross-device realtime sync (reopened — his 2nd request) | A | **DONE** `eb276bf` — VERIFIED, see below |
| B1 | Layout/polish: overlap, borders on all 3 sections, bigger popup | B | DEV |
| B2 | Consolidate ALL editing behind top-right Edit; Save/Cancel replace it | B | DEV |
| B3 | Consume A's props, delete the `useEffect` | B | DEV |
| C1 | "View syllabus" downloads instead of viewing (docx-only) | C | **DONE** `2360afb`+`107c6d8` — VERIFIED live, both formats |
| C2 | Add-task wizard must not re-ask for the class | C | DEV |
| C3 | No edit/remove for tasks in the expanded view | C | DEV |
| C4 | Raw dates in task rows; redundant "All classes" filter | C | DEV |

## Cross-engineer seams (the parts that actually break)

1. **`ClassCardData` → dialog props.** A produces `assessments` / `tasks`
   arrays; B consumes them as `initialAssessments` / `initialTasks` and
   deletes the `useEffect`. If A lands and B doesn't, the dialog still
   waterfalls and nothing looks different. **Lead verifies personally.**
2. **`TaskListModule` editing mode.** C ships `editing` / `onEditTask` /
   `onRemoveTask` / `hideClassFilter`; B passes a pre-staged array and owns
   all staged state. C's module holds none. If C lands and B doesn't wire
   it, the expanded view still has no task editing — the exact shape of last
   night's failure. **Lead verifies personally.**
3. **`app/(app)/school/class-actions.ts` is shared** (unassigned in the
   original split). C widens `getClassSyllabusUrl`; B adds
   `updateClassAssessment`. Edit-only, never Write. Commit fast, stay clean.

## Decisions taken, with the reason

- **(b) over (a) for task editing** — B proposed gating C's existing
  TaskEditDialog behind the outer toggle. Rejected: a nested popup with its
  own Save/Cancel inside a dialog whose Save/Cancel means something else
  makes the outer buttons a liar for one of three sections. One Save, one
  Cancel, governing everything visible.
- **Syllabus is the one staging carve-out** — justified by physics (a
  Storage upload can't be staged client-side and rolled back), not by
  preference. Tasks and assessments get no such exemption.
- **`kind: "pdf" | "docx" | "other"`, not a raw extension** — puts the
  branch server-side where the path is, and `"other"` is real: the bucket
  allows legacy `application/msword`, which docx-preview cannot render and
  which must reach the honest "can't preview + Download" path.
- **`position` column, not a hardcoded CASE** — 048's precedent.

## Realtime — reopened mid-batch, and now fixed

Originally out of scope. Reopened because Ayman's request raised cross-device
updating for the **second time in two days**, and A was idle with the deepest
context on it.

**Root cause (A):** a channel's `postgres_changes` RLS scoping is frozen at
JOIN time. `createBrowserClient`'s cookie session restore is async; the old
provider deferred `subscribe()` by a single microtask (a correct fix, but for
a *different* bug — Strict Mode double-invoke). When `subscribe()` won that
race the join went out under the **anon** role, RLS matched zero rows for the
channel's entire lifetime — and the channel still reported `SUBSCRIBED`. A
later self-heal `setAuth()` updated the socket's general auth **without**
retroactively re-scoping the existing registration.

That last detail is why last night's "auth timing ruled out" was wrong: it
checked the token at `SUBSCRIBED` time (always correct, self-heal guarantees
it) rather than at the moment the join was *sent* (the determining factor).

**Evidence.** Failing case constructed deterministically rather than waited
for: join under anon then sign in → never arrives, status `SUBSCRIBED`
throughout. Reverse the order → arrives every time. Then 16 consecutive clean
runs of the two-context e2e (A's 5 + Lead's `--repeat-each=10`).

**Durability, all forced via direct SDK calls, not observed and hoped for:**
token refresh while subscribed (safe — a refresh keeps the same user and role,
so there is no scope decision to change; the frozen scope only bites when the
*original* join carried the wrong identity), socket loss and reconnect (safe —
the re-join reads the socket's current token, which the fix already
guarantees), and multi-tab (safe — no shared-registration bleed either way).

The structural arguments are what close this, not the green results alone.

## Still out of scope, deliberately
- **Pruning `listClassAssessments` / `listClassTasks`.** They go dead for the
  initial render but are still used post-mutation, and dead-code removal in a
  file two engineers are editing is a needless conflict. Prune later.

## Open for Ayman (not blocking)

- CS 3341 (Prob & Stats) has **0 tasks** — its syllabus states no dates at
  all. Its card and expanded view are correctly, permanently empty until he
  adds something. Not a bug, but it will look like one next to DSA's 21.
- Four real graded items still have no announced date: CS 3345's cumulative
  final, and MATH 2418's four online tests (30% of that grade).
