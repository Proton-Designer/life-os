-- Agent-written weekly review narrative. Written 2026-10-25, NOT yet applied.
--
-- Same pattern as migration 274 (agent Morning Brief): collegeos_weekly_narratives is select-only for people (migration 191), so a
-- connected agent writes through SECURITY DEFINER functions that act as auth.uid() and take NO user id. Upsert on the existing unique
-- (user_id, week_start), marked provider = 'mcp', model = the caller's own token label (else 'agent'). The week must be a Sunday
-- (the app's weeks are Sun-Sat). The in-app generator (lib/weekly-review/weekly-narrative.ts) never overwrites it: its fill and
-- release only touch a claim row whose narrative_text is still null. clear_agent_weekly_narrative deletes only provider = 'mcp' rows.
-- Access: authenticated + service_role, never anon. No begin;/commit; -- the runner owns the transaction.

create or replace function public.write_agent_weekly_narrative(p_week_start date, p_text text, p_token_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_text text := btrim(coalesce(p_text, ''));
  v_label text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_week_start is null or extract(dow from p_week_start) <> 0 then
    raise exception 'week_start must be a Sunday' using errcode = '22023';
  end if;
  if char_length(v_text) < 1 or char_length(v_text) > 2000 then
    raise exception 'narrative text must be 1..2000 characters' using errcode = '22023';
  end if;
  if p_token_id is not null then
    select nullif(btrim(label), '') into v_label from public.mcp_access_tokens where id = p_token_id and user_id = v_uid;
  end if;
  insert into public.collegeos_weekly_narratives (user_id, week_start, narrative_text, provider, model, generated_at)
  values (v_uid, p_week_start, v_text, 'mcp', left(coalesce(v_label, 'agent'), 80), now())
  on conflict (user_id, week_start) do update
    set narrative_text = excluded.narrative_text, provider = 'mcp', model = excluded.model, generated_at = excluded.generated_at;
  return 1;
end;
$$;

create or replace function public.clear_agent_weekly_narrative(p_week_start date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_removed integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from public.collegeos_weekly_narratives where user_id = v_uid and week_start = p_week_start and provider = 'mcp';
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke all on function public.write_agent_weekly_narrative(date, text, uuid) from public, anon;
revoke all on function public.clear_agent_weekly_narrative(date) from public, anon;
grant execute on function public.write_agent_weekly_narrative(date, text, uuid) to authenticated, service_role;
grant execute on function public.clear_agent_weekly_narrative(date) to authenticated, service_role;
