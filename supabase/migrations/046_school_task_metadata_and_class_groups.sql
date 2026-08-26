-- Engineer B, School module rebuild (2026-08-26 night batch).
--
-- (1) tasks gets the two fields the new "type · class" list rows need.
-- Both nullable, no backfill/default — existing rows render an em-dash for
-- type/class until re-entered, same additive pattern as 016/042/045.
-- "in order of when it was assigned" (Ayman) is already `created_at`; no
-- new assigned_at column.
alter table public.tasks
  add column task_type text null
    check (task_type in ('assignment', 'project', 'test', 'quiz', 'reading', 'other')),
  add column class_event_id uuid null references public.schedule_events(id) on delete set null;

create index tasks_class_event_id_idx on public.tasks (class_event_id) where class_event_id is not null;

-- (2) schedule_events gets a group label so a multi-day class (Ayman: "the
-- class is T/TH" — singular) is one editable/removable thing in the UI even
-- though it's stored as one row per day. Not a foreign key to itself —
-- purely a shared label; a single-day class may also carry one (reusing its
-- own row id as the label, so "edit this class" and "remove this class"
-- always resolve the same way whether the class has 1 row or several).
alter table public.schedule_events
  add column class_group_id uuid null;

create index schedule_events_class_group_id_idx on public.schedule_events (class_group_id)
  where class_group_id is not null;

-- (3) Opus Lead root-caused a real bug from this: `cancelled_on` is a
-- single nullable date, so cancelling one occurrence silently un-cancels
-- any previously-cancelled occurrence of the same recurring event, and a
-- cancelled class renders as absent — indistinguishable from "never
-- entered." (That's exactly what produced Ayman's "you missed my Tuesday
-- class" report: the Tuesday row WAS there, just silently hidden.)
--
-- This table is the real, multi-date, auditable fix. `cancelled_on` is
-- deliberately NOT dropped or backfilled here — three readers outside
-- School's ownership tonight (lib/home/get-day-shape.ts,
-- app/(app)/calendar/actions.ts, app/(app)/work/page.tsx) still read it and
-- are not part of this migration; touching them is routed through Opus
-- Lead. School's own readers (ClassScheduleWeek, DomainScheduleView,
-- lib/tasks/schedule-metrics.ts) read this table as the source of truth;
-- `cancelled_on` keeps getting mirrored (last-cancelled-date only) on every
-- cancel so those three untouched readers see no behavior change.
create table public.schedule_event_cancellations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.schedule_events(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  created_at timestamptz not null default now(),
  constraint schedule_event_cancellations_unique unique (event_id, date)
);

create index schedule_event_cancellations_event_id_idx on public.schedule_event_cancellations (event_id);
create index schedule_event_cancellations_user_id_idx on public.schedule_event_cancellations (user_id);

alter table public.schedule_event_cancellations enable row level security;

create policy "schedule_event_cancellations_own_row"
  on public.schedule_event_cancellations for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Backfill is empty as of this writing (Opus Lead cleared the only
-- populated `cancelled_on` row in the whole database before this migration
-- landed), but written correctly regardless — this migration may one day
-- run against a branch or a restored snapshot taken before that fix, where
-- the empty-today assumption would be false. Idempotent: safe to re-run.
insert into public.schedule_event_cancellations (event_id, user_id, date)
select id, user_id, cancelled_on
from public.schedule_events
where cancelled_on is not null
on conflict (event_id, date) do nothing;

-- Deprecated 2026-08-25/26, superseded by schedule_event_cancellations
-- (single-column exception could only ever hold one cancelled occurrence
-- per event — cancelling a second occurrence silently un-cancelled the
-- first). No reader in the app writes or reads this column anymore as of
-- this migration. Not dropped: kept as dead/empty until verified in prod,
-- per Opus Lead — safe to drop once confirmed.
comment on column public.schedule_events.cancelled_on is
  'deprecated 2026-08-25, superseded by schedule_event_cancellations, safe to drop once verified in prod';
