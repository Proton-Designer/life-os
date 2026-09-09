-- 131: mcp_audit_log needs to record WHAT was done, not just which of the
-- seven generic tools was called.
--
-- docs/ai-connector/TOOL-ARCHITECTURE.md (adopted, commit 2855e96) collapses
-- the tool surface to 7 generic verbs (`read`, `write`, ...) over a
-- domain/entity/action matrix, so that the tool LIST stays cheap on every
-- turn. That is the right tradeoff for the tool schema. It is the wrong
-- tradeoff for the audit log if `tool_name` alone is what gets recorded:
-- under this design every single call's `tool_name` reads "read" or
-- "write", and `mcp_audit_log`'s entire purpose (migration 130's own
-- header) is letting the owner see what a possibly-injected model actually
-- DID -- "read x 400 times" tells him nothing, the same way a web server
-- access log with every row's path blanked out to "/api" would tell nobody
-- anything about what happened.
--
-- `operation` is the RESOLVED call -- e.g. "deen.prayer.read",
-- "work.task.advance" -- computed from the call's own arguments before
-- dispatch (lib/mcp/tools/read.ts's `resolveReadOperation`, and the write
-- tool's future equivalent), not buried inside the `args` jsonb column
-- where L6's audit UI could not cheaply group or filter on it.
--
-- BACKFILLED, then set NOT NULL -- three steps, not one.
--
-- This file originally did `add column ... not null` in a single statement,
-- on the stated assumption that 130 had not yet been applied so the table
-- would be empty. That assumption came from the lead ("I will apply both
-- together") and the lead then invalidated it by applying 130 alone; by the
-- time this ran, production held real audit rows from a live probe, and the
-- apply FAILED:
--
--   ERROR: column "operation" of relation "mcp_audit_log" contains null values
--
-- It failed atomically -- apply-migration.sh's transaction wrapper meant no
-- half-created column and no ledger row. But the useful lesson is about the
-- proof, not the fix: this was verified green against a scratch Postgres
-- where the table was EMPTY, and `set not null` on an empty table always
-- succeeds. The check could not fail, so it proved nothing about the case it
-- existed to cover. Seed the fixture to the shape of production first.
--
-- The pre-existing rows genuinely predate the concept of a resolved
-- operation, so they get an honest marker rather than a fabricated one --
-- guessing "deen.prayer.read" for them would put a plausible lie in an audit
-- log, which is worse than an obviously-legacy row.

-- No begin;/commit; here: apply-migration.sh wraps the file in a single
-- transaction itself, and a file's own commit; would end the runner's
-- transaction early, leaving anything appended later silently unprotected.

alter table public.mcp_audit_log
  add column operation text;

update public.mcp_audit_log
   set operation = 'legacy.' || tool_name || '.unresolved'
 where operation is null;

alter table public.mcp_audit_log
  alter column operation set not null;

comment on column public.mcp_audit_log.operation is
  'The RESOLVED domain.entity.action this call actually performed, e.g. '
  '"deen.prayer.read" -- never just the generic tool_name ("read"/"write"). '
  'Computed from the call''s own arguments before dispatch, so a denied or '
  'errored call still records what was attempted. This is the column L6''s '
  'audit UI groups/filters on.';

create index if not exists mcp_audit_log_operation_created_at_idx
  on public.mcp_audit_log (operation, created_at desc);
