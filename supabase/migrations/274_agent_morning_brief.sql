-- Agent-written Morning Brief. Written 2026-10-25, NOT yet applied: Opus Lead reviews, dry-runs and applies.
--
-- An MCP-connected agent (Claude / ChatGPT scheduled task) writes the person's Morning Brief through day.morning_brief.write.
-- The MCP session is a user-scoped JWT (RLS applies) and ai_morning_briefs has no write policy for people (migration 182: select
-- only, the nightly cron writes as service role). Rather than opening the table to INSERT/UPDATE/DELETE by authenticated users
-- (which would let any signed-in browser session forge a "brief"), the two writes go through the functions below.
--
-- TENANCY: both functions act as auth.uid() and take NO user id, so a token cannot write another person's brief. The optional
-- token id only names the source: the label is read from mcp_access_tokens restricted to the caller's own token row.
--
-- OVERWRITE: write_agent_morning_brief upserts on the existing (user_id, brief_date) unique key, replacing a built-in brief, and
-- marks the row provider = 'mcp', model = the token's label (or 'agent'), generated_at = now(). The nightly cron never overwrites
-- it: its claim insert hits the unique key, and its fill / release only touch rows whose brief_text is still null (code change in
-- lib/ai/morning-brief.ts).
--
-- clear_agent_morning_brief deletes only an agent row (provider = 'mcp'), never a built-in brief, and returns how many it removed.
--
-- Access: EXECUTE for authenticated and service_role only; never anon. No begin;/commit; -- the runner owns the transaction.

create or replace function public.write_agent_morning_brief(p_date date, p_text text, p_token_id uuid default null)
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
  if p_date is null then
    raise exception 'p_date is required' using errcode = '22023';
  end if;
  if char_length(v_text) < 1 or char_length(v_text) > 2000 then
    raise exception 'brief text must be 1..2000 characters' using errcode = '22023';
  end if;

  if p_token_id is not null then
    select nullif(btrim(label), '') into v_label
      from public.mcp_access_tokens
     where id = p_token_id and user_id = v_uid;
  end if;

  insert into public.ai_morning_briefs (user_id, brief_date, brief_text, provider, model, generated_at)
  values (v_uid, p_date, v_text, 'mcp', left(coalesce(v_label, 'agent'), 80), now())
  on conflict (user_id, brief_date) do update
    set brief_text = excluded.brief_text,
        provider = 'mcp',
        model = excluded.model,
        generated_at = excluded.generated_at;
  return 1;
end;
$$;

create or replace function public.clear_agent_morning_brief(p_date date)
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
  delete from public.ai_morning_briefs
   where user_id = v_uid and brief_date = p_date and provider = 'mcp';
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke all on function public.write_agent_morning_brief(date, text, uuid) from public, anon;
revoke all on function public.clear_agent_morning_brief(date) from public, anon;
grant execute on function public.write_agent_morning_brief(date, text, uuid) to authenticated, service_role;
grant execute on function public.clear_agent_morning_brief(date) to authenticated, service_role;
