# `fitness` write-scope decisions — what's wired, what's deliberately not, and why

Same discipline as `docs/ai-connector/WRITE-DELETE-DECISION.md` and
`SCHOOL-WRITE-SCOPE-DECISIONS.md`: decide deliberately, document the
reasoning, tell the lead — don't silently resolve, and don't silently
expand scope either.

## What's wired, and why it's the right slice

The lead's explicit priority: **"Prioritise session_sets and body_metrics
writes over exhaustive plan-editing coverage"** — the owner's "checking off
logs" requirement in its heaviest form. Wired:

- `workout_session.quick_log` / `.confirm` / `.confirm_plan_session` — the
  app's three actual session-creation paths, 1:1. No edit/remove: these
  tables are immutable by design (spec: "editing must never rewrite
  history") — there is no update or delete path anywhere in the app to even
  consider excluding, so this isn't a guardrail decision, there's simply
  nothing else to wire.
- `body_metric.log_weight` / `.log_waist` — top priority alongside logging.
- `fitness_benchmark.log` — one exercise per call, not the combined
  weight/waist/reps shape `logCycleBenchmark` uses in the UI (see
  `lib/fitness/actions-core.ts`'s header comment on why that function is
  left untouched rather than refactored to share code with these).
- `exercise.create` / `.archive`, `workout.rename` / `.archive` — simple,
  low-risk, single-table edits with no plan-editing entanglement. Archived,
  never deleted, same convention as every other domain.

## What's deliberately READ-ONLY this pass, and why

Everything below is a genuine exclusion, not an oversight — each is
registered as a full read entity (honoring "read everything"), just with no
corresponding `write-registry.ts` entry.

**The plan-editing machinery** — `workout_plan`, `plan_session`,
`plan_session_exercise`, `plan_micro_exercise`, `workout_exercise` (via
`savePlan`/`deletePlan`/`activatePlan`/`deactivateSlot`/
`createPlanFromTemplate`/`createWorkoutWithExercises`/`saveWorkout`/
`duplicateWorkout`). Per the lead's explicit instruction to deprioritize
this relative to logging. It's also genuinely harder to wire safely than
anything above: `savePlan` alone is a ~120-line function doing
delete-then-reinsert across 2-3 tables, snapshotting/archiving orphaned
`workouts` rows, and unconditionally re-syncing `workout_schedule` — the
single highest-risk shim in the whole fitness redesign per its own
comment. Wiring a faithful MCP equivalent is real, scoped work, not a
drive-by inside this pass.

**`workout_schedule`** — READ-ONLY, and not merely deprioritized: writing
to it directly is actively MISLEADING while a routine plan is active.
`lib/fitness/sync-workout-schedule.ts`'s shim deletes and fully regenerates
this table from the active routine plan's sessions on **every** plan
mutation (`savePlan`, `deletePlan`, `activatePlan`, `deactivateSlot`) — a
direct write via `assignWorkoutToDay`/`setWorkoutSchedule`'s own MCP
equivalent would be silently undone the next time any of those four things
happens, with no way for the caller to know in advance whether a routine is
currently active (that's a separate lookup against `active_workout_plans`
the model would have to know to make first). This is exactly the "looks
obvious, isn't" trap the lead flagged for `active_workout_plans` — it turns
out to apply here too, one table over.

**`active_workout_plan`** — READ-ONLY, per the lead's own explicit warning
("read migration 129 before you touch it"). Two reasons beyond the scar
tissue itself: (1) a raw MCP write to `active_workout_plans` would bypass
`syncWorkoutScheduleForActiveRoutine` entirely, desyncing `workout_schedule`
for the nine legacy readers outside fitness the exact same way a direct
write would; (2) migration 129's fix (a column-list `ON DELETE SET NULL`)
is about `workout_plans` deletion correctly clearing this table, not about
this table being safe to write to directly — the two are unrelated
questions and I'm not conflating "the delete bug is fixed" with "writing
here is now safe."

## `fitness_cycle_anchor` — nothing to wire, not a deferral

Found, not decided: this table has **no write path anywhere in the current
app**. Migration 039's own comment describes the intended behavior ("defaults
to first plan activation, spec's logic-gap resolution #6"), but
`activatePlan`/`setActiveSlot` never actually sets it — the Cycle Progress
feature is half-built. There is no existing core function to extract and no
existing cookie-authed write path to mirror, so there's nothing for an MCP
fan-out pass to wire. Building the missing feature (deciding what "first
plan activation" should mean, writing the anchor-set logic) is a real,
separate piece of product work — flagged to the lead, not attempted here.

## `rep_goals` — legacy/dead, nothing to wire

Confirmed zero writers anywhere in current app code (grepped the whole tree
outside `supabase/migrations` for `from("rep_goals")`/`from('rep_goals')`
and found none). Superseded by `plan_micro_exercises` (migration 036
materializes every active `rep_goals` row into a "Starter Reps" micro plan
at deploy time). Registered read-only for history; nothing to decide about
writing to a table the app itself no longer writes to.

## The `parentFilter` mechanism (built here, retrofitted onto school)

`plan_session_exercises`, `session_sets`, `plan_micro_exercises` (the lead's
named candidates) plus `workout_exercises` and `plan_sessions` (the same
shape, applied consistently rather than special-cased to just the three
named) are all child tables that are only ever meaningfully read "for THIS
session/plan/workout" — never as a flat list across every parent a user has
ever had. `lib/mcp/registry.ts`'s new `parentFilter` EntityDef field (and
its enforcement in `lib/mcp/tools/read.ts`) makes this explicit and
machine-enforced: a list call without `filter.<column>` is refused, and the
named parent is verified to belong to this user (and, where set,
`parentFixedFilter`) before any child rows are returned.

None of fitness's own five parentFilter entities needs the
domain-verification half of that value (fitness has no table shared across
two MCP domains the way `schedule_events` is shared with `co_op`) — `user_id`
alone already fully secures them. The mechanism is applied anyway for the
other half: refusing an unscoped "every set I've ever logged across every
session" dump, which matches how every other reader in this codebase
actually queries these tables.

Once built for 2+ fitness tables, `schedule_event_overrides`/
`schedule_event_cancellations` (deferred in the school phase specifically
pending this) were retrofitted onto it in the same pass — see
`lib/mcp/registry.ts`'s comment on `schedule_event_override`/
`schedule_event_cancellation` for that half of the story.
