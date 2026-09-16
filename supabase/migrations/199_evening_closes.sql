-- 199: P3-09 -- the evening-close ritual's own idempotent completion mark,
-- the honest anchor for "closed day". Mirrors 153_day_starts.sql's exact
-- shape and reasoning: one row per (user_id, local_date), the unique
-- constraint IS the idempotency guarantee (a second Finish tap on the same
-- night must not move closed_at), no update/delete policy so Weekly
-- Review's efficiency-by-closed-day numbers are never retroactively
-- rewritable.
--
-- local_date is computed in the app via localDateString(now, timezone) and
-- passed as a literal date -- never derived in Postgres, same rule
-- day_starts follows and for the same reason (the UTC-vs-local-evening
-- rollover bug class).
--
-- Written from app/(app)/close/plan-actions.ts's savePlanRanks, ONLY when
-- mode is "tonight" (the real evening-close flow) and only after
-- savePlanRanksCore itself succeeds -- never from "replan" (a next-morning
-- fixup of yesterday's plan, which must not retroactively mark today
-- closed).
create table public.evening_closes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  local_date date not null,
  closed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, local_date)
);

create index evening_closes_user_id_idx on public.evening_closes (user_id);

alter table public.evening_closes enable row level security;

create policy "evening_closes_select_own" on public.evening_closes
  for select using (user_id = (select auth.uid()));

create policy "evening_closes_insert_own" on public.evening_closes
  for insert with check (user_id = (select auth.uid()));

comment on table public.evening_closes is
  'Idempotent evening-close completion mark (P3-09). One row per (user_id, local_date); the unique constraint is the idempotency guarantee. No update/delete policy: once set, closed_at never moves, because Weekly Review''s closed-vs-open efficiency split derives from it.';
