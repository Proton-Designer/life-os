-- ULM platform tables, batch 1 addition: `user_stats`. Same shape and
-- reasoning as 066_ulm_user_settings.sql (self-owned, user_id PK defaulted
-- from auth.uid(), RLS with check doing real work, no trigger). Column list
-- deliberately narrowed to the Opus Lead's scoped list — streak/session
-- aggregate columns beyond current_streak/longest_streak/freezes_available/
-- last_session_date (week-boundary freeze accounting, total counters) belong
-- to the later batch that lands `complete_session` and the rest of the
-- queue RPCs, explicitly out of scope here; this table is designed to grow
-- those columns via a later ALTER, not to pre-guess their shape now.

create table public.user_stats (
  user_id             uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  current_streak      int not null default 0,
  longest_streak      int not null default 0,
  freezes_available   int not null default 0,
  last_session_date   date
);

alter table public.user_stats enable row level security;

create policy user_stats_own_row on public.user_stats
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
