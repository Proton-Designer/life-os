-- 172 -- close client access to the three ingestion-pipeline RPCs.
--
-- FOUND 2026-09-14 by the Phase-1 lead while reviewing 171: these are
-- SECURITY DEFINER functions with NO auth.uid() / ownership check in their
-- bodies, yet EXECUTE was held by `anon` and `authenticated` (Supabase's
-- default privileges grant both on every new public function; a
-- `revoke ... from public` does not remove those explicit grants -- which is
-- also why 171's own revoke left its new function exposed).
--
--   claim_ingestion_job()          takes no arguments and claims the next
--                                  queued job GLOBALLY: anyone holding the
--                                  public anon key could lease another
--                                  tenant's job for six minutes (stalling
--                                  their upload) and read back its row,
--                                  including user_id and book_id.
--   advance_ingestion_cursor(...)  mutates any job by id, no tenant check.
--   skip_ingestion_cursor_position(...)  same shape, added by 171.
--
-- The ONLY caller of all three is app/api/self-mastery/ingestion/step/
-- route.ts, which uses createServiceRoleClient() (route.ts:3,145) -- so
-- service_role keeps EXECUTE and nothing in the app changes behaviour.
-- No begin;/commit; -- the runner owns the transaction.

revoke execute on function public.claim_ingestion_job() from public, anon, authenticated;
revoke execute on function public.advance_ingestion_cursor(uuid, public.ingest_stage, integer, integer, public.ingest_stage, integer) from public, anon, authenticated;
revoke execute on function public.skip_ingestion_cursor_position(uuid, public.ingest_stage, integer, integer, public.ingest_stage, integer, text) from public, anon, authenticated;

grant execute on function public.claim_ingestion_job() to service_role;
grant execute on function public.advance_ingestion_cursor(uuid, public.ingest_stage, integer, integer, public.ingest_stage, integer) to service_role;
grant execute on function public.skip_ingestion_cursor_position(uuid, public.ingest_stage, integer, integer, public.ingest_stage, integer, text) to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'public.claim_ingestion_job()',
    'public.advance_ingestion_cursor(uuid, public.ingest_stage, integer, integer, public.ingest_stage, integer)',
    'public.skip_ingestion_cursor_position(uuid, public.ingest_stage, integer, integer, public.ingest_stage, integer, text)'
  ] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '172 shape assert: % is still executable by a client role', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '172 shape assert: service_role lost execute on %', f;
    end if;
  end loop;
end $$;
