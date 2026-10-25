-- A `jobs` token scope. Written 2026-10-25, NOT yet applied.
--
-- The agent that works the queued jobs (migration 277) reads third-party text (a professor's announcement, a syllabus). A token minted
-- for it should be able to do nothing else. The `jobs` scope grants ONLY `read agent.job` and `write agent.job.claim / submit / fail`;
-- the dispatcher (lib/agent-api/execute.ts via lib/mcp/tokens.ts tokenAllowsOperation) refuses every other operation for a token that
-- lacks read / write.
--
-- Both tables that constrain scopes list the allowed values in a CHECK: mcp_access_tokens (migration 130) and mcp_oauth_codes
-- (migration 132). Widen both to admit 'jobs', keeping "at least one scope". Constraint names are looked up, not assumed (130 named it
-- implicitly). agent_connect_codes.scopes (207) and the refresh-token path copy scopes without a CHECK of their own.
-- No begin;/commit; -- the runner owns the transaction.

do $$
declare
  c record;
begin
  for c in
    select conrelid::regclass::text as tbl, conname
      from pg_constraint
     where contype = 'c'
       and conrelid in ('public.mcp_access_tokens'::regclass, 'public.mcp_oauth_codes'::regclass)
       and pg_get_constraintdef(oid) like '%scopes%<@%'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end;
$$;

alter table public.mcp_access_tokens
  add constraint mcp_access_tokens_scopes_check
  check (scopes <@ array['read', 'write', 'jobs']::text[] and cardinality(scopes) > 0);

alter table public.mcp_oauth_codes
  add constraint mcp_oauth_codes_scopes_check
  check (scopes <@ array['read', 'write', 'jobs']::text[] and cardinality(scopes) > 0);
