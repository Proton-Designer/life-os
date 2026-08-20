-- docs/superpowers/specs/2026-08-20-coop-redesign.md — "Full CRUD: add,
-- remove, edit content, and MOVE" for targets. 028 built complete()
-- (soft-done, keeps the row for history) and reorder() but not remove()
-- — deletion needs the same atomic position-shift as completion, or a
-- deleted row leaves a permanent gap in the dense rank that every later
-- position <= 3 derivation and reorder call would then read wrong.
--
-- Deleting the row cascades to its coop_tasks via the FK set in 028
-- (on delete cascade) — a deliberate judgment call, not a spec ruling:
-- spec ruling 5 (tasks stay attached for history) governs *completion*,
-- not removal. Flagged to the Opus Lead in the same comment on 028.
create or replace function public.delete_coop_target(p_target_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_position smallint;
begin
  delete from public.coop_targets
  where id = p_target_id and user_id = v_user_id
  returning position into v_position;

  -- v_position is null both when nothing was deleted (not found / not
  -- owned) and when the deleted row was an already-completed target
  -- (position already null, no gap to close) — either way there's
  -- nothing to shift. This also makes a retry on an already-deleted id
  -- a clean no-op rather than a spurious extra shift.
  if v_position is null then
    return;
  end if;

  update public.coop_targets
  set position = position - 1
  where user_id = v_user_id and position > v_position;
end;
$$;

grant execute on function public.delete_coop_target(uuid) to authenticated;
