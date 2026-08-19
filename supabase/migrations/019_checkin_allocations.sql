-- Phase 1 of docs/superpowers/specs/2026-08-19-checkin-allocation-system.md —
-- replaces the point-sample check-in model with a per-window allocation
-- across domains. `checkins` keeps its existing rows and shape unchanged;
-- legacy point-samples stay valid and readable via `kind = 'point'`
-- (the default). A new `checkins.kind = 'allocation'` row pairs with one
-- checkin_allocations row per domain (including 'wasted', persisted even
-- though it's derived in the UI — the derivation depends on TOTAL_MINUTES,
-- and storing it keeps historical rows self-describing if the window
-- length ever changes).
--
-- `default auth.uid()` on checkin_allocations.user_id is required, not
-- optional — sunnah_logs (017_sunnah_logs.sql) omitted it and produced an
-- Insert type that typechecked and failed at runtime on NOT NULL.

alter table public.checkins add column window_start timestamptz;
alter table public.checkins add column window_end   timestamptz;
alter table public.checkins add column kind text not null default 'point'
  check (kind in ('point', 'allocation'));

create table public.checkin_allocations (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null references public.checkins(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  domain text not null check (domain in ('deen', 'business', 'school', 'fitness', 'co_op', 'wasted')),
  minutes int not null check (minutes >= 0 and minutes % 15 = 0),
  created_at timestamptz not null default now(),
  unique (checkin_id, domain)
);

create index checkin_allocations_user_id_idx on public.checkin_allocations (user_id);
create index checkin_allocations_checkin_id_idx on public.checkin_allocations (checkin_id);

alter table public.checkin_allocations enable row level security;

create policy "checkin_allocations_own_row"
  on public.checkin_allocations for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
