-- Requested by the Opus Lead: now that checkins_one_allocation_per_window
-- (021) makes a double-write for the same (user, window) impossible at the
-- database level, decide how save_allocation_checkin (020) reacts to
-- hitting it — a reload mid-save, two tabs, or a client retry after a
-- timeout where the write actually landed are all real paths to a second
-- call for the same window.
--
-- Treated as success, not an error: a duplicate save means the intended
-- state is already recorded. Surfacing an error to the user for that would
-- read as "did this fail?" when the honest answer is "this already
-- happened" — and PL/pgSQL's implicit per-block savepoint means the
-- checkins insert failing here rolls back any checkin_allocations rows this
-- same call had already written, so there's never a half-written duplicate
-- left behind to clean up.
create or replace function public.save_allocation_checkin(
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_allocations jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_checkin_id uuid;
  v_domain text;
  v_minutes int;
begin
  insert into public.checkins (user_id, checkin_time, kind, window_start, window_end, answered)
  values (auth.uid(), p_window_end, 'allocation', p_window_start, p_window_end, true)
  returning id into v_checkin_id;

  for v_domain, v_minutes in
    select key, value::int from jsonb_each_text(p_allocations)
  loop
    insert into public.checkin_allocations (checkin_id, user_id, domain, minutes)
    values (v_checkin_id, auth.uid(), v_domain, v_minutes);
  end loop;

  return v_checkin_id;
exception
  when unique_violation then
    select id into v_checkin_id
      from public.checkins
      where user_id = auth.uid() and window_start = p_window_start and kind = 'allocation';
    return v_checkin_id;
end;
$$;

grant execute on function public.save_allocation_checkin(timestamptz, timestamptz, jsonb) to authenticated;
