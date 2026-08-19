-- Phase "wiring" of docs/superpowers/specs/2026-08-19-checkin-allocation-system.md.
--
-- Saving an allocation check-in writes one checkins parent row plus one
-- checkin_allocations child row per domain (including 'wasted', per the
-- spec — it's derived in the UI but persisted so historical rows stay
-- self-describing if the window length ever changes). A single RPC call is
-- one top-level statement from the client's perspective, so wrapping both
-- writes in a plpgsql function gives atomicity for free — no explicit
-- BEGIN/COMMIT needed, and no new multi-statement-transaction pattern for
-- supabase-js, which this codebase doesn't otherwise use.
--
-- security invoker (the default, stated explicitly): runs with the calling
-- user's privileges, so both tables' existing RLS policies still apply to
-- every insert here — this function is not a privilege-escalation path.
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
end;
$$;

grant execute on function public.save_allocation_checkin(timestamptz, timestamptz, jsonb) to authenticated;
