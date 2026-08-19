-- docs/superpowers/specs/2026-08-19-missed-lockin-hours.md — every hour is
-- editable, Signal <-> wasted, any time, and an edit must update in place
-- rather than duplicate (a double-write here would silently double-count
-- the same 60 minutes exactly like the 2h check-in flow could before
-- 021/022_save_allocation_checkin_idempotent.sql).
--
-- Reuses checkins_one_allocation_per_window (021, on (user_id,
-- window_start) where kind='allocation') as the ON CONFLICT target — no
-- new index needed, since a session-hour row is a checkins row with
-- kind='allocation' the same as the 2h allocation rows, and the hour's own
-- window_start is exactly the key that index already enforces uniqueness
-- on. Unlike save_allocation_checkin's idempotent-no-op-on-conflict
-- (020/022), THIS one must actually update the stored value on conflict —
-- Signal -> wasted -> Signal is the entire point of "every hour is
-- editable" — so it's a distinct function, not a reuse of that one.
--
-- checkin_allocations rows are deleted and rewritten rather than upserted
-- on (checkin_id, domain), because the domain itself can change between
-- calls (business -> wasted or back) — an upsert keyed on domain would
-- leave the OLD domain's row behind alongside the new one.
create or replace function public.upsert_session_hour(
  p_session_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_domain text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_checkin_id uuid;
begin
  if p_domain not in ('business', 'wasted') then
    raise exception 'upsert_session_hour: p_domain must be business or wasted, got %', p_domain;
  end if;

  insert into public.checkins (user_id, checkin_time, kind, window_start, window_end, answered, work_session_id)
  values (auth.uid(), p_window_end, 'allocation', p_window_start, p_window_end, true, p_session_id)
  on conflict (user_id, window_start) where kind = 'allocation'
  do update set answered = true, work_session_id = p_session_id
  returning id into v_checkin_id;

  delete from public.checkin_allocations where checkin_id = v_checkin_id;
  insert into public.checkin_allocations (checkin_id, user_id, domain, minutes)
  values (v_checkin_id, auth.uid(), p_domain, 60);

  return v_checkin_id;
end;
$$;

grant execute on function public.upsert_session_hour(uuid, timestamptz, timestamptz, text) to authenticated;
