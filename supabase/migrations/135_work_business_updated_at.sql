-- 135: `updated_at` for the four work/business tables the MCP `read` tool exposes.
--
-- WHY THIS EXISTS. TOOL-ARCHITECTURE.md's hard rule is "`updated_at` on every
-- entity at every detail level", because `read(detail:"ids")` -- returning only
-- `{id, updated_at}` at ~10-20 tokens a row -- is the whole mechanism behind the
-- owner's "reuse information it probably already has" requirement. A model scans
-- a list cheaply to see what moved before paying for a full re-fetch.
--
-- That rule had no schema behind it. Migration 133 fixed Deen after Eng 1 checked
-- rather than assumed and found a trigger-maintained `updated_at` on exactly ONE
-- of this schema's 68 tables. This is the same fix for work/business.
--
-- SCOPED, NOT BLANKET, on the same discipline as 133: every candidate table was
-- read against its real write paths first.
--   * `work_sessions` is NOT here -- `ended_at` is set exactly once by
--     endWorkSession and never re-set, so it is a faithful last-modified marker
--     already. No column, no trigger.
--   * These four have no column that survives a non-completion edit, so a
--     `detail:"ids"` scan would report a changed row as unchanged -- silently
--     wrong, and worse than the feature being absent.
--
-- `default now()` backfills existing rows at their apply time rather than NULL.
-- That is a small honest lie about history (they were last modified before this
-- ran) and the alternative is worse: a nullable column makes every consumer
-- handle absence, for rows whose real mtime is unrecoverable either way.
--
-- Reuses migration 074's `touch_updated_at()` rather than defining a second
-- trigger function -- one definition of "touch", not two that can drift.
--
-- `reorder_coop_target`'s cascade needs no change: it shifts other rows with
-- plain UPDATEs, and `before update ... for each row` fires for every row an
-- UPDATE touches, not only those reached through PostgREST.

alter table public.coop_targets    add column if not exists updated_at timestamptz not null default now();
alter table public.coop_tasks      add column if not exists updated_at timestamptz not null default now();
alter table public.kill_list_items add column if not exists updated_at timestamptz not null default now();
alter table public.weekly_goals    add column if not exists updated_at timestamptz not null default now();

drop trigger if exists coop_targets_touch_updated_at on public.coop_targets;
create trigger coop_targets_touch_updated_at
  before update on public.coop_targets for each row execute function public.touch_updated_at();

drop trigger if exists coop_tasks_touch_updated_at on public.coop_tasks;
create trigger coop_tasks_touch_updated_at
  before update on public.coop_tasks for each row execute function public.touch_updated_at();

drop trigger if exists kill_list_items_touch_updated_at on public.kill_list_items;
create trigger kill_list_items_touch_updated_at
  before update on public.kill_list_items for each row execute function public.touch_updated_at();

drop trigger if exists weekly_goals_touch_updated_at on public.weekly_goals;
create trigger weekly_goals_touch_updated_at
  before update on public.weekly_goals for each row execute function public.touch_updated_at();
