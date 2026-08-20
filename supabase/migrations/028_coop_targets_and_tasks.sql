-- docs/superpowers/specs/2026-08-20-coop-redesign.md — Co-op's Targets
-- strip, Weekly Agenda, and Backlog->In Progress->Review->Complete
-- pipeline. Deliberately separate from the shared `tasks` table (ruling
-- 2 of the spec): `tasks` is shared with School only (TaskDomain =
-- "school" | "co_op"; Business runs its own Lock-In system), and Co-op's
-- shape (target_id, status, blocked_from) has no meaning for School rows.
-- Bolting these columns onto `tasks` would mean every School row carries
-- three permanently-null columns forever.

create table public.coop_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  deadline date,
  status text not null default 'active' check (status in ('active', 'done')),
  completed_at timestamptz,
  -- One dense-integer rank across the WHOLE queue, not two separate
  -- counters: 1/2/3 are target slots, 4+ are stretch-goal order.
  -- Whether a row is "a target" or "a stretch goal" is derived from
  -- position <= 3, never stored as its own flag — this is what makes
  -- complete_target()'s cascade a pure decrement (see below) and makes
  -- "drag a stretch goal into slot 2" fall out for free. Null once a
  -- target is completed: pulled out of the queue, never deleted (spec
  -- ruling 5 — tasks stay attached for history).
  position smallint,
  created_at timestamptz not null default now(),
  -- DEFERRABLE: reorder_coop_target() below relies on a multi-row shift
  -- transiently colliding mid-transaction (e.g. moving position 1 to 3
  -- briefly leaves two rows at position 1 after the shift UPDATE, before
  -- the second UPDATE resolves it). INITIALLY DEFERRED means this is
  -- checked at COMMIT, not per-statement, without needing an explicit
  -- SET CONSTRAINTS in every caller.
  constraint coop_targets_user_position_unique unique (user_id, position) deferrable initially deferred
);

create index coop_targets_user_id_idx on public.coop_targets (user_id);

alter table public.coop_targets enable row level security;

create policy "coop_targets_own_row"
  on public.coop_targets for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table public.coop_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- CASCADE here is the CRUD "remove a target" path only — spec ruling 5
  -- (tasks stay attached for history) governs *completion*, not deletion.
  -- Deleting an active target deleting its tasks is a judgment call, not
  -- a ruling; flagged to the Opus Lead rather than silently assumed.
  target_id uuid not null references public.coop_targets(id) on delete cascade,
  title text not null,
  deadline date,
  status text not null default 'backlog'
    check (status in ('backlog', 'in_progress', 'review', 'complete', 'blocked')),
  -- Spec ruling 2: blocked is a pause, not a pipeline stage. blocked_from
  -- records what to restore on unblock so unblocking never has to guess.
  -- Only ever read to restore; never used for display logic while blocked.
  blocked_from text check (blocked_from in ('backlog', 'in_progress', 'review', 'complete')),
  created_at timestamptz not null default now(),
  constraint coop_tasks_blocked_from_consistency check (
    (status = 'blocked' and blocked_from is not null) or
    (status <> 'blocked' and blocked_from is null)
  )
);

create index coop_tasks_user_id_idx on public.coop_tasks (user_id);
create index coop_tasks_target_id_idx on public.coop_tasks (target_id);

alter table public.coop_tasks enable row level security;

create policy "coop_tasks_own_row"
  on public.coop_tasks for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Atomic, idempotent completion cascade (spec: "Cascade" section).
-- Idempotent the same way save_allocation_checkin (020/022) and
-- upsert_session_hour (024) are: the guard on `position is not null`
-- makes a repeat call on an already-completed target a no-op rather than
-- a duplicate cascade.
create or replace function public.complete_target(p_target_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_position smallint;
begin
  select position into v_position
  from public.coop_targets
  where id = p_target_id and user_id = v_user_id and position is not null;

  if v_position is null then
    return; -- already completed (or not found/not owned) — idempotent no-op
  end if;

  update public.coop_targets
  set status = 'done', completed_at = now(), position = null
  where id = p_target_id and user_id = v_user_id;

  -- Single statement shifts everything below the completed slot up by
  -- one, whether it was a target slot or a stretch goal — this is the
  -- whole cascade. Deliberately not scoped to "only if v_position <= 3":
  -- spec ruling 3 allows completing any slot, target or stretch, and the
  -- shift is correct either way.
  update public.coop_targets
  set position = position - 1
  where user_id = v_user_id and position > v_position;
end;
$$;

grant execute on function public.complete_target(uuid) to authenticated;

-- Reorder within the dense-rank queue (spec: full target CRUD includes
-- "move to a different position"). Handles both directions in one
-- function; relies on coop_targets_user_position_unique being deferrable
-- (see comment on the constraint above) since the shift UPDATE alone
-- transiently duplicates the moved row's old position.
create or replace function public.reorder_coop_target(p_target_id uuid, p_new_position smallint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_old_position smallint;
begin
  select position into v_old_position
  from public.coop_targets
  where id = p_target_id and user_id = v_user_id;

  if v_old_position is null then
    raise exception 'reorder_coop_target: target % not found, not owned, or already completed', p_target_id;
  end if;

  if p_new_position = v_old_position then
    return; -- no-op, idempotent
  end if;

  if p_new_position < v_old_position then
    update public.coop_targets
    set position = position + 1
    where user_id = v_user_id and position >= p_new_position and position < v_old_position;
  else
    update public.coop_targets
    set position = position - 1
    where user_id = v_user_id and position > v_old_position and position <= p_new_position;
  end if;

  update public.coop_targets
  set position = p_new_position
  where id = p_target_id and user_id = v_user_id;
end;
$$;

grant execute on function public.reorder_coop_target(uuid, smallint) to authenticated;
