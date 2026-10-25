-- Agent-written "connect this lesson to today" line for the session closer. Written 2026-10-25, NOT yet applied.
--
-- The in-app version (app/(app)/personal/closer-day-connection-actions.ts) generates the line on demand with the person's own AI key
-- and stores nothing. For a person with no key, a connected agent can write it ahead of time, so it has to be stored: one row per
-- (user, card, local day). Composite tenancy FK to cards(user_id, id): a row for another person's card is unrepresentable.
-- RLS: select-own only; writes go through the SECURITY DEFINER functions below, which act as auth.uid() and take NO user id.
-- write_agent_day_connection returns 0 (writes nothing) when the card is not the caller's own, 1 on success.
-- The line is one sentence, 1..220 characters, no line break (the same cap the in-app normalizer uses).
-- Access: authenticated + service_role, never anon. No begin;/commit; -- the runner owns the transaction.

create table public.card_day_connections (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  card_id         uuid not null,
  connection_date date not null,
  connection_text text not null check (char_length(connection_text) between 1 and 220 and connection_text !~ E'[\\n\\r]'),
  provider        text not null default 'mcp',
  model           text,
  generated_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  constraint card_day_connections_user_card_date_key unique (user_id, card_id, connection_date),
  constraint card_day_connections_card_same_user
    foreign key (user_id, card_id) references public.cards (user_id, id) on delete cascade
);

alter table public.card_day_connections enable row level security;

create policy card_day_connections_select_own on public.card_day_connections
  for select using (user_id = (select auth.uid()));

create or replace function public.write_agent_day_connection(p_card_id uuid, p_date date, p_text text, p_token_id uuid default null)
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
  if p_card_id is null or p_date is null then
    raise exception 'card and date are required' using errcode = '22023';
  end if;
  if char_length(v_text) < 1 or char_length(v_text) > 220 or v_text ~ E'[\\n\\r]' then
    raise exception 'connection must be one line of 1..220 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.cards where id = p_card_id and user_id = v_uid) then
    return 0;
  end if;
  if p_token_id is not null then
    select nullif(btrim(label), '') into v_label from public.mcp_access_tokens where id = p_token_id and user_id = v_uid;
  end if;
  insert into public.card_day_connections (user_id, card_id, connection_date, connection_text, provider, model, generated_at)
  values (v_uid, p_card_id, p_date, v_text, 'mcp', left(coalesce(v_label, 'agent'), 80), now())
  on conflict (user_id, card_id, connection_date) do update
    set connection_text = excluded.connection_text, provider = 'mcp', model = excluded.model, generated_at = excluded.generated_at;
  return 1;
end;
$$;

create or replace function public.clear_agent_day_connection(p_card_id uuid, p_date date)
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
  delete from public.card_day_connections where user_id = v_uid and card_id = p_card_id and connection_date = p_date;
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke all on function public.write_agent_day_connection(uuid, date, text, uuid) from public, anon;
revoke all on function public.clear_agent_day_connection(uuid, date) from public, anon;
grant execute on function public.write_agent_day_connection(uuid, date, text, uuid) to authenticated, service_role;
grant execute on function public.clear_agent_day_connection(uuid, date) to authenticated, service_role;
