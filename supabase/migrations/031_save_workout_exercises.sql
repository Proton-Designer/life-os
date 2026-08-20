-- Phase 3 Step 3/4 (Engineer 2) — the workout builder's Save action.
-- Reorder happens entirely in local component state (add/remove/move-up/
-- move-down never write to the database); this RPC persists the whole
-- ordered exercise list atomically as a delete-then-reinsert, which
-- sidesteps workout_exercises' `unique (workout_id, position)` constraint
-- entirely rather than needing a temp-offset two-phase patch for a swap —
-- there is no intermediate state to collide, because nothing ever writes
-- one until Save.
--
-- security invoker means RLS still applies to every statement here, so a
-- workout that isn't the caller's updates/deletes zero rows rather than
-- leaking — but that's not enough on its own: nothing in workout_exercises'
-- own RLS stops it from referencing another user's exercise_id (the FK only
-- requires the exercise to exist, not that the caller owns it), so this
-- explicitly re-verifies every exercise_id belongs to auth.uid() before
-- inserting. Same "every action re-checks ownership; never trust an id from
-- the client" rule the plan states for Phase 3's server actions generally,
-- applied at the RPC layer since that's the one boundary a client can't
-- route around.

create or replace function public.save_workout(
  p_workout_id uuid,
  p_name text,
  p_exercises jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owned boolean;
  v_exercise jsonb;
  v_position int;
  v_bad_exercise_id uuid;
begin
  select exists(
    select 1 from public.workouts where id = p_workout_id and user_id = auth.uid()
  ) into v_owned;

  if not v_owned then
    raise exception 'workout not found';
  end if;

  select (elem->>'exerciseId')::uuid into v_bad_exercise_id
    from jsonb_array_elements(p_exercises) elem
    where not exists (
      select 1 from public.exercises
      where id = (elem->>'exerciseId')::uuid and user_id = auth.uid()
    )
    limit 1;

  if v_bad_exercise_id is not null then
    raise exception 'exercise % not found', v_bad_exercise_id;
  end if;

  update public.workouts set name = p_name where id = p_workout_id and user_id = auth.uid();

  delete from public.workout_exercises where workout_id = p_workout_id and user_id = auth.uid();

  v_position := 0;
  for v_exercise in select * from jsonb_array_elements(p_exercises)
  loop
    v_position := v_position + 1;
    insert into public.workout_exercises (
      workout_id, exercise_id, position, target_sets, target_reps_low, target_reps_high, target_load
    )
    values (
      p_workout_id,
      (v_exercise->>'exerciseId')::uuid,
      v_position,
      (v_exercise->>'targetSets')::int,
      (v_exercise->>'targetRepsLow')::int,
      (v_exercise->>'targetRepsHigh')::int,
      nullif(v_exercise->>'targetLoad', '')::numeric
    );
  end loop;
end;
$$;

grant execute on function public.save_workout(uuid, text, jsonb) to authenticated;
