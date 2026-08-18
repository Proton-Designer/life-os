-- Phase 3 of docs/superpowers/specs/2026-08-17-prayer-time-intelligence.md —
-- per-user, per-day sunnah (rawatib) completion log. See lib/deen/sunnah.ts
-- for the fixed set of (prayer_name, slot) pairs this table can legally
-- hold; `slot` is not constrained here to one of a fixed set because that
-- set lives in application code (lib/deen/sunnah.ts), not the schema.
--
-- APPLIED 2026-08-17 23:48 CDT via psql against DATABASE_URL, by the Opus
-- Lead, with Ayman's explicit go-ahead ("I already gave you all the
-- credentials previously").
--
-- Why psql and not Supabase MCP: MCP needs an interactive browser OAuth that
-- was blocking work at midnight. The credentials to apply it were already
-- present in .env.local the whole time, so the OAuth was buying bookkeeping
-- (registration in Supabase's own migration-history table), not capability.
-- That trade was made deliberately and is recorded here rather than left
-- silent -- which was the actual failure of migration 016, not the use of
-- psql itself. REGISTERED 2026-08-18 in supabase_migrations.schema_migrations
-- as version 20260818044800, closing the drift this header first recorded as
-- outstanding. Registration turned out to need only the same DB access the
-- apply did -- the OAuth was never load-bearing for it.
--
-- CORRECTION 2026-08-18 00:07 CDT: the original CREATE TABLE in this file
-- (written by the Opus Lead in the spec) omitted `default auth.uid()` on
-- user_id, which every other user-scoped table in this schema has
-- (prayers, deen_habit_logs, quran_sessions all carry it). Two consequences:
-- the generated/hand-written Insert type marks user_id optional, which would
-- have typechecked an insert that then failed at runtime on NOT NULL; and it
-- silently dropped a layer of defense-in-depth. Applied to the live table via
-- ALTER; the CREATE above is amended to match so a from-scratch run agrees
-- with the deployed schema.
--
-- RLS verified by real policy evaluation, not by reading the SQL back:
-- impersonating a different authenticated user (SET LOCAL ROLE authenticated
-- + request.jwt.claims sub) saw 0 rows of an owner's data, the owner saw 1,
-- and a cross-user INSERT attributed to the owner was rejected with
-- "new row violates row-level security policy". Test row deleted; table
-- confirmed empty afterwards.
create table public.sunnah_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  prayer_name text not null,
  slot text not null,
  completed boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, date, prayer_name, slot)
);

alter table public.sunnah_logs enable row level security;

create policy "Users can select own sunnah logs"
  on public.sunnah_logs for select
  using (user_id = auth.uid());

create policy "Users can insert own sunnah logs"
  on public.sunnah_logs for insert
  with check (user_id = auth.uid());

create policy "Users can update own sunnah logs"
  on public.sunnah_logs for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can delete own sunnah logs"
  on public.sunnah_logs for delete
  using (user_id = auth.uid());
