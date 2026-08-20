# Co-op redesign: Targets, Weekly Agenda, and a Backlog→Done pipeline

**Status:** design, ruled by Opus Lead 2026-08-20 — build it
**Author:** Engineer 1 (recon + implementation), rulings by Opus Lead relaying Ayman
**Changes:** replaces the deadline/KPI-driven Co-op screen shipped as part of the original
task-tracker rollout (`app/(app)/co-op/page.tsx`, unchanged since it was built as a shared
School/Co-op panel set).

## Ayman's requirements (near-verbatim, via Opus Lead)

> TARGETS, top of screen: A semi-thin strip showing Targets 1, 2, 3. "Targets" = goals ordered by
> when they should be completed. Target 1 is THE priority until it's finished. Below it, a
> collapsed/expandable "Stretch Goals" section holding multiple future targets. When a target is
> marked finished, everything promotes automatically: 2→1, 3→2, first stretch goal→3. Full CRUD:
> add, remove, edit content, and MOVE a target to a different position in the queue. Adding a
> target REQUIRES a deadline. Stretch goals do NOT require one — until they get promoted into a
> target slot.
>
> REMOVALS (all four, delete outright): "Due today" KPI, "Overdue" KPI, "Completed this week"
> KPI, and the entire "Deadlines" module.
>
> KEEP: Work schedule, as-is.
>
> NEW — Weekly Agenda, placed to the LEFT of Work schedule: a task list scoped specifically to the
> CURRENT target (Target 1). He creates tasks for the day/week, with OPTIONAL deadlines.
>
> NEW — pipeline module, below those: Linear/Jira style: Backlog → In Progress → Review →
> Complete. Plus a DETACHED "Blocked" state for tasks waiting on something beyond his control.
> Every Weekly Agenda task is automatically placed in Backlog, then advanced through the stages.

## Rulings

**1. Agenda and pipeline are one set of rows, not two.** The Weekly Agenda is the
creation/list surface; the pipeline is a status view over the same task rows. A task has a
`status` column; "automatically placed in Backlog" means the status defaults to `backlog`. Not
two tables kept in sync — that's a duplication bug waiting to happen and lets the two views
disagree.

**2. Blocked is orthogonal, not a fifth stage.** Blocked is a pause, not a step of progress, so a
blocked task must remember where it came from and return there when unblocked. Modeled as a
nullable `blocked_from` column holding the status it left, not an overwrite of `status` — an
overwrite makes unblocking a guess, and it will guess wrong.

**3. Out-of-order completion is allowed.** Any target in any slot (1, 2, or 3) can be marked done;
the cascade shifts everything below that position up by one. "Target 1 is the priority until it's
finished" is a statement about attention, not a lock on the other two — forbidding completion of
Target 2 while 1 is open would force a choice between leaving finished work unmarked or lying
about order. Permissive is also the reversible choice: it costs nothing to allow now and can't be
un-shipped as a sequential lock later without rewriting rows.

**4. Deadlines on promotion are never invented.** A stretch goal has no deadline; a target must
have one. On promotion the app prompts for one immediately. If dismissed, the promoted target sits
in its slot showing a visible, non-blocking "Set a deadline" action — never a modal he can't
escape during an automatic cascade, and never a fabricated date.

**5. Tasks belonging to a completed target stay attached to it**, for history — never deleted or
orphaned. Any still-incomplete tasks get a one-tap "move to the new Target 1" offer, never a silent
move — a silent move would rewrite what he was actually working on without telling him.

**6. When there's no stretch goal to promote, the empty target slot reads as inviting, not
broken.** Same treatment as any other empty state in this system — never an error state, never a
visible gap.

**7. Weekly Agenda is bounded by status, not by a calendar week.** Neither Ayman's requirement
("tasks for the day/week") nor the original brief fixes what stops the Agenda from accumulating
every task ever created against Target 1 — a target's deadline can be months out, and tasks carry
no time filter. Ruling: the Agenda lists the current target's tasks that are **not** in `complete`
status, ordered by deadline (nulls last) then creation. Completed tasks live in the pipeline's
Complete column and drop out of the Agenda; no calendar-week window is added. A real week filter
would hide exactly the unfinished work he most needs to see, and would get quietest exactly when
he's furthest behind — filtering by "not done" grows the list only when work is genuinely
accumulating, which is information, not clutter, and it keeps one data model with one derived view
(ruling 1) rather than adding a second axis to filter by. Adding a week window later, if wanted, is
cheap over an unfiltered list; recovering tasks a wrong filter hid is not.

## Data model

**Separate `coop_targets` and `coop_tasks` tables, not columns bolted onto the shared `tasks`
table.** `tasks` is shared by School and Co-op only (verified by grep — Business runs its own
Lock-In system and has zero `tasks` queries; `TaskDomain = "school" | "co_op"`). Forcing
`target_id`, `status`, and `blocked_from` onto `tasks` means every School row carries three
permanently-null columns forever — a schema paying rent for a tenant that never moves in. The
pipeline UI is fully custom, so there's no shared-component reuse being given up.

**`coop_targets`**: `id`, `user_id`, `title`, `deadline` (nullable), `status` (`active` | `done`),
`completed_at`, `position` (nullable smallint), `created_at`.

Position is **one dense-integer rank across the whole queue**, not two separate counters:
positions 1/2/3 are target slots, 4+ are stretch-goal order. Whether a row is "a target" or "a
stretch goal" is derived from `position <= 3`, not a separate flag — this makes the completion
cascade a pure decrement and makes "drag a stretch goal into slot 2" fall out for free instead of
needing its own code path. A completed target's `position` is set to `null` (pulled out of the
queue) and its `status`/`completed_at` set; it is never deleted.

Reordering uses dense integers plus a `DEFERRABLE INITIALLY DEFERRED` unique constraint on
`(user_id, position) WHERE position IS NOT NULL`, so a multi-row shift that transiently puts two
rows at the same position mid-transaction doesn't trip the constraint — it's checked at commit,
not per-statement. Fractional/sparse ranking was considered and rejected: it solves a scale
problem a 3–10 row personal list doesn't have, in exchange for precision drift and GC concerns.

**`coop_tasks`**: `id`, `user_id`, `target_id` (FK to `coop_targets`), `title`, `deadline`
(nullable), `status` (`backlog` | `in_progress` | `review` | `complete`), `blocked_from`
(nullable, same enum as `status`, minus `blocked` itself since blocked isn't a status value — see
below), `created_at`.

`blocked` is a valid `status` value (it's the "currently blocked" read), and `blocked_from` is a
separate column holding one of the other four values — never `'blocked'` itself, since that would
make a blocked task's origin "blocked":

```
status       ∈ {backlog, in_progress, review, complete, blocked}   -- blocked IS a status
blocked_from ∈ {backlog, in_progress, review, complete}            -- never 'blocked'
```

The database enforces the pairing, not just documentation of it: a CHECK constraint requires
`blocked_from IS NOT NULL` exactly when `status = 'blocked'` and `NULL` otherwise. A blocked row
with no origin is unrecoverable on unblock; a non-blocked row carrying a stale `blocked_from` will
eventually get read by something that trusts it. The `blocked_from` column is only ever read to
restore on unblock, never used for display logic while a task is blocked.

## Cascade

One `security invoker` plpgsql function, `complete_target(p_target_id)`:

1. Guard: `WHERE position IS NOT NULL` before reading the target's current position — makes a
   repeat call on an already-completed target (position already `null`) a no-op, mirroring the
   idempotency pattern in `020_save_allocation_checkin_fn.sql` / `022_..._idempotent.sql`.
2. Mark the row `status = 'done'`, `completed_at = now()`, `position = null`.
3. `UPDATE coop_targets SET position = position - 1 WHERE user_id = $1 AND position > $completed_position`
   — one statement, shifts every row below the completed one up, whether it was a target slot or a
   stretch goal. This single statement is what makes the `position <= 3` target/stretch-goal
   derivation (see Data model, above) fall out correctly without extra bookkeeping.
4. The RPC does **not** enforce a deadline on the row newly occupying a target slot — that would
   turn a UI nicety into a mid-cascade exception, contradicting the non-blocking promotion rule.
   The client checks the promoted row's deadline after the call and shows the prompt or the
   persistent "Set a deadline" affordance.
5. Tasks attached to the completed target are untouched by this function — they keep their
   `target_id`. The "move incomplete tasks to the new Target 1" offer is a separate, explicit,
   one-tap client action, never automatic.

RLS: `security invoker` throughout, so ownership is enforced the normal way — no
`user_id` parameter trusted from the client without an `auth.uid()` check, same as every other RPC
in this repo.

## Empty state

Zero rows exist in `tasks`/`schedule_events` across every domain and every account — this is a
true first-touch build, not a migration. The old "No active co-op" panel doesn't fit the new
layout: the KPIs and Deadlines module that justified it are gone.

**Pre-target, the entire Targets/Agenda/Pipeline stack renders as exactly one thing**: the Target
1 slot as a single actionable CTA ("Set your first target"), which is also where the
required-deadline prompt lives. Stretch Goals, Weekly Agenda, and the pipeline board do not render
as gated or placeholder panels — they don't exist on the page until a target exists to scope them
to, since Agenda and Pipeline are one data model keyed off `target_id` (ruling 1) and have nothing
to mean without it. Once Target 1 is added, the page grows Agenda, Pipeline, and the Stretch Goals
affordance together, in the same action. Day one is one decision, not four empty containers to
look at and dismiss — this is the direct fix for the failure mode found in the Fitness redesign
(a screen that demands fully-authored input before it returns anything).

Work schedule is unchanged and coexists with the new stack without conflict — it's a
self-contained day-grid panel (`components/shared/domain-schedule-view.tsx`) with no data or
layout dependency on Targets/Agenda/Pipeline, kept per Ayman's explicit instruction regardless of
its own zero usage to date.

**Home dashboard snapshot rewrite required.** `lib/home/get-domain-snapshots.ts`'s
`getTasksThisWeek(userId, domain, weekStart)` is a due-date range query — it will silently
under-report Co-op the moment Agenda tasks routinely have no due date, the same class of bug as
`get-domain-pulse` computing Fitness progress from a shape that stopped matching Fitness's real
model. Co-op gets its own snapshot query driven by **pipeline state and target progress**, not due
dates. Preserve `safeFraction` semantics while rewriting it: nothing tracked must stay `null`,
never render as zero progress.

## Build sequence

Schema + RPCs first (impersonation-tested RLS, as always) → Targets strip + cascade → Weekly
Agenda → pipeline board → the four removals and the home-dashboard snapshot rewire, **last** — so
the screen is never in a state where the old modules are gone and the new ones don't work yet.

## Acceptance

1. Targets strip shows exactly 3 slots, promotion cascade (2→1, 3→2, stretch→3) is atomic and
   idempotent, proven live via impersonation the same way `upsert_session_hour` was — not
   asserted from code reading alone.
2. Any target in any slot can be completed; out-of-order completion shifts correctly.
3. Adding a target requires a deadline; adding a stretch goal does not; promoting a
   deadline-less stretch goal into a target slot prompts once, non-blocking, and shows a
   persistent "Set a deadline" affordance if dismissed — never a fabricated date.
4. Full target CRUD: add, remove, edit title/deadline, move to a different queue position.
5. Weekly Agenda and the pipeline board render the same underlying rows — a status change in one
   view is immediately reflected in the other, no separate sync step. Agenda shows the current
   target's non-`complete` tasks only, ordered by deadline (nulls last) then creation — no
   calendar-week filter (ruling 7).
6. Blocked tasks remember and restore their prior status on unblock; `blocked_from` is never read
   for anything but that restore.
7. Completing a target never deletes or orphans its tasks; incomplete ones get an explicit,
   one-tap (never automatic) offer to move to the new Target 1.
8. An empty target slot with no stretch goal to promote reads as inviting, not broken.
9. Pre-target empty state is exactly one actionable element on the whole
   Targets/Agenda/Pipeline stack — no gated placeholder panels.
10. Home dashboard's Co-op pulse card reflects pipeline/target progress, not a due-date query;
    "nothing tracked yet" renders as `null`/no-signal, never as zero.
11. School's task screen, tests, and `lib/tasks/*` are untouched and pass unmodified —
    `coop_targets`/`coop_tasks` are fully separate from `tasks`.
12. `tsc`, `eslint`, full `vitest`, `next build` clean; RLS cross-user isolation verified live via
    impersonation for every new table and RPC.
