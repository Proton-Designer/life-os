-- 153: Day Structure wake mark (#33).
--
-- One row per (user_id, local_date). The unique constraint IS the
-- idempotency guarantee -- not app-layer dedup, which two concurrent taps
-- would race past. Tapping "Start day" twice cannot move woke_at.
--
-- No update or delete policy, deliberately. Once a day is marked started,
-- that mark is structurally immovable rather than immovable by convention:
-- Delta and Efficiency are both derived from woke_at, so an editable wake
-- mark would make every downstream number retroactively re-writable.
--
-- local_date is computed in the app via localDateString(now, timezone) and
-- passed as a literal date. It is never derived in Postgres -- deriving a
-- calendar date server-side reintroduces the UTC-vs-local-evening rollover
-- bug this codebase has shipped more than once.
create table public.day_starts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  local_date date not null,
  woke_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, local_date)
);

create index day_starts_user_id_idx on public.day_starts (user_id);

alter table public.day_starts enable row level security;

create policy "day_starts_select_own" on public.day_starts
  for select using (user_id = (select auth.uid()));

create policy "day_starts_insert_own" on public.day_starts
  for insert with check (user_id = (select auth.uid()));

comment on table public.day_starts is
  'Idempotent wake mark (#33, Day Structure). One row per (user_id, local_date); the unique constraint is the idempotency guarantee. No update/delete policy: once set, a wake mark never moves, because Delta and Efficiency derive from it.';
