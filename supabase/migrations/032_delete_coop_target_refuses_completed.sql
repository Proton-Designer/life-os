-- Opus Lead catch on 030 (delete_coop_target, 87b8b11): the unconditional
-- cascade to coop_tasks was correct for an ACTIVE target and silently
-- destructive for a COMPLETED one. Ruling 5 keeps a completed target's
-- tasks for history — that's the entire reason complete_target() sets
-- position = null instead of deleting the row. "Remove" was meant to mean
-- "I typed this by accident," not "this happened and is over"; that
-- reasoning only holds pre-completion. Same shape of bug, same fix, as
-- app/(app)/fitness/actions.ts's removeHabit being an archive rather than
-- a hard delete (a habit delete would cascade-destroy its historical logs
-- and streak data the same way).
--
-- Ruled: refuse outright (raise) rather than silently no-op or require a
-- confirmation dialog — simplest, can't be mis-tapped, and a deliberate
-- purge can be added later if ever wanted. The UI must not offer "remove"
-- on a completed target at all; this is the backstop, not the only guard.
--
-- The prior version's implicit-NULL-comparison behavior on an
-- already-completed row (position > NULL matches nothing, so the shift
-- silently touched zero rows) was actually the safe outcome for THAT
-- half of the bug — but relying on it was fragile and gave no signal to
-- the caller. Replaced with an explicit status = 'active' guard that
-- raises, so a completed-target delete attempt fails loudly instead of
-- quietly succeeding at nothing.
create or replace function public.delete_coop_target(p_target_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_position smallint;
  v_status text;
begin
  select status, position into v_status, v_position
  from public.coop_targets
  where id = p_target_id and user_id = v_user_id;

  if v_status is null then
    return; -- not found / not owned — idempotent no-op, same as before
  end if;

  if v_status = 'done' then
    raise exception 'delete_coop_target: cannot delete a completed target (id %) — its tasks are kept for history', p_target_id;
  end if;

  delete from public.coop_targets
  where id = p_target_id and user_id = v_user_id;

  update public.coop_targets
  set position = position - 1
  where user_id = v_user_id and position > v_position;
end;
$$;
