-- 136: `updated_at` for the five school-domain tables MCP's `read` tool exposes.
--
-- Third and largest instance of the same gap (133 = Deen, 135 = work/business).
-- TOOL-ARCHITECTURE.md requires `updated_at` on every entity at every detail
-- level, because `read(detail:"ids")` -- `{id, updated_at}` at ~10-20 tokens a
-- row -- is the mechanism behind the owner's "reuse information it probably
-- already has" requirement. A row that changed but reports an unchanged marker
-- is silently wrong, and worse than the feature being absent.
--
-- SCOPED BY READING WRITE PATHS, not applied blanket -- same discipline as 133
-- and 135, and it excluded a table again:
--   * `schedule_event_cancellations` is NOT here. Its only write is an
--     `ignoreDuplicates` upsert, i.e. a true no-op on conflict, so a row is
--     never modified after insert and `created_at` is already its faithful
--     last-modified time. A column there would be redundant, and a trigger
--     would never fire.
--
-- `tasks` is the widest blast radius of any table touched in this program: it
-- is shared across school and co_op via its `domain` column, and is read by
-- Home's Now module, the work pipeline, capture, and the school views. The
-- change is additive-only -- a new column plus a BEFORE UPDATE trigger that
-- writes exactly one field -- so no existing query, index or RLS policy is
-- affected. Called out because "additive" is a claim worth stating plainly on
-- a table this central rather than leaving to inference.
--
-- Reuses 074's `touch_updated_at()`: one definition of "touch", not two.

alter table public.tasks                     add column if not exists updated_at timestamptz not null default now();
alter table public.classes                   add column if not exists updated_at timestamptz not null default now();
alter table public.class_assessments         add column if not exists updated_at timestamptz not null default now();
alter table public.schedule_events           add column if not exists updated_at timestamptz not null default now();
alter table public.schedule_event_overrides  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists tasks_touch_updated_at on public.tasks;
create trigger tasks_touch_updated_at
  before update on public.tasks for each row execute function public.touch_updated_at();

drop trigger if exists classes_touch_updated_at on public.classes;
create trigger classes_touch_updated_at
  before update on public.classes for each row execute function public.touch_updated_at();

drop trigger if exists class_assessments_touch_updated_at on public.class_assessments;
create trigger class_assessments_touch_updated_at
  before update on public.class_assessments for each row execute function public.touch_updated_at();

drop trigger if exists schedule_events_touch_updated_at on public.schedule_events;
create trigger schedule_events_touch_updated_at
  before update on public.schedule_events for each row execute function public.touch_updated_at();

drop trigger if exists schedule_event_overrides_touch_updated_at on public.schedule_event_overrides;
create trigger schedule_event_overrides_touch_updated_at
  before update on public.schedule_event_overrides for each row execute function public.touch_updated_at();
