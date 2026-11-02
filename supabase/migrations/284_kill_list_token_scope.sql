-- A `kill_list` token scope. Written 2026-11-02, NOT yet applied.
--
-- The MyHomeBase admin console mirrors today's business Kill List with LifeOS. The token pasted into it must be able to do nothing else, so it carries its own scope:
-- `kill_list` grants ONLY `GET /me`, `read business.kill_list_item` and `write business.kill_list_item.set / set_completed / clear` (lib/mcp/tokens.ts
-- KILL_LIST_SCOPE_OPERATIONS; the dispatcher, lib/agent-api/execute.ts, refuses every other operation for a token that lacks read / write). Modelled on `jobs` (279).
--
-- Both tables that constrain scopes list the allowed values in a CHECK: mcp_access_tokens (130, widened by 279) and mcp_oauth_codes (132, widened by 279). Widen both to
-- admit 'kill_list', keeping "at least one scope". Constraint names are looked up, not assumed. agent_connect_codes.scopes (207) and the refresh-token path copy scopes
-- without a CHECK of their own. No existing row changes, no data written.
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
  check (scopes <@ array['read', 'write', 'jobs', 'kill_list']::text[] and cardinality(scopes) > 0);

alter table public.mcp_oauth_codes
  add constraint mcp_oauth_codes_scopes_check
  check (scopes <@ array['read', 'write', 'jobs', 'kill_list']::text[] and cardinality(scopes) > 0);
