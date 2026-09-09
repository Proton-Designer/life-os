# `updated_at` needed for 4 tables — `work`/`business` fan-out

**Not a numbered migration.** Per the team-lead's explicit instruction
("if a domain needs updated_at columns, that's another migration — tell
me and I'll allocate, don't self-number"), this is a request + a reviewable
SQL sketch, not a file in `supabase/migrations/`.

## Which tables, and why (verified against real write paths, not inferred)

| table | entity | mutated by | existing timestamp | faithful? |
|---|---|---|---|---|
| `coop_targets` | `work.target` | `editTarget` (title/deadline), `completeTarget` (status+completed_at via RPC), `moveTarget` (position via RPC) | `completed_at` | No — only reflects completion, not edits or reordering |
| `coop_tasks` | `work.task` | `editTask`, `advanceTask`/`retreatTask`/`blockTask`/`unblockTask` (status+blocked_from) | `completed_at` | No — only reflects the complete/not-complete transition, not every status change or a title/deadline edit |
| `kill_list_items` | `business.kill_list_item` | `setKillListItem` (upsert, can overwrite `text` on an existing slot), `toggleKillListItem` (completed+completed_at) | `completed_at` | No — a text edit via `setKillListItem` never touches it |
| `weekly_goals` | `business.weekly_goal` (and, later, `deen.weekly_goal`) | `saveBusinessWeeklyGoal` (upsert, can overwrite headline/milestones) | none at all | No |

All four currently ship in `lib/mcp/registry.ts` with `updatedAtColumn: null`
— honest, not fabricated, same posture as `work.target`/`business.*`'s own
registry comments state. `detail:"ids"`'s reuse-scan mechanism (memo §4) is
simply unavailable for these four entities until this lands; nothing is
wrong in the meantime, the feature is just absent for them specifically.

**Tables checked and found NOT to need this**, for completeness:
- `work_sessions` — `ended_at` (set exactly once by `endWorkSession`, never
  re-set) is a genuinely faithful proxy; already wired as `work.work_session`'s
  `updatedAtColumn`, no migration needed.
- `prayers` (`logged_at`), `deen`'s 5 other mutable tables (real `updated_at`
  already added in migration 133) — pre-existing, not part of this request.

## Proposed DDL (reuses migration 074's `touch_updated_at()`, same as 133)

```sql
alter table public.coop_targets     add column updated_at timestamptz not null default now();
alter table public.coop_tasks       add column updated_at timestamptz not null default now();
alter table public.kill_list_items  add column updated_at timestamptz not null default now();
alter table public.weekly_goals     add column updated_at timestamptz not null default now();

create trigger coop_targets_touch_updated_at    before update on public.coop_targets    for each row execute function public.touch_updated_at();
create trigger coop_tasks_touch_updated_at      before update on public.coop_tasks      for each row execute function public.touch_updated_at();
create trigger kill_list_items_touch_updated_at before update on public.kill_list_items for each row execute function public.touch_updated_at();
create trigger weekly_goals_touch_updated_at    before update on public.weekly_goals    for each row execute function public.touch_updated_at();
```

Once applied, `lib/mcp/registry.ts`'s four `updatedAtColumn: null` entries
become `"updated_at"`, with an `updatedAtVerification` note pointing at the
trigger the same way migration 133's entries do. That follow-up PR is small
and mechanical once the column exists — not blocked on anything but the
apply.

**Not included here:** `reorder_coop_target`'s cascade (shifting OTHER
targets' positions when one moves) goes through plain `UPDATE`s inside the
RPC, which the trigger above will catch automatically — no RPC change
needed, since `before update ... for each row` fires for every row the RPC's
own `UPDATE ... WHERE` touches, not just ones reached via PostgREST.
