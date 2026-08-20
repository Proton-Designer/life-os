-- Phase 4 Step 4 (Engineer 2) — the confirm action's idempotency design,
-- left to this phase deliberately by 026_fitness_sessions.sql rather than
-- preempted there. Natural key for "two confirms is a no-op": a confirmed
-- session is uniquely identified by (user, date, workout) — he only ever
-- confirms one workout per day per template. Quick-add and adhoc sessions
-- stay unconstrained: the whole point of the odd-moment case (spec §4) is
-- that scattered same-day entries stay separate rows, never merged.
--
-- Same shape as 022_save_allocation_checkin_idempotent.sql: insert the
-- parent row first (that's what the unique index actually guards), insert
-- its children in the same call, and on unique_violation return the
-- existing session's id instead of erroring. Because the conflict fires on
-- the workout_sessions insert itself — before the session_sets loop ever
-- runs — a second call can never leave a duplicate or partial write behind;
-- PL/pgSQL's implicit per-block savepoint rolls back anything this same
-- call had already written once the exception handler catches.

-- workout_id is nullable (ON DELETE SET NULL when its workout is archived
-- then deleted), and Postgres NULLs never collide in a unique index — a
-- naive `where source = 'confirmed'` predicate would let two confirmed
-- sessions on the same date both land with a null workout_id, silently
-- defeating the whole point of this index. Excluding null workout_id from
-- the predicate is a deliberate choice, not an oversight: a session whose
-- workout has since been deleted is a historical artifact, not something a
-- fresh confirm call is ever re-targeting — new confirms always carry a
-- real workout_id, so this exclusion costs nothing in practice.
create unique index if not exists workout_sessions_confirmed_unique
  on public.workout_sessions (user_id, date, workout_id)
  where source = 'confirmed' and workout_id is not null;

create or replace function public.confirm_workout_session(
  p_date date,
  p_workout_id uuid,
  p_workout_name text,
  p_sets jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session_id uuid;
  v_set jsonb;
begin
  insert into public.workout_sessions (user_id, date, workout_id, workout_name, source)
  values (auth.uid(), p_date, p_workout_id, p_workout_name, 'confirmed')
  returning id into v_session_id;

  for v_set in select * from jsonb_array_elements(p_sets)
  loop
    insert into public.session_sets (
      session_id, user_id, exercise_id, exercise_name, position, sets, reps, load
    )
    values (
      v_session_id,
      auth.uid(),
      (v_set->>'exerciseId')::uuid,
      v_set->>'exerciseName',
      (v_set->>'position')::int,
      (v_set->>'sets')::int,
      (v_set->>'reps')::int,
      nullif(v_set->>'load', '')::numeric
    );
  end loop;

  return v_session_id;
exception
  when unique_violation then
    select id into v_session_id
      from public.workout_sessions
      where user_id = auth.uid()
        and date = p_date
        and workout_id = p_workout_id
        and source = 'confirmed';
    return v_session_id;
end;
$$;

grant execute on function public.confirm_workout_session(date, uuid, text, jsonb) to authenticated;
