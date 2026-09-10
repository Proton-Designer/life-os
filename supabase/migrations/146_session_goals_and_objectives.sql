-- 146: goal-based Lock-In sessions (deep work / deep study).
--
-- Ayman: "before every deep work and deep study session it should first
-- prompt the user asking them exactly how long this session will last, and
-- what their goal for the session is." Adds a target duration and an
-- optional class to `work_sessions`, plus a new `work_session_objectives`
-- table for the per-session checklist (kill-list items, tasks, or a single
-- custom line).
--
-- WRITE-ONLY BY THIS MIGRATION: no application code reads goal_minutes,
-- class_id, or work_session_objectives yet (Phase 2/3, same session). Apply
-- to SCRATCH ONLY — the Opus Lead applies to production.
--
-- FK SHAPE, AND WHY EVERY REFERENCE HERE IS COMPOSITE, NOT SINGLE-COLUMN.
-- The draft this migration was specified from used single-column FKs
-- (`session_id references work_sessions(id)`, etc.). That is exactly the
-- shape migrations 100/101/123/124 exist to close: FK checks bypass RLS, so
-- a single-column FK to a user-scoped parent proves only that the row
-- exists, never that the caller owns it. This table makes it concretely
-- exploitable, not just theoretically: `unique (session_id, position)`
-- below is a Section-1-shaped uniqueness constraint (100's own vocabulary)
-- — it includes the FK column but not user_id. With a single-column FK, a
-- second user could insert an objective row with `session_id` set to
-- SOMEONE ELSE'S session (the FK only checks the id exists, not who owns
-- it) and `user_id` set to their own, colliding on `(session_id, position)`
-- against a slot the victim already used or is about to use — the victim's
-- own insert then fails a uniqueness constraint naming a row that, under
-- their own RLS, does not exist. Composite FKs against each parent's
-- existing `(user_id, id)` unique index (all four already exist —
-- `work_sessions_user_id_id_key` (101), `classes_user_id_id_key` (058),
-- `kill_list_items_user_id_id_key` (123), `tasks_user_id_id_key` (101) — no
-- new index needed) make a cross-tenant reference unrepresentable rather
-- than merely unlikely. Severity today is the same as every prior instance
-- of this class: LifeOS is effectively single-tenant, so this needs a
-- second real user to exploit — not a reason to add an eighth table with
-- the gap, per 101's own reasoning for closing the last seven.
--
-- SCOPED SET NULL, per 129/140: every ON DELETE SET NULL below names its
-- column explicitly. An unqualified SET NULL on a composite key nulls every
-- column of the referencing key, including user_id (NOT NULL everywhere
-- here) — 140 swept eighteen instances of exactly this; this migration adds
-- none.
--
-- goal_minutes HAS NO UPPER-BOUND CHECK HERE, DELIBERATELY. An 8-hour cap
-- (lib/business/session-goal.ts's MAX_GOAL_MINUTES) is a soft product
-- preference — Ayman's own UI won't offer more than an 8h/59m slider — not
-- a data-integrity invariant like "must be positive". Enforcing it in the
-- database would mean any future change to that preference needs a
-- migration; `> 0` is the only claim about this column that is actually
-- structural.
--
-- class_id IS NULLABLE ON work_sessions, NOT REQUIRED: only Deep Study's
-- setup dialog requires a class (Phase 2, app-layer) — Deep Work sessions
-- never set it. The column lives on the shared table because a session has
-- at most one class, same reasoning `work_sessions`' existing
-- kill_list_item_id/rep_goal_id/promotion_id columns already use for
-- one-per-session attribution (123) — untouched by this migration, a
-- different feature (per-session objective LIST vs per-session single
-- commitment attribution) that happens to share a table.

alter table public.work_sessions
  add column goal_minutes int null check (goal_minutes > 0),
  add column class_id uuid null;

alter table public.work_sessions
  add constraint work_sessions_class_same_user
  foreign key (user_id, class_id) references public.classes (user_id, id)
  on delete set null (class_id);

-- ---------------------------------------------------------------------------
-- work_sessions.updated_at — NOT requested by this feature; added because
-- building it exposed a gap in an already-shipped one. The AI Integration
-- connector (peer 4tgqwawv) uses `ended_at` as work_sessions' last-modified
-- marker for cheap resync, verified correct against the table's only two
-- writers at the time (insert-on-start, one UPDATE setting ended_at). This
-- migration adds a third write path (goal_minutes/class_id, set on start,
-- never touching ended_at) that makes that verification false — a session
-- whose goal changed would report as unchanged. Fixed at the source rather
-- than left for the connector to rediscover.
--
-- NULLABLE -> BACKFILL -> SET NOT NULL, not a single-statement DEFAULT
-- now(). A one-statement `not null default now()` stamps every existing
-- session with the MIGRATION's timestamp, permanently claiming every
-- session Ayman has ever run was modified today. This is not a
-- hypothetical: peer 4tgqwawv did exactly that to five of their own tables
-- this week (146 was preceded by their corrective migration, number 147,
-- for the resulting damage — 54 of 77 of his `tasks` rows falsely dated to
-- migration time). coalesce(ended_at, created_at) is the honest value: a
-- finished session was last modified when it ended, an unfinished one when
-- it was created.
alter table public.work_sessions add column updated_at timestamptz;
update public.work_sessions set updated_at = coalesce(ended_at, created_at);
alter table public.work_sessions
  alter column updated_at set not null,
  alter column updated_at set default now();

-- public.touch_updated_at() is migration 074's, already used on 30+ tables
-- (135, 136, 137, 138, 139...) — reused rather than redefined, so this
-- trigger function never drifts into a second copy.
drop trigger if exists work_sessions_touch_updated_at on public.work_sessions;
create trigger work_sessions_touch_updated_at
  before update on public.work_sessions for each row execute function public.touch_updated_at();

comment on column public.work_sessions.updated_at is
  'LOAD-BEARING, NOT DECORATIVE. External readers (the MCP connector) use this
   as the change marker for cheap resync -- "what moved since I last looked".
   Any new write path to this table MUST go through an UPDATE so the
   work_sessions_touch_updated_at trigger fires; a write that bypasses it
   leaves the marker stale and the reader silently reports the row as
   unchanged. This column exists because that is exactly what happened:
   ended_at was the marker, verified correct against the only two writers the
   table had, and migration 146 added goal_minutes/class_id on a path that
   never touches ended_at. Verified-against-current-writers expires the moment
   someone adds a writer.';

-- ---------------------------------------------------------------------------
-- work_session_objectives — the per-session checklist. Many rows per
-- session (unlike work_sessions.kill_list_item_id/rep_goal_id/promotion_id,
-- which is one attribution per session, num_nonnulls <= 1, untouched here).
-- ---------------------------------------------------------------------------
create table public.work_session_objectives (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id         uuid not null,
  position           int not null,
  kind               text not null check (kind in ('kill_list_item', 'task', 'custom')),
  kill_list_item_id  uuid null,
  task_id            uuid null,
  custom_text        text null check (custom_text is null or length(btrim(custom_text)) > 0),

  -- Read carefully before treating this as the source of truth for
  -- kind='kill_list_item'/'task' rows (Phase 3/4, app layer): those two
  -- kinds reference a row that ALREADY has its own independently-editable
  -- completion state (kill_list_items.completed, tasks.completed), toggleable
  -- from surfaces that have nothing to do with this session (the Business
  -- panel, the School task list). This column is written for 'custom' rows,
  -- where no such external row exists. It is NOT kept in sync with the
  -- referenced row's own completion for the other two kinds -- see
  -- app/(app)/business/actions.ts's toggleSessionObjective (Phase 3, same
  -- feature) for why a mirror was rejected in favour of deriving from the
  -- live row: a mirror only written when toggled from inside the Lock-In
  -- overlay silently desyncs the moment the same kill-list item or task is
  -- toggled from /business or /school instead.
  completed          boolean not null default false,
  completed_at       timestamptz,

  created_at         timestamptz not null default now(),

  constraint work_session_objectives_kind_shape check (
    (kind = 'custom' and custom_text is not null and kill_list_item_id is null and task_id is null)
    or (kind = 'task' and task_id is not null and custom_text is null and kill_list_item_id is null)
    or (kind = 'kill_list_item' and kill_list_item_id is not null and custom_text is null and task_id is null)
  ),

  -- Ayman: at most one custom objective per session, alongside any number of
  -- task/kill-list objectives. Composite, ownership-carrying, per the header
  -- note above.
  constraint work_session_objectives_session_same_user
    foreign key (user_id, session_id) references public.work_sessions (user_id, id) on delete cascade,
  -- CASCADE, not SET NULL (caught in review, 2026-09-10) — SET NULL would
  -- collide with work_session_objectives_kind_shape below: deleting a kill
  -- list item would null kill_list_item_id on a row whose kind is still
  -- 'kill_list_item', which the CHECK rejects, which makes the parent
  -- DELETE raise. Same "not slow, not awkward: impossible" shape as 140,
  -- reached from the opposite direction (a CHECK fighting a SET NULL
  -- instead of an unscoped SET NULL fighting a NOT NULL). An objective
  -- pointing at a task or kill-list item that no longer exists isn't a
  -- meaningful objective anyway — removing it from the session on delete is
  -- correct, not just constraint-satisfying.
  constraint work_session_objectives_kill_list_item_same_user
    foreign key (user_id, kill_list_item_id) references public.kill_list_items (user_id, id) on delete cascade,
  constraint work_session_objectives_task_same_user
    foreign key (user_id, task_id) references public.tasks (user_id, id) on delete cascade,

  unique (session_id, position)
);

-- Enforced in the database, not only the UI (Ayman's own rule for this
-- feature, stated about this exact constraint).
create unique index work_session_objectives_one_custom_per_session
  on public.work_session_objectives (session_id)
  where kind = 'custom';

create index work_session_objectives_user_id_idx on public.work_session_objectives (user_id);
create index work_session_objectives_session_id_idx on public.work_session_objectives (session_id);

alter table public.work_session_objectives enable row level security;

create policy "work_session_objectives_own_row"
  on public.work_session_objectives for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

comment on table public.work_session_objectives is
  'Per-session objective checklist for goal-based Lock-In sessions (146). Many rows per session, ordered by `position` (order of selection, not list order). At most one kind=''custom'' row per session, enforced by work_session_objectives_one_custom_per_session. kind=''kill_list_item''/''task'' rows reference rows with their own independently-editable completion state -- read this table''s own `completed` column as authoritative for kind=''custom'' only.';
