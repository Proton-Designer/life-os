-- ============================================================================
-- 000_baseline.sql — the schema this repo could not previously build.
--
-- WHY THIS EXISTS (D-029, 2026-09-01)
--
-- Until now `supabase/migrations/` started at 016_. Files 001–015 do not exist
-- anywhere in the repo, so applying the directory to an empty Postgres failed
-- on the very first statement: 016_tasks_completed_at.sql does
-- `alter table public.tasks ...` and nothing had ever created public.tasks.
--
-- The consequence was not "some drift". It was that **no environment could be
-- built from source** — no staging, no CI database, no clean local instance.
-- The only environment that existed was production. 19 of 47 live tables had
-- zero migration history, including profiles, tasks, schedule_events,
-- checkins, prayers, deen_habits, weekly_goals, work_sessions and
-- kill_list_items. That is also why `profiles.onboarding_completed` — which
-- the whole Phase 1 onboarding redirect depends on — appeared in no migration.
--
-- An audit confirmed live is a strict SUPERSET of migration history: nothing
-- the migrations claim to create was missing from live. So baselining is
-- mechanical, not archaeological — nobody had to reconstruct 001–015.
--
-- WHAT THIS FILE IS
--
-- A schema-only dump of the live production database taken 2026-09-01, after
-- migration 056. It is the canonical starting point.
--
-- HOW TO USE IT
--
--   Fresh build:  apply 000_baseline.sql, then ONLY migrations numbered > 056.
--                 Do NOT replay 016–056 on top of it — they are already
--                 folded in, and their ALTERs would fail against the final
--                 column state.
--   Live DB:      do not run this file. It describes what is already there.
--   016–056:      kept for history and for the reasoning in their comments.
--
-- Captured with `supabase db dump --schema-only` (server 17.6). The
-- `ensure_rls` event trigger is appended manually at the end of this file —
-- `db dump` does not emit event triggers, and that omission is precisely the
-- kind of silent gap this baseline exists to close.
-- ============================================================================




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."complete_target"("p_target_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."complete_target"("p_target_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_workout_session"("p_date" "date", "p_workout_id" "uuid", "p_workout_name" "text", "p_sets" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."confirm_workout_session"("p_date" "date", "p_workout_id" "uuid", "p_workout_name" "text", "p_sets" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_class_assessment"("p_assessment_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task_id uuid;
  v_user_id uuid := auth.uid();
begin
  select task_id into v_task_id
  from public.class_assessments
  where id = p_assessment_id and user_id = v_user_id;

  if not found then
    raise exception 'assessment not found or not owned by caller';
  end if;

  delete from public.class_assessments where id = p_assessment_id and user_id = v_user_id;

  if v_task_id is not null then
    delete from public.tasks where id = v_task_id and user_id = v_user_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."delete_class_assessment"("p_assessment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_coop_target"("p_target_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."delete_coop_target"("p_target_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_vault_secrets"("secret_names" "text"[]) RETURNS TABLE("name" "text", "decrypted_secret" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select vault.decrypted_secrets.name, vault.decrypted_secrets.decrypted_secret
  from vault.decrypted_secrets
  where vault.decrypted_secrets.name = any(secret_names);
$$;


ALTER FUNCTION "public"."get_vault_secrets"("secret_names" "text"[]) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."user_subdomains" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "kind" "text",
    "widgets" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "position" smallint NOT NULL,
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_subdomains_kind_check" CHECK (("kind" = ANY (ARRAY['job'::"text", 'business'::"text"])))
);


ALTER TABLE "public"."user_subdomains" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."merge_subdomain_config"("p_subdomain_id" "uuid", "p_patch" "jsonb") RETURNS "public"."user_subdomains"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.user_subdomains;
begin
  update public.user_subdomains
  set config = coalesce(config, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb),
      updated_at = now()
  where id = p_subdomain_id and user_id = auth.uid()
  returning * into v_row;

  if not found then
    raise exception 'user_subdomains row % not found or not owned by caller', p_subdomain_id;
  end if;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."merge_subdomain_config"("p_subdomain_id" "uuid", "p_patch" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_plan_outcome"("p_trigger_id" "uuid", "p_followed" boolean, "p_date" "date", "p_new_plan_body" "text" DEFAULT NULL::"text", "p_reason" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_plan_id uuid;
  v_followed_count int;
  v_skipped_count int;
begin
  select id into v_plan_id
    from public.trigger_action_plans
    where trigger_id = p_trigger_id and superseded_at is null;

  if v_plan_id is null then
    raise exception 'no current plan for trigger %', p_trigger_id;
  end if;

  if p_followed and p_new_plan_body is null then
    raise exception 'newPlanBody is required when followed is true';
  end if;

  insert into public.trigger_plan_outcomes (user_id, trigger_id, plan_id, date, followed)
  values (auth.uid(), p_trigger_id, v_plan_id, p_date, p_followed)
  on conflict (user_id, trigger_id, date)
  do update set followed = excluded.followed, plan_id = excluded.plan_id;

  if p_followed then
    perform public.save_trigger_plan(p_trigger_id, p_new_plan_body, coalesce(p_reason, 'followed_failed'));
    return;
  end if;

  select
    count(*) filter (where followed),
    count(*) filter (where not followed)
    into v_followed_count, v_skipped_count
    from public.trigger_plan_outcomes
    where plan_id = v_plan_id;

  if v_skipped_count >= 3 and v_followed_count = 0 then
    if p_new_plan_body is null then
      raise exception 'newPlanBody is required: this plan has never once survived contact';
    end if;
    perform public.save_trigger_plan(p_trigger_id, p_new_plan_body, coalesce(p_reason, 'never_followed'));
  end if;
end;
$$;


ALTER FUNCTION "public"."record_plan_outcome"("p_trigger_id" "uuid", "p_followed" boolean, "p_date" "date", "p_new_plan_body" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_coop_target"("p_target_id" "uuid", "p_new_position" smallint) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."reorder_coop_target"("p_target_id" "uuid", "p_new_position" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_allocation_checkin"("p_window_start" timestamp with time zone, "p_window_end" timestamp with time zone, "p_allocations" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."save_allocation_checkin"("p_window_start" timestamp with time zone, "p_window_end" timestamp with time zone, "p_allocations" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trigger_action_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "trigger_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "version" integer NOT NULL,
    "superseded_at" timestamp with time zone,
    "supersede_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "trigger_action_plans_supersede_reason_check" CHECK (("supersede_reason" = ANY (ARRAY['followed_failed'::"text", 'never_followed'::"text"])))
);


ALTER TABLE "public"."trigger_action_plans" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_trigger_plan"("p_trigger_id" "uuid", "p_body" "text", "p_reason" "text" DEFAULT NULL::"text") RETURNS "public"."trigger_action_plans"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_next_version int;
  v_row public.trigger_action_plans;
begin
  update public.trigger_action_plans
    set superseded_at = now(), supersede_reason = p_reason
    where trigger_id = p_trigger_id and superseded_at is null;

  select coalesce(max(version), 0) + 1 into v_next_version
    from public.trigger_action_plans
    where trigger_id = p_trigger_id;

  insert into public.trigger_action_plans (user_id, trigger_id, body, version)
  values (auth.uid(), p_trigger_id, p_body, v_next_version)
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."save_trigger_plan"("p_trigger_id" "uuid", "p_body" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_workout"("p_workout_id" "uuid", "p_name" "text", "p_exercises" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."save_workout"("p_workout_id" "uuid", "p_name" "text", "p_exercises" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_session_hour"("p_session_id" "uuid", "p_window_start" timestamp with time zone, "p_window_end" timestamp with time zone, "p_domain" "text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."upsert_session_hour"("p_session_id" "uuid", "p_window_start" timestamp with time zone, "p_window_end" timestamp with time zone, "p_domain" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."active_workout_plans" (
    "user_id" "uuid" NOT NULL,
    "micro_plan_id" "uuid",
    "routine_plan_id" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."active_workout_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."adhkar_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "date" "date" NOT NULL,
    "period" "text" NOT NULL,
    "completed" boolean DEFAULT false NOT NULL,
    CONSTRAINT "adhkar_logs_period_check" CHECK (("period" = ANY (ARRAY['morning'::"text", 'evening'::"text"])))
);


ALTER TABLE "public"."adhkar_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."body_metrics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "date" "date" NOT NULL,
    "weight_lb" numeric,
    "waist_in" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "body_metrics_check" CHECK ((("weight_lb" IS NOT NULL) OR ("waist_in" IS NOT NULL))),
    CONSTRAINT "body_metrics_waist_in_check" CHECK ((("waist_in" IS NULL) OR ("waist_in" > (0)::numeric))),
    CONSTRAINT "body_metrics_weight_lb_check" CHECK ((("weight_lb" IS NULL) OR ("weight_lb" > (0)::numeric)))
);


ALTER TABLE "public"."body_metrics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."checkin_allocations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "checkin_id" "uuid" NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "domain" "text" NOT NULL,
    "minutes" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "checkin_allocations_domain_check" CHECK (("domain" = ANY (ARRAY['deen'::"text", 'business'::"text", 'school'::"text", 'fitness'::"text", 'co_op'::"text", 'wasted'::"text"]))),
    CONSTRAINT "checkin_allocations_minutes_check" CHECK ((("minutes" >= 0) AND (("minutes" % 15) = 0)))
);


ALTER TABLE "public"."checkin_allocations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."checkins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "checkin_time" timestamp with time zone NOT NULL,
    "tag_type" "text",
    "tag_label" "text",
    "tag_ref_id" "uuid",
    "answered" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "work_session_id" "uuid",
    "window_start" timestamp with time zone,
    "window_end" timestamp with time zone,
    "kind" "text" DEFAULT 'point'::"text" NOT NULL,
    CONSTRAINT "checkins_kind_check" CHECK (("kind" = ANY (ARRAY['point'::"text", 'allocation'::"text"]))),
    CONSTRAINT "checkins_tag_type_check" CHECK (("tag_type" = ANY (ARRAY['kill_list'::"text", 'workout'::"text", 'deen'::"text", 'school'::"text", 'co_op'::"text", 'other_work'::"text", 'noise'::"text"])))
);


ALTER TABLE "public"."checkins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."class_assessments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "class_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "date" "date" NOT NULL,
    "task_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "class_assessments_type_check" CHECK (("type" = ANY (ARRAY['quiz'::"text", 'exam'::"text", 'midterm_final'::"text"])))
);


ALTER TABLE "public"."class_assessments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."classes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "short_name" "text",
    "code" "text" NOT NULL,
    "room" "text",
    "instructor" "text",
    "syllabus_path" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "position" integer
);


ALTER TABLE "public"."classes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coop_targets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "title" "text" NOT NULL,
    "deadline" "date",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "completed_at" timestamp with time zone,
    "position" smallint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "coop_targets_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'done'::"text"])))
);


ALTER TABLE "public"."coop_targets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coop_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "target_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "deadline" "date",
    "status" "text" DEFAULT 'backlog'::"text" NOT NULL,
    "blocked_from" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "coop_tasks_blocked_from_check" CHECK (("blocked_from" = ANY (ARRAY['backlog'::"text", 'in_progress'::"text", 'review'::"text", 'complete'::"text"]))),
    CONSTRAINT "coop_tasks_blocked_from_consistency" CHECK (((("status" = 'blocked'::"text") AND ("blocked_from" IS NOT NULL)) OR (("status" <> 'blocked'::"text") AND ("blocked_from" IS NULL)))),
    CONSTRAINT "coop_tasks_status_check" CHECK (("status" = ANY (ARRAY['backlog'::"text", 'in_progress'::"text", 'review'::"text", 'complete'::"text", 'blocked'::"text"])))
);


ALTER TABLE "public"."coop_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."custom_habits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "domain" "text" NOT NULL,
    "name" "text" NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "custom_habits_domain_check" CHECK (("domain" = ANY (ARRAY['deen'::"text", 'fitness'::"text"])))
);


ALTER TABLE "public"."custom_habits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deen_habit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "habit_id" "uuid" NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "date" "date" NOT NULL,
    "completed" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."deen_habit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deen_habits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "committed_date" "date" NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "anchor_cue" "text",
    "commitment_note" "text",
    "stage_override" "text",
    CONSTRAINT "deen_habits_stage_override_check" CHECK (("stage_override" = ANY (ARRAY['active_build'::"text", 'stabilized'::"text", 'locked'::"text"])))
);


ALTER TABLE "public"."deen_habits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deen_weekly_focus" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "week_start_date" "date" NOT NULL,
    "habit_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."deen_weekly_focus" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."distraction_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "trigger_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "reflection_tier" integer,
    "reflection_entry_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "distraction_events_reflection_tier_check" CHECK (("reflection_tier" = ANY (ARRAY[1, 2, 3])))
);


ALTER TABLE "public"."distraction_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."distraction_triggers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "domain" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "distraction_triggers_domain_check" CHECK (("domain" = ANY (ARRAY['deen'::"text", 'business'::"text", 'school'::"text", 'fitness'::"text", 'co_op'::"text"])))
);


ALTER TABLE "public"."distraction_triggers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exercises" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "primary_muscles" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "secondary_muscles" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "exercises_primary_muscles_check" CHECK (("primary_muscles" <@ ARRAY['chest'::"text", 'back_lats'::"text", 'back_mid'::"text", 'front_delt'::"text", 'side_delt'::"text", 'rear_delt'::"text", 'biceps'::"text", 'triceps'::"text", 'core'::"text"])),
    CONSTRAINT "exercises_secondary_muscles_check" CHECK (("secondary_muscles" <@ ARRAY['chest'::"text", 'back_lats'::"text", 'back_mid'::"text", 'front_delt'::"text", 'side_delt'::"text", 'rear_delt'::"text", 'biceps'::"text", 'triceps'::"text", 'core'::"text"]))
);


ALTER TABLE "public"."exercises" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fitness_benchmarks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "date" "date" NOT NULL,
    "exercise_id" "uuid",
    "max_reps" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "fitness_benchmarks_max_reps_check" CHECK (("max_reps" >= 0))
);


ALTER TABLE "public"."fitness_benchmarks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fitness_cycle_anchor" (
    "user_id" "uuid" NOT NULL,
    "anchor_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."fitness_cycle_anchor" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."habit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "habit_id" "uuid" NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "date" "date" NOT NULL,
    "completed" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."habit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kill_list_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "date" "date" NOT NULL,
    "text" "text" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "completed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone
);


ALTER TABLE "public"."kill_list_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "notif_type" "text" NOT NULL,
    "notif_key" "text" NOT NULL,
    "sent_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notification_log_notif_type_check" CHECK (("notif_type" = ANY (ARRAY['prayer'::"text", 'checkin'::"text"])))
);


ALTER TABLE "public"."notification_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_reads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "notification_key" "text" NOT NULL,
    "date" "date" NOT NULL,
    "read_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notification_reads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plan_micro_exercises" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "exercise_id" "uuid" NOT NULL,
    "position" integer NOT NULL,
    "schedule_days" integer[] DEFAULT '{1,2,3,4,5}'::integer[] NOT NULL,
    "goal_type" "text" NOT NULL,
    "goal_value" integer NOT NULL,
    "notes" "text",
    CONSTRAINT "plan_micro_exercises_goal_type_check" CHECK (("goal_type" = ANY (ARRAY['daily_total'::"text", 'frequency'::"text"]))),
    CONSTRAINT "plan_micro_exercises_goal_value_check" CHECK (("goal_value" > 0)),
    CONSTRAINT "plan_micro_exercises_schedule_days_check" CHECK (("schedule_days" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]))
);


ALTER TABLE "public"."plan_micro_exercises" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plan_session_exercises" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "exercise_id" "uuid" NOT NULL,
    "position" integer NOT NULL,
    "duration_minutes" integer NOT NULL,
    "load_lb" numeric,
    "target_sets" integer,
    "target_reps" integer,
    CONSTRAINT "plan_session_exercises_duration_minutes_check" CHECK (("duration_minutes" > 0)),
    CONSTRAINT "plan_session_exercises_load_lb_check" CHECK ((("load_lb" IS NULL) OR ("load_lb" >= (0)::numeric))),
    CONSTRAINT "plan_session_exercises_target_reps_check" CHECK ((("target_reps" IS NULL) OR ("target_reps" > 0))),
    CONSTRAINT "plan_session_exercises_target_sets_check" CHECK ((("target_sets" IS NULL) OR (("target_sets" >= 1) AND ("target_sets" <= 20))))
);


ALTER TABLE "public"."plan_session_exercises" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plan_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "position" integer NOT NULL,
    "schedule_days" integer[] DEFAULT '{1,2,3,4,5}'::integer[] NOT NULL,
    "start_time" time without time zone,
    "workout_id" "uuid",
    CONSTRAINT "plan_sessions_schedule_days_check" CHECK (("schedule_days" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]))
);


ALTER TABLE "public"."plan_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prayers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "date" "date" NOT NULL,
    "prayer_name" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "logged_at" timestamp with time zone,
    CONSTRAINT "prayers_prayer_name_check" CHECK (("prayer_name" = ANY (ARRAY['fajr'::"text", 'dhuhr'::"text", 'asr'::"text", 'maghrib'::"text", 'isha'::"text"]))),
    CONSTRAINT "prayers_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'on_time'::"text", 'qada'::"text", 'missed'::"text"])))
);


ALTER TABLE "public"."prayers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "user_id" "uuid" NOT NULL,
    "display_name" "text",
    "prayer_calc_method" "text" DEFAULT 'MWL'::"text" NOT NULL,
    "asr_madhab" "text" DEFAULT 'standard'::"text" NOT NULL,
    "location_lat" double precision,
    "location_lng" double precision,
    "location_label" "text",
    "timezone" "text" DEFAULT 'America/Chicago'::"text" NOT NULL,
    "qada_owed" integer DEFAULT 0 NOT NULL,
    "pin_lock_enabled" boolean DEFAULT false NOT NULL,
    "pin_hash" "text",
    "checkin_window_start" time without time zone DEFAULT '08:00:00'::time without time zone NOT NULL,
    "checkin_window_end" time without time zone DEFAULT '22:00:00'::time without time zone NOT NULL,
    "checkin_interval_minutes" integer DEFAULT 120 NOT NULL,
    "traveling_mode" boolean DEFAULT false NOT NULL,
    "onboarding_completed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "paused_date" "date",
    "tracking_started_on" "date"
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quran_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "date" "date" NOT NULL,
    "pages_read" integer NOT NULL,
    "surah" "text",
    "juz" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "quran_sessions_pages_read_check" CHECK (("pages_read" > 0))
);


ALTER TABLE "public"."quran_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reflection_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "date" "date" NOT NULL,
    "tier" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reflection_entries_tier_check" CHECK (("tier" = ANY (ARRAY[1, 2, 3])))
);


ALTER TABLE "public"."reflection_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rep_goals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "exercise_id" "uuid" NOT NULL,
    "daily_target" integer NOT NULL,
    "active_days" integer[] DEFAULT '{1,2,3,4,5}'::integer[] NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rep_goals_active_days_check" CHECK (("active_days" <@ ARRAY[0, 1, 2, 3, 4, 5, 6])),
    CONSTRAINT "rep_goals_daily_target_check" CHECK (("daily_target" > 0))
);


ALTER TABLE "public"."rep_goals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schedule_event_cancellations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."schedule_event_cancellations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schedule_event_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "date" "date" NOT NULL,
    "event_time" time without time zone NOT NULL,
    "end_time" time without time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."schedule_event_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schedule_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "domain" "text" NOT NULL,
    "title" "text" NOT NULL,
    "is_recurring" boolean DEFAULT false NOT NULL,
    "day_of_week" integer,
    "event_time" time without time zone,
    "event_date" "date",
    "cancelled_on" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "end_time" time without time zone,
    "location" "text",
    "instructor" "text",
    "class_group_id" "uuid",
    "class_id" "uuid",
    CONSTRAINT "schedule_events_day_of_week_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6))),
    CONSTRAINT "schedule_events_domain_check" CHECK (("domain" = ANY (ARRAY['school'::"text", 'co_op'::"text"])))
);


ALTER TABLE "public"."schedule_events" OWNER TO "postgres";


COMMENT ON COLUMN "public"."schedule_events"."cancelled_on" IS 'deprecated 2026-08-25, superseded by schedule_event_cancellations, safe to drop once verified in prod';



COMMENT ON COLUMN "public"."schedule_events"."class_group_id" IS 'deprecated 2026-08-26, superseded by classes.id via schedule_events.class_id, safe to drop once verified in prod';



CREATE TABLE IF NOT EXISTS "public"."session_sets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "exercise_id" "uuid",
    "exercise_name" "text" NOT NULL,
    "position" integer NOT NULL,
    "sets" integer NOT NULL,
    "reps" integer NOT NULL,
    "load" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "session_sets_load_check" CHECK ((("load" IS NULL) OR ("load" >= (0)::numeric))),
    CONSTRAINT "session_sets_reps_check" CHECK (("reps" >= 0)),
    CONSTRAINT "session_sets_sets_check" CHECK (("sets" > 0))
);


ALTER TABLE "public"."session_sets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sunnah_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "date" "date" NOT NULL,
    "prayer_name" "text" NOT NULL,
    "slot" "text" NOT NULL,
    "completed" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sunnah_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "domain" "text" NOT NULL,
    "title" "text" NOT NULL,
    "due_date" "date",
    "due_time" time without time zone,
    "completed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "task_type" "text",
    "task_type_other_label" "text",
    "class_id" "uuid",
    CONSTRAINT "tasks_domain_check" CHECK (("domain" = ANY (ARRAY['school'::"text", 'co_op'::"text"]))),
    CONSTRAINT "tasks_task_type_check" CHECK (("task_type" = ANY (ARRAY['homework_assignment'::"text", 'quiz'::"text", 'exam'::"text", 'final_midterm'::"text", 'project_paper'::"text", 'reminder'::"text", 'reading_review'::"text", 'other'::"text"]))),
    CONSTRAINT "tasks_task_type_other_label_check" CHECK ((("task_type_other_label" IS NULL) OR ("task_type" = 'other'::"text")))
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trigger_plan_outcomes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "trigger_id" "uuid" NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "followed" boolean NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."trigger_plan_outcomes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_domains" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "key" "text" NOT NULL,
    "position" smallint NOT NULL,
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_domains_key_check" CHECK (("key" = ANY (ARRAY['personal_growth'::"text", 'work'::"text", 'school'::"text"])))
);


ALTER TABLE "public"."user_domains" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weekly_goals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "week_start_date" "date" NOT NULL,
    "domain" "text" NOT NULL,
    "headline" "text" NOT NULL,
    "milestones" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "quran_page_target" integer,
    "locked" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "weekly_goals_domain_check" CHECK (("domain" = ANY (ARRAY['deen'::"text", 'business'::"text"])))
);


ALTER TABLE "public"."weekly_goals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."work_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "kind" "text" DEFAULT 'deep_work'::"text" NOT NULL,
    CONSTRAINT "work_sessions_kind_check" CHECK (("kind" = ANY (ARRAY['deep_work'::"text", 'deep_study'::"text"])))
);


ALTER TABLE "public"."work_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workout_exercises" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workout_id" "uuid" NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "exercise_id" "uuid" NOT NULL,
    "position" integer NOT NULL,
    "target_sets" integer NOT NULL,
    "target_reps_low" integer NOT NULL,
    "target_reps_high" integer NOT NULL,
    "target_load" numeric,
    CONSTRAINT "workout_exercises_check" CHECK (("target_reps_high" >= "target_reps_low")),
    CONSTRAINT "workout_exercises_target_load_check" CHECK ((("target_load" IS NULL) OR ("target_load" >= (0)::numeric))),
    CONSTRAINT "workout_exercises_target_reps_low_check" CHECK (("target_reps_low" > 0)),
    CONSTRAINT "workout_exercises_target_sets_check" CHECK ((("target_sets" >= 1) AND ("target_sets" <= 20)))
);


ALTER TABLE "public"."workout_exercises" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workout_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workout_plans_kind_check" CHECK (("kind" = ANY (ARRAY['micro'::"text", 'routine'::"text"])))
);


ALTER TABLE "public"."workout_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workout_schedule" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "day_of_week" integer NOT NULL,
    "workout_name" "text" NOT NULL,
    "time" time without time zone,
    "duration_minutes" integer,
    "workout_id" "uuid",
    CONSTRAINT "workout_schedule_day_of_week_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6))),
    CONSTRAINT "workout_schedule_duration_minutes_check" CHECK ((("duration_minutes" IS NULL) OR (("duration_minutes" >= 15) AND ("duration_minutes" <= 240) AND (("duration_minutes" % 15) = 0))))
);


ALTER TABLE "public"."workout_schedule" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workout_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "date" "date" NOT NULL,
    "workout_id" "uuid",
    "workout_name" "text",
    "source" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "plan_session_id" "uuid",
    CONSTRAINT "workout_sessions_source_check" CHECK (("source" = ANY (ARRAY['confirmed'::"text", 'adhoc'::"text", 'quick'::"text"])))
);


ALTER TABLE "public"."workout_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."workouts" OWNER TO "postgres";


ALTER TABLE ONLY "public"."active_workout_plans"
    ADD CONSTRAINT "active_workout_plans_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."adhkar_logs"
    ADD CONSTRAINT "adhkar_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."adhkar_logs"
    ADD CONSTRAINT "adhkar_logs_user_id_date_period_key" UNIQUE ("user_id", "date", "period");



ALTER TABLE ONLY "public"."body_metrics"
    ADD CONSTRAINT "body_metrics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."body_metrics"
    ADD CONSTRAINT "body_metrics_user_id_date_key" UNIQUE ("user_id", "date");



ALTER TABLE ONLY "public"."checkin_allocations"
    ADD CONSTRAINT "checkin_allocations_checkin_id_domain_key" UNIQUE ("checkin_id", "domain");



ALTER TABLE ONLY "public"."checkin_allocations"
    ADD CONSTRAINT "checkin_allocations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checkins"
    ADD CONSTRAINT "checkins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."class_assessments"
    ADD CONSTRAINT "class_assessments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coop_targets"
    ADD CONSTRAINT "coop_targets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coop_targets"
    ADD CONSTRAINT "coop_targets_user_position_unique" UNIQUE ("user_id", "position") DEFERRABLE INITIALLY DEFERRED;



ALTER TABLE ONLY "public"."coop_tasks"
    ADD CONSTRAINT "coop_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."custom_habits"
    ADD CONSTRAINT "custom_habits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deen_habit_logs"
    ADD CONSTRAINT "deen_habit_logs_habit_id_date_key" UNIQUE ("habit_id", "date");



ALTER TABLE ONLY "public"."deen_habit_logs"
    ADD CONSTRAINT "deen_habit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deen_habits"
    ADD CONSTRAINT "deen_habits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deen_weekly_focus"
    ADD CONSTRAINT "deen_weekly_focus_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deen_weekly_focus"
    ADD CONSTRAINT "deen_weekly_focus_user_id_week_start_date_key" UNIQUE ("user_id", "week_start_date");



ALTER TABLE ONLY "public"."distraction_events"
    ADD CONSTRAINT "distraction_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."distraction_triggers"
    ADD CONSTRAINT "distraction_triggers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exercises"
    ADD CONSTRAINT "exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fitness_benchmarks"
    ADD CONSTRAINT "fitness_benchmarks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fitness_benchmarks"
    ADD CONSTRAINT "fitness_benchmarks_user_id_date_exercise_id_key" UNIQUE ("user_id", "date", "exercise_id");



ALTER TABLE ONLY "public"."fitness_cycle_anchor"
    ADD CONSTRAINT "fitness_cycle_anchor_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."habit_logs"
    ADD CONSTRAINT "habit_logs_habit_id_date_key" UNIQUE ("habit_id", "date");



ALTER TABLE ONLY "public"."habit_logs"
    ADD CONSTRAINT "habit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kill_list_items"
    ADD CONSTRAINT "kill_list_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kill_list_items"
    ADD CONSTRAINT "kill_list_items_user_date_position_key" UNIQUE ("user_id", "date", "position");



ALTER TABLE ONLY "public"."notification_log"
    ADD CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_log"
    ADD CONSTRAINT "notification_log_user_id_notif_type_notif_key_sent_date_key" UNIQUE ("user_id", "notif_type", "notif_key", "sent_date");



ALTER TABLE ONLY "public"."notification_reads"
    ADD CONSTRAINT "notification_reads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_reads"
    ADD CONSTRAINT "notification_reads_user_id_notification_key_date_key" UNIQUE ("user_id", "notification_key", "date");



ALTER TABLE ONLY "public"."plan_micro_exercises"
    ADD CONSTRAINT "plan_micro_exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plan_micro_exercises"
    ADD CONSTRAINT "plan_micro_exercises_plan_id_position_key" UNIQUE ("plan_id", "position");



ALTER TABLE ONLY "public"."plan_session_exercises"
    ADD CONSTRAINT "plan_session_exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plan_session_exercises"
    ADD CONSTRAINT "plan_session_exercises_session_id_position_key" UNIQUE ("session_id", "position");



ALTER TABLE ONLY "public"."plan_sessions"
    ADD CONSTRAINT "plan_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plan_sessions"
    ADD CONSTRAINT "plan_sessions_plan_id_position_key" UNIQUE ("plan_id", "position");



ALTER TABLE ONLY "public"."prayers"
    ADD CONSTRAINT "prayers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prayers"
    ADD CONSTRAINT "prayers_user_id_date_prayer_name_key" UNIQUE ("user_id", "date", "prayer_name");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quran_sessions"
    ADD CONSTRAINT "quran_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reflection_entries"
    ADD CONSTRAINT "reflection_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rep_goals"
    ADD CONSTRAINT "rep_goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_event_cancellations"
    ADD CONSTRAINT "schedule_event_cancellations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_event_cancellations"
    ADD CONSTRAINT "schedule_event_cancellations_unique" UNIQUE ("event_id", "date");



ALTER TABLE ONLY "public"."schedule_event_overrides"
    ADD CONSTRAINT "schedule_event_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_event_overrides"
    ADD CONSTRAINT "schedule_event_overrides_unique" UNIQUE ("event_id", "date");



ALTER TABLE ONLY "public"."schedule_events"
    ADD CONSTRAINT "schedule_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_sets"
    ADD CONSTRAINT "session_sets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_sets"
    ADD CONSTRAINT "session_sets_session_id_position_key" UNIQUE ("session_id", "position");



ALTER TABLE ONLY "public"."sunnah_logs"
    ADD CONSTRAINT "sunnah_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sunnah_logs"
    ADD CONSTRAINT "sunnah_logs_user_id_date_prayer_name_slot_key" UNIQUE ("user_id", "date", "prayer_name", "slot");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trigger_action_plans"
    ADD CONSTRAINT "trigger_action_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trigger_plan_outcomes"
    ADD CONSTRAINT "trigger_plan_outcomes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_domains"
    ADD CONSTRAINT "user_domains_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_subdomains"
    ADD CONSTRAINT "user_subdomains_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weekly_goals"
    ADD CONSTRAINT "weekly_goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weekly_goals"
    ADD CONSTRAINT "weekly_goals_user_id_week_start_date_domain_key" UNIQUE ("user_id", "week_start_date", "domain");



ALTER TABLE ONLY "public"."work_sessions"
    ADD CONSTRAINT "work_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_exercises"
    ADD CONSTRAINT "workout_exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_exercises"
    ADD CONSTRAINT "workout_exercises_workout_id_position_key" UNIQUE ("workout_id", "position");



ALTER TABLE ONLY "public"."workout_plans"
    ADD CONSTRAINT "workout_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_schedule"
    ADD CONSTRAINT "workout_schedule_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_schedule"
    ADD CONSTRAINT "workout_schedule_user_id_day_of_week_key" UNIQUE ("user_id", "day_of_week");



ALTER TABLE ONLY "public"."workout_sessions"
    ADD CONSTRAINT "workout_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workouts"
    ADD CONSTRAINT "workouts_pkey" PRIMARY KEY ("id");



CREATE INDEX "adhkar_logs_user_id_idx" ON "public"."adhkar_logs" USING "btree" ("user_id");



CREATE INDEX "body_metrics_user_date_idx" ON "public"."body_metrics" USING "btree" ("user_id", "date");



CREATE INDEX "body_metrics_user_id_idx" ON "public"."body_metrics" USING "btree" ("user_id");



CREATE INDEX "checkin_allocations_checkin_id_idx" ON "public"."checkin_allocations" USING "btree" ("checkin_id");



CREATE INDEX "checkin_allocations_user_id_idx" ON "public"."checkin_allocations" USING "btree" ("user_id");



CREATE UNIQUE INDEX "checkins_one_allocation_per_window" ON "public"."checkins" USING "btree" ("user_id", "window_start") WHERE ("kind" = 'allocation'::"text");



CREATE INDEX "checkins_user_id_idx" ON "public"."checkins" USING "btree" ("user_id");



CREATE INDEX "checkins_work_session_id_idx" ON "public"."checkins" USING "btree" ("work_session_id");



CREATE INDEX "class_assessments_class_id_idx" ON "public"."class_assessments" USING "btree" ("class_id");



CREATE INDEX "class_assessments_user_id_idx" ON "public"."class_assessments" USING "btree" ("user_id");



CREATE INDEX "classes_user_id_idx" ON "public"."classes" USING "btree" ("user_id");



CREATE INDEX "coop_targets_user_id_idx" ON "public"."coop_targets" USING "btree" ("user_id");



CREATE INDEX "coop_tasks_target_id_idx" ON "public"."coop_tasks" USING "btree" ("target_id");



CREATE INDEX "coop_tasks_user_id_idx" ON "public"."coop_tasks" USING "btree" ("user_id");



CREATE UNIQUE INDEX "custom_habits_user_domain_name_unique" ON "public"."custom_habits" USING "btree" ("user_id", "domain", "lower"("name")) WHERE (NOT "archived");



CREATE INDEX "custom_habits_user_id_idx" ON "public"."custom_habits" USING "btree" ("user_id");



CREATE INDEX "deen_habit_logs_habit_id_idx" ON "public"."deen_habit_logs" USING "btree" ("habit_id");



CREATE INDEX "deen_habit_logs_user_id_idx" ON "public"."deen_habit_logs" USING "btree" ("user_id");



CREATE INDEX "deen_habits_user_id_idx" ON "public"."deen_habits" USING "btree" ("user_id");



CREATE INDEX "deen_weekly_focus_habit_id_idx" ON "public"."deen_weekly_focus" USING "btree" ("habit_id");



CREATE INDEX "deen_weekly_focus_user_id_idx" ON "public"."deen_weekly_focus" USING "btree" ("user_id");



CREATE INDEX "distraction_events_user_date" ON "public"."distraction_events" USING "btree" ("user_id", "date");



CREATE UNIQUE INDEX "distraction_triggers_unique_name" ON "public"."distraction_triggers" USING "btree" ("user_id", "domain", "lower"("name")) WHERE (NOT "archived");



CREATE INDEX "distraction_triggers_user_id_idx" ON "public"."distraction_triggers" USING "btree" ("user_id");



CREATE INDEX "exercises_user_id_idx" ON "public"."exercises" USING "btree" ("user_id");



CREATE UNIQUE INDEX "exercises_user_name_unique" ON "public"."exercises" USING "btree" ("user_id", "lower"("name")) WHERE (NOT "archived");



CREATE INDEX "fitness_benchmarks_user_date_idx" ON "public"."fitness_benchmarks" USING "btree" ("user_id", "date");



CREATE INDEX "fitness_benchmarks_user_id_idx" ON "public"."fitness_benchmarks" USING "btree" ("user_id");



CREATE INDEX "habit_logs_habit_id_idx" ON "public"."habit_logs" USING "btree" ("habit_id");



CREATE INDEX "habit_logs_user_id_idx" ON "public"."habit_logs" USING "btree" ("user_id");



CREATE INDEX "kill_list_items_user_id_idx" ON "public"."kill_list_items" USING "btree" ("user_id");



CREATE INDEX "notification_log_user_id_idx" ON "public"."notification_log" USING "btree" ("user_id");



CREATE INDEX "notification_reads_user_date_idx" ON "public"."notification_reads" USING "btree" ("user_id", "date");



CREATE INDEX "plan_micro_exercises_plan_id_idx" ON "public"."plan_micro_exercises" USING "btree" ("plan_id");



CREATE INDEX "plan_micro_exercises_user_id_idx" ON "public"."plan_micro_exercises" USING "btree" ("user_id");



CREATE INDEX "plan_session_exercises_session_id_idx" ON "public"."plan_session_exercises" USING "btree" ("session_id");



CREATE INDEX "plan_session_exercises_user_id_idx" ON "public"."plan_session_exercises" USING "btree" ("user_id");



CREATE INDEX "plan_sessions_plan_id_idx" ON "public"."plan_sessions" USING "btree" ("plan_id");



CREATE INDEX "plan_sessions_user_id_idx" ON "public"."plan_sessions" USING "btree" ("user_id");



CREATE INDEX "prayers_user_id_idx" ON "public"."prayers" USING "btree" ("user_id");



CREATE INDEX "push_subscriptions_user_id_idx" ON "public"."push_subscriptions" USING "btree" ("user_id");



CREATE INDEX "quran_sessions_user_id_idx" ON "public"."quran_sessions" USING "btree" ("user_id");



CREATE INDEX "reflection_entries_user_id_idx" ON "public"."reflection_entries" USING "btree" ("user_id");



CREATE UNIQUE INDEX "rep_goals_user_exercise_unique" ON "public"."rep_goals" USING "btree" ("user_id", "exercise_id") WHERE (NOT "archived");



CREATE INDEX "rep_goals_user_id_idx" ON "public"."rep_goals" USING "btree" ("user_id");



CREATE INDEX "schedule_event_cancellations_event_id_idx" ON "public"."schedule_event_cancellations" USING "btree" ("event_id");



CREATE INDEX "schedule_event_cancellations_user_id_idx" ON "public"."schedule_event_cancellations" USING "btree" ("user_id");



CREATE INDEX "schedule_event_overrides_event_id_idx" ON "public"."schedule_event_overrides" USING "btree" ("event_id");



CREATE INDEX "schedule_event_overrides_user_id_idx" ON "public"."schedule_event_overrides" USING "btree" ("user_id");



CREATE INDEX "schedule_events_class_group_id_idx" ON "public"."schedule_events" USING "btree" ("class_group_id") WHERE ("class_group_id" IS NOT NULL);



CREATE INDEX "schedule_events_class_id_idx" ON "public"."schedule_events" USING "btree" ("class_id") WHERE ("class_id" IS NOT NULL);



CREATE INDEX "schedule_events_user_id_idx" ON "public"."schedule_events" USING "btree" ("user_id");



CREATE INDEX "session_sets_session_id_idx" ON "public"."session_sets" USING "btree" ("session_id");



CREATE INDEX "session_sets_user_id_idx" ON "public"."session_sets" USING "btree" ("user_id");



CREATE INDEX "tasks_class_id_idx" ON "public"."tasks" USING "btree" ("class_id") WHERE ("class_id" IS NOT NULL);



CREATE INDEX "tasks_user_id_idx" ON "public"."tasks" USING "btree" ("user_id");



CREATE UNIQUE INDEX "trigger_action_plans_one_current" ON "public"."trigger_action_plans" USING "btree" ("trigger_id") WHERE ("superseded_at" IS NULL);



CREATE INDEX "trigger_action_plans_user_id_idx" ON "public"."trigger_action_plans" USING "btree" ("user_id");



CREATE UNIQUE INDEX "trigger_action_plans_version" ON "public"."trigger_action_plans" USING "btree" ("trigger_id", "version");



CREATE UNIQUE INDEX "trigger_plan_outcomes_one_per_day" ON "public"."trigger_plan_outcomes" USING "btree" ("user_id", "trigger_id", "date");



CREATE INDEX "trigger_plan_outcomes_user_id_idx" ON "public"."trigger_plan_outcomes" USING "btree" ("user_id");



CREATE UNIQUE INDEX "user_domains_user_id_id_unique" ON "public"."user_domains" USING "btree" ("user_id", "id");



CREATE INDEX "user_domains_user_id_idx" ON "public"."user_domains" USING "btree" ("user_id");



CREATE UNIQUE INDEX "user_domains_user_key_unique" ON "public"."user_domains" USING "btree" ("user_id", "key");



CREATE INDEX "user_subdomains_domain_id_idx" ON "public"."user_subdomains" USING "btree" ("domain_id");



CREATE UNIQUE INDEX "user_subdomains_user_domain_key_unique" ON "public"."user_subdomains" USING "btree" ("user_id", "domain_id", "key");



CREATE INDEX "user_subdomains_user_id_idx" ON "public"."user_subdomains" USING "btree" ("user_id");



CREATE INDEX "weekly_goals_user_id_idx" ON "public"."weekly_goals" USING "btree" ("user_id");



CREATE INDEX "work_sessions_user_id_idx" ON "public"."work_sessions" USING "btree" ("user_id");



CREATE INDEX "workout_exercises_user_id_idx" ON "public"."workout_exercises" USING "btree" ("user_id");



CREATE INDEX "workout_exercises_workout_id_idx" ON "public"."workout_exercises" USING "btree" ("workout_id");



CREATE INDEX "workout_plans_user_id_idx" ON "public"."workout_plans" USING "btree" ("user_id");



CREATE UNIQUE INDEX "workout_plans_user_name_unique" ON "public"."workout_plans" USING "btree" ("user_id", "lower"("name")) WHERE (NOT "archived");



CREATE INDEX "workout_schedule_user_id_idx" ON "public"."workout_schedule" USING "btree" ("user_id");



CREATE UNIQUE INDEX "workout_sessions_confirmed_unique" ON "public"."workout_sessions" USING "btree" ("user_id", "date", "workout_id") WHERE (("source" = 'confirmed'::"text") AND ("workout_id" IS NOT NULL));



CREATE UNIQUE INDEX "workout_sessions_plan_session_unique" ON "public"."workout_sessions" USING "btree" ("user_id", "date", "plan_session_id") WHERE (("source" = 'confirmed'::"text") AND ("plan_session_id" IS NOT NULL));



CREATE INDEX "workout_sessions_user_date_idx" ON "public"."workout_sessions" USING "btree" ("user_id", "date");



CREATE INDEX "workout_sessions_user_id_idx" ON "public"."workout_sessions" USING "btree" ("user_id");



CREATE INDEX "workouts_user_id_idx" ON "public"."workouts" USING "btree" ("user_id");



ALTER TABLE ONLY "public"."active_workout_plans"
    ADD CONSTRAINT "active_workout_plans_micro_plan_id_fkey" FOREIGN KEY ("micro_plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."active_workout_plans"
    ADD CONSTRAINT "active_workout_plans_routine_plan_id_fkey" FOREIGN KEY ("routine_plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."active_workout_plans"
    ADD CONSTRAINT "active_workout_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."adhkar_logs"
    ADD CONSTRAINT "adhkar_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."body_metrics"
    ADD CONSTRAINT "body_metrics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checkin_allocations"
    ADD CONSTRAINT "checkin_allocations_checkin_id_fkey" FOREIGN KEY ("checkin_id") REFERENCES "public"."checkins"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checkin_allocations"
    ADD CONSTRAINT "checkin_allocations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checkins"
    ADD CONSTRAINT "checkins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checkins"
    ADD CONSTRAINT "checkins_work_session_id_fkey" FOREIGN KEY ("work_session_id") REFERENCES "public"."work_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."class_assessments"
    ADD CONSTRAINT "class_assessments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_assessments"
    ADD CONSTRAINT "class_assessments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."class_assessments"
    ADD CONSTRAINT "class_assessments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coop_targets"
    ADD CONSTRAINT "coop_targets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coop_tasks"
    ADD CONSTRAINT "coop_tasks_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "public"."coop_targets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coop_tasks"
    ADD CONSTRAINT "coop_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."custom_habits"
    ADD CONSTRAINT "custom_habits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deen_habit_logs"
    ADD CONSTRAINT "deen_habit_logs_habit_id_fkey" FOREIGN KEY ("habit_id") REFERENCES "public"."deen_habits"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deen_habit_logs"
    ADD CONSTRAINT "deen_habit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deen_habits"
    ADD CONSTRAINT "deen_habits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deen_weekly_focus"
    ADD CONSTRAINT "deen_weekly_focus_habit_id_fkey" FOREIGN KEY ("habit_id") REFERENCES "public"."deen_habits"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deen_weekly_focus"
    ADD CONSTRAINT "deen_weekly_focus_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."distraction_events"
    ADD CONSTRAINT "distraction_events_reflection_entry_id_fkey" FOREIGN KEY ("reflection_entry_id") REFERENCES "public"."reflection_entries"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."distraction_events"
    ADD CONSTRAINT "distraction_events_trigger_id_fkey" FOREIGN KEY ("trigger_id") REFERENCES "public"."distraction_triggers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."distraction_events"
    ADD CONSTRAINT "distraction_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."distraction_triggers"
    ADD CONSTRAINT "distraction_triggers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exercises"
    ADD CONSTRAINT "exercises_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fitness_benchmarks"
    ADD CONSTRAINT "fitness_benchmarks_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id");



ALTER TABLE ONLY "public"."fitness_benchmarks"
    ADD CONSTRAINT "fitness_benchmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fitness_cycle_anchor"
    ADD CONSTRAINT "fitness_cycle_anchor_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."habit_logs"
    ADD CONSTRAINT "habit_logs_habit_id_fkey" FOREIGN KEY ("habit_id") REFERENCES "public"."custom_habits"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."habit_logs"
    ADD CONSTRAINT "habit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kill_list_items"
    ADD CONSTRAINT "kill_list_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_log"
    ADD CONSTRAINT "notification_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_reads"
    ADD CONSTRAINT "notification_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plan_micro_exercises"
    ADD CONSTRAINT "plan_micro_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id");



ALTER TABLE ONLY "public"."plan_micro_exercises"
    ADD CONSTRAINT "plan_micro_exercises_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plan_micro_exercises"
    ADD CONSTRAINT "plan_micro_exercises_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plan_session_exercises"
    ADD CONSTRAINT "plan_session_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id");



ALTER TABLE ONLY "public"."plan_session_exercises"
    ADD CONSTRAINT "plan_session_exercises_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."plan_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plan_session_exercises"
    ADD CONSTRAINT "plan_session_exercises_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plan_sessions"
    ADD CONSTRAINT "plan_sessions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plan_sessions"
    ADD CONSTRAINT "plan_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plan_sessions"
    ADD CONSTRAINT "plan_sessions_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."prayers"
    ADD CONSTRAINT "prayers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quran_sessions"
    ADD CONSTRAINT "quran_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reflection_entries"
    ADD CONSTRAINT "reflection_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rep_goals"
    ADD CONSTRAINT "rep_goals_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id");



ALTER TABLE ONLY "public"."rep_goals"
    ADD CONSTRAINT "rep_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_event_cancellations"
    ADD CONSTRAINT "schedule_event_cancellations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."schedule_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_event_cancellations"
    ADD CONSTRAINT "schedule_event_cancellations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_event_overrides"
    ADD CONSTRAINT "schedule_event_overrides_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."schedule_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_event_overrides"
    ADD CONSTRAINT "schedule_event_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_events"
    ADD CONSTRAINT "schedule_events_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."schedule_events"
    ADD CONSTRAINT "schedule_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_sets"
    ADD CONSTRAINT "session_sets_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."session_sets"
    ADD CONSTRAINT "session_sets_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_sets"
    ADD CONSTRAINT "session_sets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sunnah_logs"
    ADD CONSTRAINT "sunnah_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trigger_action_plans"
    ADD CONSTRAINT "trigger_action_plans_trigger_id_fkey" FOREIGN KEY ("trigger_id") REFERENCES "public"."distraction_triggers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trigger_action_plans"
    ADD CONSTRAINT "trigger_action_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trigger_plan_outcomes"
    ADD CONSTRAINT "trigger_plan_outcomes_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."trigger_action_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trigger_plan_outcomes"
    ADD CONSTRAINT "trigger_plan_outcomes_trigger_id_fkey" FOREIGN KEY ("trigger_id") REFERENCES "public"."distraction_triggers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trigger_plan_outcomes"
    ADD CONSTRAINT "trigger_plan_outcomes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_domains"
    ADD CONSTRAINT "user_domains_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_subdomains"
    ADD CONSTRAINT "user_subdomains_domain_same_user" FOREIGN KEY ("user_id", "domain_id") REFERENCES "public"."user_domains"("user_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_subdomains"
    ADD CONSTRAINT "user_subdomains_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weekly_goals"
    ADD CONSTRAINT "weekly_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_sessions"
    ADD CONSTRAINT "work_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_exercises"
    ADD CONSTRAINT "workout_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id");



ALTER TABLE ONLY "public"."workout_exercises"
    ADD CONSTRAINT "workout_exercises_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_exercises"
    ADD CONSTRAINT "workout_exercises_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_plans"
    ADD CONSTRAINT "workout_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_schedule"
    ADD CONSTRAINT "workout_schedule_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_schedule"
    ADD CONSTRAINT "workout_schedule_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workout_sessions"
    ADD CONSTRAINT "workout_sessions_plan_session_id_fkey" FOREIGN KEY ("plan_session_id") REFERENCES "public"."plan_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workout_sessions"
    ADD CONSTRAINT "workout_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_sessions"
    ADD CONSTRAINT "workout_sessions_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workouts"
    ADD CONSTRAINT "workouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Users can delete own sunnah logs" ON "public"."sunnah_logs" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can insert own sunnah logs" ON "public"."sunnah_logs" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can select own sunnah logs" ON "public"."sunnah_logs" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update own sunnah logs" ON "public"."sunnah_logs" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."active_workout_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "active_workout_plans_own_row" ON "public"."active_workout_plans" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."adhkar_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "adhkar_logs_own_row" ON "public"."adhkar_logs" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."body_metrics" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "body_metrics_own_row" ON "public"."body_metrics" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."checkin_allocations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "checkin_allocations_own_row" ON "public"."checkin_allocations" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."checkins" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "checkins_own_row" ON "public"."checkins" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."class_assessments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "class_assessments_own_row" ON "public"."class_assessments" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."classes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "classes_own_row" ON "public"."classes" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."coop_targets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "coop_targets_own_row" ON "public"."coop_targets" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."coop_tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "coop_tasks_own_row" ON "public"."coop_tasks" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."custom_habits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "custom_habits_own_row" ON "public"."custom_habits" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."deen_habit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deen_habit_logs_own_row" ON "public"."deen_habit_logs" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."deen_habits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deen_habits_own_row" ON "public"."deen_habits" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."deen_weekly_focus" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deen_weekly_focus_own_row" ON "public"."deen_weekly_focus" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."distraction_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "distraction_events_own_row" ON "public"."distraction_events" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."distraction_triggers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "distraction_triggers_own_row" ON "public"."distraction_triggers" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."exercises" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "exercises_own_row" ON "public"."exercises" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."fitness_benchmarks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fitness_benchmarks_own_row" ON "public"."fitness_benchmarks" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."fitness_cycle_anchor" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fitness_cycle_anchor_own_row" ON "public"."fitness_cycle_anchor" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."habit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "habit_logs_own_row" ON "public"."habit_logs" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."kill_list_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "kill_list_items_own_row" ON "public"."kill_list_items" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."notification_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notification_log_own_row" ON "public"."notification_log" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."notification_reads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notification_reads_own_row" ON "public"."notification_reads" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."plan_micro_exercises" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "plan_micro_exercises_own_row" ON "public"."plan_micro_exercises" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."plan_session_exercises" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "plan_session_exercises_own_row" ON "public"."plan_session_exercises" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."plan_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "plan_sessions_own_row" ON "public"."plan_sessions" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."prayers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "prayers_own_row" ON "public"."prayers" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_own_row" ON "public"."profiles" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "push_subscriptions_own_row" ON "public"."push_subscriptions" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."quran_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "quran_sessions_own_row" ON "public"."quran_sessions" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."reflection_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reflection_entries_own_row" ON "public"."reflection_entries" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."rep_goals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rep_goals_own_row" ON "public"."rep_goals" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."schedule_event_cancellations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_event_cancellations_own_row" ON "public"."schedule_event_cancellations" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."schedule_event_overrides" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_event_overrides_own_row" ON "public"."schedule_event_overrides" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."schedule_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_events_own_row" ON "public"."schedule_events" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."session_sets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "session_sets_own_row" ON "public"."session_sets" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."sunnah_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tasks_own_row" ON "public"."tasks" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."trigger_action_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trigger_action_plans_own_row" ON "public"."trigger_action_plans" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."trigger_plan_outcomes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trigger_plan_outcomes_own_row" ON "public"."trigger_plan_outcomes" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."user_domains" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_domains_own_row" ON "public"."user_domains" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."user_subdomains" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_subdomains_own_row" ON "public"."user_subdomains" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."weekly_goals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "weekly_goals_own_row" ON "public"."weekly_goals" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."work_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "work_sessions_own_row" ON "public"."work_sessions" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."workout_exercises" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workout_exercises_own_row" ON "public"."workout_exercises" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."workout_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workout_plans_own_row" ON "public"."workout_plans" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."workout_schedule" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workout_schedule_own_row" ON "public"."workout_schedule" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."workout_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workout_sessions_own_row" ON "public"."workout_sessions" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."workouts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workouts_own_row" ON "public"."workouts" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."body_metrics";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."coop_targets";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."coop_tasks";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."deen_habit_logs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."habit_logs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."kill_list_items";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."prayers";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."session_sets";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."sunnah_logs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."tasks";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."workout_sessions";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































GRANT ALL ON FUNCTION "public"."complete_target"("p_target_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."complete_target"("p_target_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_target"("p_target_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."confirm_workout_session"("p_date" "date", "p_workout_id" "uuid", "p_workout_name" "text", "p_sets" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."confirm_workout_session"("p_date" "date", "p_workout_id" "uuid", "p_workout_name" "text", "p_sets" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_workout_session"("p_date" "date", "p_workout_id" "uuid", "p_workout_name" "text", "p_sets" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_class_assessment"("p_assessment_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_class_assessment"("p_assessment_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_class_assessment"("p_assessment_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_coop_target"("p_target_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_coop_target"("p_target_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_coop_target"("p_target_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_vault_secrets"("secret_names" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_vault_secrets"("secret_names" "text"[]) TO "service_role";



GRANT ALL ON TABLE "public"."user_subdomains" TO "anon";
GRANT ALL ON TABLE "public"."user_subdomains" TO "authenticated";
GRANT ALL ON TABLE "public"."user_subdomains" TO "service_role";



GRANT ALL ON FUNCTION "public"."merge_subdomain_config"("p_subdomain_id" "uuid", "p_patch" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."merge_subdomain_config"("p_subdomain_id" "uuid", "p_patch" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."merge_subdomain_config"("p_subdomain_id" "uuid", "p_patch" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."record_plan_outcome"("p_trigger_id" "uuid", "p_followed" boolean, "p_date" "date", "p_new_plan_body" "text", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."record_plan_outcome"("p_trigger_id" "uuid", "p_followed" boolean, "p_date" "date", "p_new_plan_body" "text", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_plan_outcome"("p_trigger_id" "uuid", "p_followed" boolean, "p_date" "date", "p_new_plan_body" "text", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reorder_coop_target"("p_target_id" "uuid", "p_new_position" smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."reorder_coop_target"("p_target_id" "uuid", "p_new_position" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reorder_coop_target"("p_target_id" "uuid", "p_new_position" smallint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."save_allocation_checkin"("p_window_start" timestamp with time zone, "p_window_end" timestamp with time zone, "p_allocations" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."save_allocation_checkin"("p_window_start" timestamp with time zone, "p_window_end" timestamp with time zone, "p_allocations" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_allocation_checkin"("p_window_start" timestamp with time zone, "p_window_end" timestamp with time zone, "p_allocations" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."trigger_action_plans" TO "anon";
GRANT ALL ON TABLE "public"."trigger_action_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."trigger_action_plans" TO "service_role";



GRANT ALL ON FUNCTION "public"."save_trigger_plan"("p_trigger_id" "uuid", "p_body" "text", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."save_trigger_plan"("p_trigger_id" "uuid", "p_body" "text", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_trigger_plan"("p_trigger_id" "uuid", "p_body" "text", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."save_workout"("p_workout_id" "uuid", "p_name" "text", "p_exercises" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."save_workout"("p_workout_id" "uuid", "p_name" "text", "p_exercises" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_workout"("p_workout_id" "uuid", "p_name" "text", "p_exercises" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_session_hour"("p_session_id" "uuid", "p_window_start" timestamp with time zone, "p_window_end" timestamp with time zone, "p_domain" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_session_hour"("p_session_id" "uuid", "p_window_start" timestamp with time zone, "p_window_end" timestamp with time zone, "p_domain" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_session_hour"("p_session_id" "uuid", "p_window_start" timestamp with time zone, "p_window_end" timestamp with time zone, "p_domain" "text") TO "service_role";
























GRANT ALL ON TABLE "public"."active_workout_plans" TO "anon";
GRANT ALL ON TABLE "public"."active_workout_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."active_workout_plans" TO "service_role";



GRANT ALL ON TABLE "public"."adhkar_logs" TO "anon";
GRANT ALL ON TABLE "public"."adhkar_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."adhkar_logs" TO "service_role";



GRANT ALL ON TABLE "public"."body_metrics" TO "anon";
GRANT ALL ON TABLE "public"."body_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."body_metrics" TO "service_role";



GRANT ALL ON TABLE "public"."checkin_allocations" TO "anon";
GRANT ALL ON TABLE "public"."checkin_allocations" TO "authenticated";
GRANT ALL ON TABLE "public"."checkin_allocations" TO "service_role";



GRANT ALL ON TABLE "public"."checkins" TO "anon";
GRANT ALL ON TABLE "public"."checkins" TO "authenticated";
GRANT ALL ON TABLE "public"."checkins" TO "service_role";



GRANT ALL ON TABLE "public"."class_assessments" TO "anon";
GRANT ALL ON TABLE "public"."class_assessments" TO "authenticated";
GRANT ALL ON TABLE "public"."class_assessments" TO "service_role";



GRANT ALL ON TABLE "public"."classes" TO "anon";
GRANT ALL ON TABLE "public"."classes" TO "authenticated";
GRANT ALL ON TABLE "public"."classes" TO "service_role";



GRANT ALL ON TABLE "public"."coop_targets" TO "anon";
GRANT ALL ON TABLE "public"."coop_targets" TO "authenticated";
GRANT ALL ON TABLE "public"."coop_targets" TO "service_role";



GRANT ALL ON TABLE "public"."coop_tasks" TO "anon";
GRANT ALL ON TABLE "public"."coop_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."coop_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."custom_habits" TO "anon";
GRANT ALL ON TABLE "public"."custom_habits" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_habits" TO "service_role";



GRANT ALL ON TABLE "public"."deen_habit_logs" TO "anon";
GRANT ALL ON TABLE "public"."deen_habit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."deen_habit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."deen_habits" TO "anon";
GRANT ALL ON TABLE "public"."deen_habits" TO "authenticated";
GRANT ALL ON TABLE "public"."deen_habits" TO "service_role";



GRANT ALL ON TABLE "public"."deen_weekly_focus" TO "anon";
GRANT ALL ON TABLE "public"."deen_weekly_focus" TO "authenticated";
GRANT ALL ON TABLE "public"."deen_weekly_focus" TO "service_role";



GRANT ALL ON TABLE "public"."distraction_events" TO "anon";
GRANT ALL ON TABLE "public"."distraction_events" TO "authenticated";
GRANT ALL ON TABLE "public"."distraction_events" TO "service_role";



GRANT ALL ON TABLE "public"."distraction_triggers" TO "anon";
GRANT ALL ON TABLE "public"."distraction_triggers" TO "authenticated";
GRANT ALL ON TABLE "public"."distraction_triggers" TO "service_role";



GRANT ALL ON TABLE "public"."exercises" TO "anon";
GRANT ALL ON TABLE "public"."exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."exercises" TO "service_role";



GRANT ALL ON TABLE "public"."fitness_benchmarks" TO "anon";
GRANT ALL ON TABLE "public"."fitness_benchmarks" TO "authenticated";
GRANT ALL ON TABLE "public"."fitness_benchmarks" TO "service_role";



GRANT ALL ON TABLE "public"."fitness_cycle_anchor" TO "anon";
GRANT ALL ON TABLE "public"."fitness_cycle_anchor" TO "authenticated";
GRANT ALL ON TABLE "public"."fitness_cycle_anchor" TO "service_role";



GRANT ALL ON TABLE "public"."habit_logs" TO "anon";
GRANT ALL ON TABLE "public"."habit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."habit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."kill_list_items" TO "anon";
GRANT ALL ON TABLE "public"."kill_list_items" TO "authenticated";
GRANT ALL ON TABLE "public"."kill_list_items" TO "service_role";



GRANT ALL ON TABLE "public"."notification_log" TO "anon";
GRANT ALL ON TABLE "public"."notification_log" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_log" TO "service_role";



GRANT ALL ON TABLE "public"."notification_reads" TO "anon";
GRANT ALL ON TABLE "public"."notification_reads" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_reads" TO "service_role";



GRANT ALL ON TABLE "public"."plan_micro_exercises" TO "anon";
GRANT ALL ON TABLE "public"."plan_micro_exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."plan_micro_exercises" TO "service_role";



GRANT ALL ON TABLE "public"."plan_session_exercises" TO "anon";
GRANT ALL ON TABLE "public"."plan_session_exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."plan_session_exercises" TO "service_role";



GRANT ALL ON TABLE "public"."plan_sessions" TO "anon";
GRANT ALL ON TABLE "public"."plan_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."plan_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."prayers" TO "anon";
GRANT ALL ON TABLE "public"."prayers" TO "authenticated";
GRANT ALL ON TABLE "public"."prayers" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."quran_sessions" TO "anon";
GRANT ALL ON TABLE "public"."quran_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."quran_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."reflection_entries" TO "anon";
GRANT ALL ON TABLE "public"."reflection_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."reflection_entries" TO "service_role";



GRANT ALL ON TABLE "public"."rep_goals" TO "anon";
GRANT ALL ON TABLE "public"."rep_goals" TO "authenticated";
GRANT ALL ON TABLE "public"."rep_goals" TO "service_role";



GRANT ALL ON TABLE "public"."schedule_event_cancellations" TO "anon";
GRANT ALL ON TABLE "public"."schedule_event_cancellations" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_event_cancellations" TO "service_role";



GRANT ALL ON TABLE "public"."schedule_event_overrides" TO "anon";
GRANT ALL ON TABLE "public"."schedule_event_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_event_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."schedule_events" TO "anon";
GRANT ALL ON TABLE "public"."schedule_events" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_events" TO "service_role";



GRANT ALL ON TABLE "public"."session_sets" TO "anon";
GRANT ALL ON TABLE "public"."session_sets" TO "authenticated";
GRANT ALL ON TABLE "public"."session_sets" TO "service_role";



GRANT ALL ON TABLE "public"."sunnah_logs" TO "anon";
GRANT ALL ON TABLE "public"."sunnah_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."sunnah_logs" TO "service_role";



GRANT ALL ON TABLE "public"."tasks" TO "anon";
GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT ALL ON TABLE "public"."trigger_plan_outcomes" TO "anon";
GRANT ALL ON TABLE "public"."trigger_plan_outcomes" TO "authenticated";
GRANT ALL ON TABLE "public"."trigger_plan_outcomes" TO "service_role";



GRANT ALL ON TABLE "public"."user_domains" TO "anon";
GRANT ALL ON TABLE "public"."user_domains" TO "authenticated";
GRANT ALL ON TABLE "public"."user_domains" TO "service_role";



GRANT ALL ON TABLE "public"."weekly_goals" TO "anon";
GRANT ALL ON TABLE "public"."weekly_goals" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_goals" TO "service_role";



GRANT ALL ON TABLE "public"."work_sessions" TO "anon";
GRANT ALL ON TABLE "public"."work_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."work_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."workout_exercises" TO "anon";
GRANT ALL ON TABLE "public"."workout_exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_exercises" TO "service_role";



GRANT ALL ON TABLE "public"."workout_plans" TO "anon";
GRANT ALL ON TABLE "public"."workout_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_plans" TO "service_role";



GRANT ALL ON TABLE "public"."workout_schedule" TO "anon";
GRANT ALL ON TABLE "public"."workout_schedule" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_schedule" TO "service_role";



GRANT ALL ON TABLE "public"."workout_sessions" TO "anon";
GRANT ALL ON TABLE "public"."workout_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."workouts" TO "anon";
GRANT ALL ON TABLE "public"."workouts" TO "authenticated";
GRANT ALL ON TABLE "public"."workouts" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";




































-- ============================================================================
-- APPENDED MANUALLY — not emitted by `supabase db dump`.
--
-- `ensure_rls` is the safety net that auto-enables row level security on every
-- newly created table in `public`. It exists on live and was in no migration,
-- so any rebuilt environment lacked it — meaning a future migration that
-- created a table and forgot RLS would ship silently readable by any
-- authenticated user via PostgREST. All 48 tables are currently RLS-clean;
-- this keeps that true for tables nobody has written yet.
--
-- Teams landing new user-scoped tables must STILL write an explicit
-- `enable row level security` + `<table>_own_row` policy in their own
-- migration. This trigger is belt-and-braces, never the primary guarantee.
-- ============================================================================

drop event trigger if exists ensure_rls;
create event trigger ensure_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();
