-- ULM: `ingestion_jobs` — worker job-queue state for book ingestion. This
-- table carries the two worst bugs ULM ever shipped; both are landed FIXED
-- here, not replayed historically. Grepped every ULM migration touching
-- this table, not just the base schema.
--
-- 🔴 BUG 1 — every finished book got wiped and rebuilt on a ~5-minute loop,
-- indefinitely, three times before it was caught. Root cause (two parts,
-- per `20260815074000_l2_claim_excludes_terminal_stage.sql`):
--   1. The worker's own handleJob() never marked a successfully completed
--      job's `stage` terminal — an application-layer fix (apps/worker),
--      out of scope for this migration.
--   2. `claim_ingestion_job`'s claim query never excluded 'done'/'failed'
--      jobs — only `leased_until` and `attempts` gated eligibility, so a
--      finished job whose lease naturally expired 5 minutes after
--      completion stayed claimable forever. THIS is the DB-side fix, and
--      it's landed directly below: `stage not in ('done', 'failed')`.
--
-- 🔴 BUG 2 — heartbeat must be progress-dependent, never timer-driven, or a
-- hung job holds its lease forever while looking perfectly healthy (two
-- individually reasonable decisions composing into an immortal task).
-- IMPORTANT: `heartbeat_ingestion_job` below is an unconditional lease
-- extension — it has no way to know from inside the database whether the
-- worker actually made progress since the last call. That discipline
-- cannot live in this RPC; it has to live in the CALLER (the worker only
-- calls this after completing a real pipeline stage, never on a bare
-- timer). This migration does not and cannot enforce that — flagging
-- explicitly rather than silently claiming it's handled here, since the
-- shape of this bug is exactly "looked fine from every angle except the
-- one nobody checked."
--
-- Also checked and NOT ported: `20260815075000_l2_content_hash_dedup.sql`
-- does not touch `ingestion_jobs` at all (it adds `content_hash`/
-- `duplicate_of` to `books`) — out of scope for this file.
-- `20260815073000_l2_reingest_guard.sql`'s `reingest` column IS ported
-- (below), but its actual guard enforcement is worker-side application
-- logic (checking the flag before calling wipeBookData()), not a DB-level
-- WHERE clause — the claim query itself doesn't reference `reingest`
-- (confirmed against the fix's own final version) and neither does this
-- migration.

create table public.ingestion_jobs (
  id             uuid primary key default gen_random_uuid(),
  book_id        uuid not null unique references public.books(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  stage          public.ingest_stage not null default 'queued',
  attempts       int not null default 0,
  max_attempts   int not null default 3,
  leased_until   timestamptz,
  heartbeat_at   timestamptz,
  last_error     text,
  -- The explicit opt-in for the one legitimate case of re-processing an
  -- already-`ready` book. Default false: every job created by the normal
  -- upload flow (a book that is NOT yet ready) is unaffected.
  reingest       boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger ingestion_jobs_set_user_id
  before insert or update of book_id on public.ingestion_jobs
  for each row execute function public.set_user_id_from_book();

create function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger ingestion_jobs_touch_updated_at
  before update on public.ingestion_jobs
  for each row execute function public.touch_updated_at();

-- Atomic job claiming: `FOR UPDATE SKIP LOCKED` is the standard atomic
-- job-queue claim pattern, needed because a plain `UPDATE ... LIMIT 1
-- RETURNING *` isn't expressible safely over PostgREST and a SELECT-then-
-- UPDATE from the worker would race two worker instances onto the same
-- job. service_role only. This is the FIXED version — `stage not in
-- ('done', 'failed')` is the fix for bug 1 above, present from the start
-- here, not added later.
create function public.claim_ingestion_job()
returns public.ingestion_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.ingestion_jobs;
begin
  update public.ingestion_jobs
  set leased_until = now() + interval '5 minutes',
      heartbeat_at = now(),
      attempts = attempts + 1
  where id = (
    select id from public.ingestion_jobs
    where (leased_until is null or leased_until < now())
      and attempts < max_attempts
      and stage not in ('done', 'failed')
    order by created_at asc
    limit 1
    for update skip locked
  )
  returning * into claimed;

  return claimed;
end;
$$;

revoke execute on function public.claim_ingestion_job() from public;
grant execute on function public.claim_ingestion_job() to service_role;

-- Refresh the lease while a worker is actively processing a job. See the
-- header comment: this unconditionally extends the lease on every call —
-- progress-dependence is the CALLER's discipline, not something this SQL
-- primitive can verify.
create function public.heartbeat_ingestion_job(p_job_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ingestion_jobs
  set leased_until = now() + interval '5 minutes',
      heartbeat_at = now()
  where id = p_job_id;
$$;

revoke execute on function public.heartbeat_ingestion_job(uuid) from public;
grant execute on function public.heartbeat_ingestion_job(uuid) to service_role;

create index ingestion_jobs_leased_until on public.ingestion_jobs (leased_until)
  where leased_until is not null;

alter table public.ingestion_jobs enable row level security;

-- User-visible for progress polling; writes are worker-only in practice
-- (service_role bypasses RLS by default, so no separate role-based policy
-- is needed for the worker to write here).
create policy ingestion_jobs_own_row on public.ingestion_jobs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
