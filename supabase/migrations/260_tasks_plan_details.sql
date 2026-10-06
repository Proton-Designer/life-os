-- 260: Plan details on a task -- which domain a planned task belongs to, how long to work on it, an inline
-- timer's start, its manual order, and the Kill List slot it was mirrored into.
--
-- Builds on the Night Plan columns (113 mit_rank/planned_date, 192 planned_start_time). Five additive, nullable
-- columns on `tasks`; no backfill, no existing query/index/policy changes, so every existing row and writer behaves
-- exactly as before.
--
--   plan_area               the user's own domain the person attached this plan line to, so the day can be
--                           analysed by domain: one of user_domains.key (business, school, work, body, faith,
--                           learning, personal_growth). Deliberately NOT tasks.domain: that column is the
--                           school/co_op TASK HOME and gates which list a row appears in; plan_area is only "what
--                           area of life is this", and may name a domain that has no task list at all. A loose
--                           shape CHECK rather than a closed list, because user_domains.key has been re-cut before
--                           (migration 115) and a second CHECK to keep in step is how that drift happens.
--   planned_duration_minutes  "work on this for N minutes" -- a timer length, not an estimate the app calibrates
--                           on (192's rule against estimate columns stands: this is a user-chosen block, set only
--                           when the person asks for a timer, and never read by the arbiter's `cost`).
--   timer_started_at        when an inline timer was started on a task that has no work-session home (a plain or
--                           Faith/Fitness/... task). NULL = not running. A countdown if planned_duration_minutes is
--                           set, an elapsed count otherwise.
--   plan_order              the person's own manual order within the plan (smallint, lower first). Timed lines sort
--                           by their start time first; this orders everything else and breaks ties.
--   kill_list_item_id       the Kill List slot a Business plan line was mirrored into ("Add to Kill List"). Lets
--                           Home show the pair once and keeps their completion in step.
--
-- THE FK IS COMPOSITE AND ITS SET NULL IS SCOPED. Tenancy FKs here are (user_id, id); `on delete set null` with no
-- column list would null user_id too (the 129 incident), so deleting a kill-list row that a plan line points at would
-- raise. `on delete set null (kill_list_item_id)` (PG 15+; the server is 17.x) nulls only the link.
--
-- No begin;/commit; -- the runner owns the transaction.

alter table public.tasks
  add column plan_area text
    constraint tasks_plan_area_shape check (plan_area ~ '^[a-z_]{2,32}$'),
  add column planned_duration_minutes smallint
    constraint tasks_planned_duration_range check (planned_duration_minutes between 1 and 1440),
  add column timer_started_at timestamptz,
  add column plan_order smallint
    constraint tasks_plan_order_range check (plan_order between 0 and 999),
  add column kill_list_item_id uuid;

alter table public.tasks
  add constraint tasks_kill_list_item_fk
    foreign key (user_id, kill_list_item_id) references public.kill_list_items (user_id, id)
    on delete set null (kill_list_item_id);

-- Home resolves "the kill list item this plan line is paired with" and the reverse; a partial index keeps that
-- lookup off the table scan without taxing the (vast majority of) rows that carry no link.
create index tasks_kill_list_item_id_idx on public.tasks (user_id, kill_list_item_id) where kill_list_item_id is not null;
