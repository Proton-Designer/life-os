-- agent_jobs.claimed_by tenancy. Written and applied 2026-10-25 by the Opus Lead.
--
-- 277 gave agent_jobs.claimed_by a single-column FK to mcp_access_tokens, which preflight's FK-tenancy check flags: a job
-- could reference ANOTHER person's token. claim_agent_jobs already refuses a token that isn't the caller's (277, Lead
-- review), but the house rule (see 100/101) is that the schema makes a cross-account row unrepresentable, not just a function.
--
-- Fix: a composite FK (user_id, claimed_by) -> mcp_access_tokens (user_id, id), using the (user_id, id) unique index
-- migration 150 already created. ON DELETE SET NULL (claimed_by) nulls only the token column (PG 15+), so deleting a
-- token never nulls agent_jobs.user_id.
--
-- IDEMPOTENT on purpose: a botched dry-run (a missing `;` after `begin`) ran the drop + add outside a transaction on
-- 2026-10-25, before this was recorded. agent_jobs had 0 rows, and the resulting state is exactly this file's intent.
-- This version is safe to run on top of that state and on a clean database alike.
-- No begin;/commit; -- the runner owns the transaction.

alter table public.agent_jobs
  drop constraint if exists agent_jobs_claimed_by_fkey;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.agent_jobs'::regclass and conname = 'agent_jobs_claimed_by_same_user'
  ) then
    alter table public.agent_jobs
      add constraint agent_jobs_claimed_by_same_user
        foreign key (user_id, claimed_by) references public.mcp_access_tokens (user_id, id) on delete set null (claimed_by);
  end if;
end;
$$;
