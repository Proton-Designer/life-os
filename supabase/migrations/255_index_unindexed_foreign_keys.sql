-- NAV/DB audit: index the foreign-key columns that had none.
--
-- A FOREIGN KEY does not index its referencing columns in Postgres. Without one, every ON DELETE
-- CASCADE / SET NULL from the parent (and every parent key check) scans the whole child table, and the
-- app-side lookups by (user_id, parent_id) can't use an index either. The e2e trace that found this:
-- distraction_events (user_id, trigger_id), trigger_action_plans (user_id, trigger_id) and
-- trigger_plan_outcomes (user_id, plan_id) cascade from distraction_triggers with no index on those
-- columns. Harmless at today's size, a cliff as the logs grow.
--
-- Scope: tables that grow per user (events, logs, reviews, card/lesson/chunk tables, sessions, tasks,
-- audit/dispatch logs). Deliberately NOT indexed: small config-shaped children (workout-plan membership,
-- schedule overrides, staging, weekly recaps); add them if the audit query shows them growing.
--
-- Safe to re-run and to apply on a database where some of these already exist: each target is created
-- ONLY if no existing, valid index on that table already has those columns as its leading prefix (in
-- order), so a differently-named index is respected and nothing is duplicated. Tables/columns that do
-- not exist are skipped with a NOTICE, never an error. Plain CREATE INDEX (a brief SHARE lock): fine at
-- this size, and CONCURRENTLY cannot run inside a DO block or the runner's single transaction.
-- Read-only audit with row counts: scripts/audit-unindexed-fks.sql. Reverse: DROP INDEX the *_fkx names.

do $$
declare
  t record;
  cols text[];
  rel regclass;
  have boolean;
  idx_name text;
  made int := 0;
  kept int := 0;
begin
  for t in
    select * from (values
    ('agent_connect_codes', 'minted_token_id'),
    ('mcp_oauth_codes', 'client_id'),
    ('mcp_oauth_refresh_tokens', 'client_id'),
    ('mcp_oauth_refresh_tokens', 'user_id,access_token_id'),
    ('mcp_webhook_deliveries', 'webhook_id'),
    ('mcp_audit_log', 'user_id,token_id'),
    ('mcp_notification_dispatch_log', 'user_id,scheduled_action_id'),
    ('mcp_scheduled_actions', 'user_id,token_id'),
    ('distraction_events', 'user_id,trigger_id'),
    ('distraction_events', 'user_id,session_id'),
    ('distraction_events', 'user_id,reflection_entry_id'),
    ('trigger_action_plans', 'user_id,trigger_id'),
    ('trigger_plan_outcomes', 'user_id,plan_id'),
    ('habit_logs', 'user_id,habit_id'),
    ('deen_habit_logs', 'user_id,habit_id'),
    ('deen_weekly_focus', 'user_id,habit_id'),
    ('lesson_verdicts', 'user_id,promotion_id'),
    ('morning_routine_items', 'user_id,habit_id'),
    ('reviews', 'user_id,card_id'),
    ('reviews', 'user_id,question_id'),
    ('reviews', 'user_id,book_id'),
    ('reviews', 'user_id,session_id'),
    ('card_states', 'user_id,card_id'),
    ('card_states', 'user_id,question_id'),
    ('card_states', 'user_id,book_id'),
    ('cards', 'user_id,lesson_id'),
    ('cards', 'user_id,book_id'),
    ('lessons', 'user_id,book_id'),
    ('lessons', 'user_id,section_id'),
    ('lessons', 'user_id,source_chunk_id'),
    ('source_chunks', 'user_id,book_id'),
    ('source_chunks', 'user_id,section_id'),
    ('book_sections', 'user_id,book_id'),
    ('sources', 'user_id,book_id'),
    ('sources', 'user_id,class_id'),
    ('ingestion_jobs', 'user_id,book_id'),
    ('ingestion_job_stage_attempts', 'user_id,job_id'),
    ('book_ready_notification_log', 'user_id,book_id'),
    ('self_explanations', 'user_id,lesson_id'),
    ('self_explanations', 'user_id,session_id'),
    ('end_of_hour_reflections', 'user_id,card_id'),
    ('session_sets', 'user_id,session_id'),
    ('session_sets', 'user_id,exercise_id'),
    ('workout_sessions', 'user_id,workout_id'),
    ('workout_sessions', 'user_id,plan_session_id'),
    ('workout_schedule', 'user_id,workout_id'),
    ('fitness_benchmarks', 'user_id,exercise_id'),
    ('tasks', 'user_id,class_id'),
    ('work_sessions', 'user_id,class_id'),
    ('work_sessions', 'user_id,kill_list_item_id'),
    ('work_sessions', 'user_id,rep_goal_id'),
    ('work_sessions', 'user_id,promotion_id'),
    ('work_session_objectives', 'user_id,session_id'),
    ('work_session_objectives', 'user_id,task_id'),
    ('work_session_objectives', 'user_id,kill_list_item_id'),
    ('checkins', 'user_id,work_session_id'),
    ('checkin_allocations', 'user_id,checkin_id'),
    ('coop_tasks', 'user_id,target_id'),
    ('class_assessments', 'user_id,class_id'),
    ('class_assessments', 'user_id,task_id'),
    ('class_assessments', 'user_id,category_id'),
    ('grade_categories', 'user_id,class_id'),
    ('practice_tests', 'user_id,class_id'),
    ('practice_test_answers', 'user_id,question_id'),
    ('lecture_recordings', 'user_id,class_id'),
    ('lecture_transcripts', 'user_id,recording_id'),
    ('schedule_events', 'user_id,class_id')
    ) as v(tbl, col_list)
  loop
    rel := to_regclass(format('public.%I', t.tbl));
    cols := string_to_array(t.col_list, ',');
    if rel is null then
      raise notice 'skip %: table does not exist', t.tbl;
      continue;
    end if;
    if (select count(*) from pg_attribute a
         where a.attrelid = rel and not a.attisdropped and a.attname = any (cols)) <> cardinality(cols) then
      raise notice 'skip %(%): a column does not exist', t.tbl, t.col_list;
      continue;
    end if;

    select exists (
      select 1 from pg_index i
       where i.indrelid = rel
         and i.indisvalid
         and (
           select array_agg(a.attname::text order by k.ord)
             from unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
             join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
            where k.ord <= cardinality(cols)
         ) = cols
    ) into have;

    if have then
      kept := kept + 1;
      continue;
    end if;

    idx_name := left(t.tbl || '_' || replace(t.col_list, ',', '_'), 58) || '_fkx';
    execute format('create index if not exists %I on public.%I (%s)', idx_name, t.tbl,
                   (select string_agg(format('%I', c), ', ' order by o) from unnest(cols) with ordinality as u(c, o)));
    made := made + 1;
  end loop;
  raise notice 'fk indexes: % created, % already covered', made, kept;
end
$$;

-- Verification: every target that exists now has a covering index (reads the catalog, so it fails if the
-- loop above silently did nothing).
do $$
declare
  t record;
  cols text[];
  rel regclass;
  missing text := '';
begin
  for t in
    select * from (values
    ('agent_connect_codes', 'minted_token_id'),
    ('mcp_oauth_codes', 'client_id'),
    ('mcp_oauth_refresh_tokens', 'client_id'),
    ('mcp_oauth_refresh_tokens', 'user_id,access_token_id'),
    ('mcp_webhook_deliveries', 'webhook_id'),
    ('mcp_audit_log', 'user_id,token_id'),
    ('mcp_notification_dispatch_log', 'user_id,scheduled_action_id'),
    ('mcp_scheduled_actions', 'user_id,token_id'),
    ('distraction_events', 'user_id,trigger_id'),
    ('distraction_events', 'user_id,session_id'),
    ('distraction_events', 'user_id,reflection_entry_id'),
    ('trigger_action_plans', 'user_id,trigger_id'),
    ('trigger_plan_outcomes', 'user_id,plan_id'),
    ('habit_logs', 'user_id,habit_id'),
    ('deen_habit_logs', 'user_id,habit_id'),
    ('deen_weekly_focus', 'user_id,habit_id'),
    ('lesson_verdicts', 'user_id,promotion_id'),
    ('morning_routine_items', 'user_id,habit_id'),
    ('reviews', 'user_id,card_id'),
    ('reviews', 'user_id,question_id'),
    ('reviews', 'user_id,book_id'),
    ('reviews', 'user_id,session_id'),
    ('card_states', 'user_id,card_id'),
    ('card_states', 'user_id,question_id'),
    ('card_states', 'user_id,book_id'),
    ('cards', 'user_id,lesson_id'),
    ('cards', 'user_id,book_id'),
    ('lessons', 'user_id,book_id'),
    ('lessons', 'user_id,section_id'),
    ('lessons', 'user_id,source_chunk_id'),
    ('source_chunks', 'user_id,book_id'),
    ('source_chunks', 'user_id,section_id'),
    ('book_sections', 'user_id,book_id'),
    ('sources', 'user_id,book_id'),
    ('sources', 'user_id,class_id'),
    ('ingestion_jobs', 'user_id,book_id'),
    ('ingestion_job_stage_attempts', 'user_id,job_id'),
    ('book_ready_notification_log', 'user_id,book_id'),
    ('self_explanations', 'user_id,lesson_id'),
    ('self_explanations', 'user_id,session_id'),
    ('end_of_hour_reflections', 'user_id,card_id'),
    ('session_sets', 'user_id,session_id'),
    ('session_sets', 'user_id,exercise_id'),
    ('workout_sessions', 'user_id,workout_id'),
    ('workout_sessions', 'user_id,plan_session_id'),
    ('workout_schedule', 'user_id,workout_id'),
    ('fitness_benchmarks', 'user_id,exercise_id'),
    ('tasks', 'user_id,class_id'),
    ('work_sessions', 'user_id,class_id'),
    ('work_sessions', 'user_id,kill_list_item_id'),
    ('work_sessions', 'user_id,rep_goal_id'),
    ('work_sessions', 'user_id,promotion_id'),
    ('work_session_objectives', 'user_id,session_id'),
    ('work_session_objectives', 'user_id,task_id'),
    ('work_session_objectives', 'user_id,kill_list_item_id'),
    ('checkins', 'user_id,work_session_id'),
    ('checkin_allocations', 'user_id,checkin_id'),
    ('coop_tasks', 'user_id,target_id'),
    ('class_assessments', 'user_id,class_id'),
    ('class_assessments', 'user_id,task_id'),
    ('class_assessments', 'user_id,category_id'),
    ('grade_categories', 'user_id,class_id'),
    ('practice_tests', 'user_id,class_id'),
    ('practice_test_answers', 'user_id,question_id'),
    ('lecture_recordings', 'user_id,class_id'),
    ('lecture_transcripts', 'user_id,recording_id'),
    ('schedule_events', 'user_id,class_id')
    ) as v(tbl, col_list)
  loop
    rel := to_regclass(format('public.%I', t.tbl));
    cols := string_to_array(t.col_list, ',');
    continue when rel is null;
    continue when (select count(*) from pg_attribute a where a.attrelid = rel and not a.attisdropped and a.attname = any (cols)) <> cardinality(cols);
    if not exists (
      select 1 from pg_index i
       where i.indrelid = rel and i.indisvalid
         and (
           select array_agg(a.attname::text order by k.ord)
             from unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
             join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
            where k.ord <= cardinality(cols)
         ) = cols
    ) then
      missing := missing || format(' %s(%s)', t.tbl, t.col_list);
    end if;
  end loop;
  if missing <> '' then
    raise exception 'fk index migration: still unindexed:%', missing;
  end if;
end
$$;
