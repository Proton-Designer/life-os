# `updated_at` needed for 5 tables — `school` fan-out

**Not a numbered migration.** Per the team-lead's standing instruction
("if a domain needs updated_at columns, that's another migration — tell
me and I'll allocate, don't self-number"), this is a request + a reviewable
SQL sketch, not a file in `supabase/migrations/`.

## Which tables, and why (verified against real write paths, not inferred)

| table | entity | mutated by | existing timestamp | faithful? |
|---|---|---|---|---|
| `tasks` | `school.task` | `updateTaskCore` (title/due_date/task_type/class_id), `toggleTaskCore` (completed+completed_at), `updateClassAssessmentCore`'s task-sync step (title/due_date/task_type on a linked task) | `completed_at` | No — only reflects the complete/not-complete transition, exactly the same gap migration 135 fixed for `coop_tasks` |
| `classes` | `school.class` | `updateClassCore` (short_name/room/instructor), `uploadClassSyllabus`/`removeClassSyllabus` (syllabus_path) | none at all | No |
| `class_assessments` | `school.class_assessment` | `updateClassAssessmentCore` (name/type/date/weight_pct) | none at all | No |
| `schedule_events` | `school.schedule_event` | `updateScheduleEventCore` (day_of_week/event_time/end_time), `updateClassEvent` (title/event_time/end_time/location/instructor, multi-row class-group editing — app/(app)/school/actions.ts, not core-extracted this phase) | none at all | No |
| `schedule_event_overrides` | *(not a registered read entity — see below)* | `setScheduleEventOverrideCore`'s upsert merges `event_time`/`end_time` on conflict (`onConflict: "event_id,date"`, Supabase's default upsert MERGES columns, it does not no-op) | `created_at` | No — a second override on the same date changes `event_time` but `created_at` still reads the FIRST insert's instant |

All five currently ship in `lib/mcp/registry.ts` (the four registered
entities) or exist un-registered (`schedule_event_overrides`, see the
separate architecture note below) with `updatedAtColumn: null` — honest, not
fabricated, same posture as every other domain before its own equivalent
migration landed (133 for `deen`, 135 for `work`/`business`).

**Tables checked and found NOT to need this**, for completeness:
- `schedule_event_cancellations` — `cancelScheduleOccurrenceCore` upserts
  with `ignoreDuplicates: true`, which is a true no-op on conflict (never
  updates `date`/`event_id`, and there is no other mutable column on this
  table at all — a cancellation either exists or doesn't, there is nothing
  to "edit" about one in place). `created_at` is therefore a genuinely
  faithful last-modified proxy, same append-only reasoning as `deen`'s
  `quran_session`/`reflection_entry`. No migration needed; if this table is
  ever registered as its own read entity (see the architecture note below),
  it can safely use `updatedAtColumn: "created_at"`.

## Proposed DDL (reuses migration 074's `touch_updated_at()`, same as 133/135)

```sql
alter table public.tasks                   add column updated_at timestamptz not null default now();
alter table public.classes                 add column updated_at timestamptz not null default now();
alter table public.class_assessments       add column updated_at timestamptz not null default now();
alter table public.schedule_events         add column updated_at timestamptz not null default now();
alter table public.schedule_event_overrides add column updated_at timestamptz not null default now();

create trigger tasks_touch_updated_at                   before update on public.tasks                   for each row execute function public.touch_updated_at();
create trigger classes_touch_updated_at                 before update on public.classes                 for each row execute function public.touch_updated_at();
create trigger class_assessments_touch_updated_at       before update on public.class_assessments        for each row execute function public.touch_updated_at();
create trigger schedule_events_touch_updated_at         before update on public.schedule_events          for each row execute function public.touch_updated_at();
create trigger schedule_event_overrides_touch_updated_at before update on public.schedule_event_overrides for each row execute function public.touch_updated_at();
```

`tasks.updated_at` benefits `co_op`'s own generic-tasks surface too, if that
is ever wired as its own MCP entity — additive, shared, same posture as
`touch_updated_at()` itself being reused everywhere.

Once applied, `lib/mcp/registry.ts`'s four `updatedAtColumn: null` entries
(`task`, `class`, `class_assessment`, `schedule_event`) become `"updated_at"`,
with an `updatedAtVerification` note pointing at the trigger, same mechanical
follow-up as migration 135's.

## A separate, NOT-purely-additive architecture gap (flagged, not resolved here)

`schedule_event_overrides` and `schedule_event_cancellations` — the two
tables the lead explicitly named for this fan-out — are **not registered as
their own `lib/mcp/registry.ts` read entities at all**, independent of the
`updated_at` question above. Neither table carries its own `domain` column;
domain lives on the `schedule_events` row their `event_id` points at.
`fixedFilter` (the mechanism every other shared table in this registry uses
to stay scoped to one domain) only ever applies a same-table `.eq(col,
value)` — confirmed by reading `lib/mcp/tools/read.ts`'s query builder
directly, which never embeds/joins a foreign table. Registering either table
as its own entity with no `fixedFilter` would read BOTH school's and
co_op's overrides/cancellations through an entity named "school" — exactly
the cross-domain leak `fixedFilter` exists to prevent, just for a table the
current mechanism cannot reach.

Two real fixes exist, neither attempted here because both are cross-cutting
(not school-specific):
1. Extend `fixedFilter`/`read.ts` to support a filter through a named
   foreign-key join (PostgREST supports `.eq("schedule_events.domain",
   "school")` via an embedded resource; the generic `read` dispatcher does
   not expose this today).
2. Denormalize a `domain` column onto both tables, copied from the parent
   event at write time — cheap, additive, no new join logic needed; would
   also make `updatedAtColumn` trivial to add/verify per the table above.

Their data remains reachable today through `write`'s
`schedule_event.set_override`/`cancel_occurrence` actions, which scope
correctly because they always act via a caller-supplied, domain-checked
event id (`lib/mcp/write-registry.ts`'s `assertRowDomain`) — only
LISTING/reading them back as their own entity is the open gap. Tell me
which of the two fixes above you'd rather have, or whether this stays
deferred.
