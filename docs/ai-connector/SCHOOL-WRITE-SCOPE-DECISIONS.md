# `school` write-scope decisions — what's wired, what's deliberately not, and why

Same discipline as `docs/ai-connector/WRITE-DELETE-DECISION.md` (the
`deen.prayer` "unlog" ruling): decide deliberately, document the reasoning,
tell the lead — don't silently resolve, and don't silently expand scope
either.

## 1. No hard deletes — applied consistently, including to narrow "undo" deletes

The standing guardrail is unqualified: the MCP `write` path may never issue
a DELETE, full stop. School's recurrence model makes this bite harder than
anywhere else so far, because TWO of its legitimate "undo" operations are
themselves real DELETEs on narrow exception tables:

- `removeScheduleEventOverrideCore` — reverts one occurrence's temporary
  time back to the permanent pattern, by deleting the
  `schedule_event_overrides` row.
- `uncancelScheduleOccurrenceCore` — undoes a single cancelled occurrence,
  by deleting the `schedule_event_cancellations` row.

Both are narrowly scoped (one `event_id`+`date` row in a 2-column-unique
exception table) and are themselves the *inverse* of a write that MCP can
already make (`set_override`, `cancel_occurrence`) — not loss of primary
data; the permanently-scheduled class row is untouched either way. I
considered treating them as an allowed exception to the guardrail on that
basis (a model that can cancel a class but never un-cancel it, or move an
occurrence but never move it back, is a real, asymmetric usability gap —
exactly the shape of "real damage" the lead flagged for the recurrence
vocabulary generally).

**Decision: excluded anyway.** The guardrail has been stated the same way,
without a carve-out, every time it's come up (deen's unlog, work's
target/task removes, business's kill-list/weekly-goal entities). Narrowing
it case-by-case on my own judgment of "this delete is narrow enough" is
exactly the kind of quiet erosion a blanket rule exists to prevent. So:

- `write(school, schedule_event, set_override, ...)` and
  `write(school, schedule_event, cancel_occurrence, ...)` are wired.
- Their undos — `remove_override`/`uncancel` — are **not** wired. The
  cookie-authed UI (`app/(app)/work/actions.ts`'s `removeWorkHoursOverride`/
  `uncancelScheduleOccurrence`, and the equivalent school-actions.ts
  functions) remains the only way to undo an override or a cancellation,
  same as `removeTarget`/`unmarkPrayer`/`removeTask` staying cookie-only
  everywhere else in this program.
- Both functions are still core-shaped in `lib/tasks/actions-core.ts`
  (`supabase`/`userId` as explicit parameters, no `requireUser()`) per the
  lead's literal instruction to fix "every exported function" in that file
  — they're just never referenced from `lib/mcp/write-registry.ts`.

Flagging explicitly, same as the unlog decision: if this asymmetry becomes
a real pain point in practice, the fix is NOT loosening the guardrail — it
would be a schema-level alternative (e.g. a boolean `active`/`cleared` flag
on the exception row, toggled by UPDATE instead of removed by DELETE),
which is a real, if small, schema change and therefore something to bring
to the lead rather than do unilaterally.

Same posture, same reasoning, for:
- `school.class_assessment` has no `remove` — `delete_class_assessment`
  (migration 048's RPC) is a real DELETE.
- `school.schedule_event` has no `remove` (deleting the whole series) —
  `removeScheduleEventCore` is a real DELETE.
- `school.task` has no `remove` — `removeTaskCore` is a real DELETE.

## 2. `school.schedule_event` deliberately has no `create`

`addScheduleEventCore`/`addClassEvent` exist and are NOT DELETEs, so this
one is a genuine scope choice, not the guardrail. Two reasons:

1. **Risk of a malformed "class."** `addScheduleEventCore` writes a single,
   ungrouped `schedule_events` row. The app's own UI never calls it directly
   for classes — it goes through `addClassEvent` (app/(app)/school/actions.ts),
   which assigns `class_group_id` for multi-day classes and can attach a
   `class_id`. Wiring the bare single-row `add` into MCP would let a model
   create a class that looks like a stray, ungrouped calendar event in the
   UI — technically valid, silently worse than what the app itself produces.
2. **Not what was asked.** The owner's concrete examples (homeworks,
   assignments, tasks, reminders, moving/cancelling a class) all map to
   `school.task` or to editing an EXISTING recurring pattern — nothing in
   the brief calls for "create a brand-new class via MCP" specifically.

`addClassEvent`/`updateClassEvent`/`removeClassEvent` (the actual
multi-day-class-group CRUD in `app/(app)/school/actions.ts`) are therefore
**not core-extracted this phase at all** — they stay cookie-coupled,
untouched. Extracting them properly (the group-membership diffing logic in
`updateClassEvent` is real, non-trivial work) is a reasonable next step if
the lead wants `school.class` creation/editing to cover multi-day classes
through MCP, but it's its own piece of scoped work, not a drive-by inside
this pass.

## 3. Syllabus upload/remove are out of scope, not deferred-and-forgotten

`uploadClassSyllabus`/`removeClassSyllabus` take a `FormData`/`File` and
talk to Supabase Storage directly. There is no sane MCP `write(patch: {...})`
shape for "here is a PDF" without inventing a base64-blob convention this
program has never needed anywhere else, and no `fetch`-equivalent tool
exists yet to hand a result back either. Left entirely alone — not
core-extracted, not registered, not hinted at in `school.class`'s write
actions.

## 4. The write-side cross-domain guard (`assertRowDomain`)

Found while wiring this domain, not assumed away: `tasks.domain` and
`schedule_events.domain` are both shared with `co_op` (and, for `tasks`, a
third state — NULL for a Night Plan dump item, migration 119). The read
side's `fixedFilter` (`lib/mcp/registry.ts`) protects listing/reading by
construction. The write side has no equivalent generic mechanism — each
`write-registry.ts` handler is bespoke code, not a table-driven dispatcher —
so a `school`-scoped write action targeting an existing row by the
top-level `id` (`task.edit`/`task.toggle`/`schedule_event.*`) could, without
an explicit check, retitle/reschedule a `co_op` work-hours row or a Night
Plan dump item just because it happens to belong to the same user.

Added `assertRowDomain` (`lib/mcp/write-registry.ts`) to close this: it
selects the target row's own `domain` column and throws before any mutation
if it isn't `"school"`. Applied to every school action that takes an
existing row by id: `task.edit`, `task.toggle`, `schedule_event.edit_series`,
`schedule_event.set_override`, `schedule_event.cancel_occurrence`. Not
needed for `class`/`class_assessment` — neither table has a `domain` column
or any cross-domain equivalent.

**Separately noted, not fixed:** the COOKIE-authed paths
(`app/(app)/work/actions.ts`'s `updateWorkHours` etc.,
`app/(app)/school/actions.ts`'s schedule-event functions) have never had
this check either — `updateScheduleEventCore` only ever scoped by
`id`+`user_id`, never by `domain`, both before and after this pass. That's a
pre-existing gap in the original app code, not introduced here, and fixing
it is a live-app behavior change outside this task's scope (it would affect
the cookie-authed UI, not just MCP) — flagging it rather than silently
patching it, same as the `array_length`/`key_ops` bugs were flagged rather
than fixed-on-the-side in earlier phases of this program.
