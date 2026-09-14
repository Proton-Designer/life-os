-- Phase 1 item #4 (ingestion driver), the schema half. Allocated `166` by
-- the Phase-1 Opus lead, 2026-09-14.
--
-- The cron.schedule() + vault.create_secret registration is DELIBERATELY
-- NOT in this file. Per supabase/migrations/ALLOCATIONS.md's own "Operator
-- actions on production" section, both existing pg_cron jobs
-- (dispatch-notifications-every-15min, mcp-scheduled-actions-every-5min)
-- were registered by hand, outside any migration, and logged there instead
-- -- cron.job/vault rows are operator state, not schema, and apply-
-- migration.sh's wrapped transaction is not the established path for them
-- in this codebase. See the separate hand-run snippet handed to the lead
-- alongside this file, modeled on jobid 2's exact idiom.
--
-- WHY THIS TABLE IS LOAD-BEARING, NOT COSMETIC: `isIngestionAvailable()`
-- (lib/self-mastery/ingestion-availability.ts) is the ONLY gate on the
-- self-mastery upload affordance, and it reads exactly one row from this
-- table. Confirmed against production directly before writing this file:
-- `ingestion_driver_heartbeats` did not exist (zero rows in
-- information_schema.tables), so the gate has been failing closed on every
-- call so far independent of whether a driver is even running -- its own
-- liveness table was never created. Both halves of the upload-button
-- blocker (this table, and the missing `SELF_MASTERY_INGESTION_SECRET` in
-- Vercel production) are fixed together; neither alone was enough.
--
-- SINGLETON BY CONSTRAINT, NOT CONVENTION: `id` is CHECKed to the literal
-- value 1, matching `ingestion-availability.ts`'s own hardcoded
-- `HEARTBEAT_ROW_ID = 1` -- a second row is structurally impossible, not
-- merely discouraged.
--
-- THE SEED ROW IS REQUIRED, NOT OPTIONAL, AND ITS TIMESTAMP MATTERS:
-- `recordIngestionDriverHeartbeat` does an UPDATE ... WHERE id = 1, never
-- an upsert. With no seeded row, every heartbeat write matches zero rows,
-- returns no error (an UPDATE matching nothing is not a Postgres error),
-- and `recordIngestionDriverHeartbeat` would keep reporting `true` while
-- silently writing nothing -- the exact "mechanism runs, nothing observes
-- it failing" shape this phase exists to close, one layer under the gate
-- itself. Seeded deliberately STALE (epoch), not `now()`: a `now()` seed
-- would make `isIngestionAvailable()` read "available" for up to
-- HEARTBEAT_STALE_AFTER_MS (5 minutes) after this migration lands, before
-- any real driver tick has happened -- putting an upload button in front
-- of a user with no worker behind it, the exact failure the gate exists to
-- prevent. Epoch guarantees the gate reads closed until the cron-driven
-- route's first genuine authenticated invocation moves it forward.
--
-- RLS enabled per this codebase's blanket rule (every public table does),
-- with NO policies for anon/authenticated: this row is pure operational
-- state with no per-user meaning, read and written exclusively through
-- `createServiceRoleClient()` (ingestion-availability.ts's own header:
-- "this is infrastructure state ... not user data"), which bypasses RLS
-- entirely. Zero policies is correct here, not an oversight -- there is no
-- legitimate session-scoped caller to grant one to.
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

create table public.ingestion_driver_heartbeats (
  id smallint primary key,
  last_polled_at timestamptz not null,
  constraint ingestion_driver_heartbeats_singleton check (id = 1)
);

comment on table public.ingestion_driver_heartbeats is
  'Phase 1 #4: single-row liveness signal for the self-mastery ingestion '
  'driver (app/api/self-mastery/ingestion/step), written on every '
  'authenticated invocation regardless of outcome. isIngestionAvailable() '
  '(lib/self-mastery/ingestion-availability.ts) is the ONLY consumer -- '
  'its recency, not a credential or a scheduled cron row, is what gates '
  'the upload affordance. Service-role read/write only; not user data.';

comment on column public.ingestion_driver_heartbeats.last_polled_at is
  'Set by recordIngestionDriverHeartbeat() on every authenticated hit to '
  'the ingestion step route, success or not. Seeded at epoch so the gate '
  'reads unavailable until a real driver tick moves it forward.';

alter table public.ingestion_driver_heartbeats enable row level security;
-- Deliberately no policies: service_role bypasses RLS and is the only
-- caller this table has (see header). Enabling RLS with zero policies
-- denies anon/authenticated entirely, which is the correct default-deny
-- posture for infrastructure state with no legitimate session-scoped reader.

insert into public.ingestion_driver_heartbeats (id, last_polled_at)
values (1, 'epoch'::timestamptz);
