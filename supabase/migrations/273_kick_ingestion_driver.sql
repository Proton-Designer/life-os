-- Self-chaining for the ingestion driver. Written 2026-10-25, NOT yet applied: Opus Lead reviews, dry-runs and applies.
--
-- THE PROBLEM: the step route now loops (claim -> stage -> advance) for up to ~240 s per call. When it stops because the
-- time budget ran out, work remains, and waiting for the next 1-minute cron tick wastes up to a minute per run.
--
-- THE KICK: kick_ingestion_driver(p_hop) lets the route ask the DATABASE to POST to the step route again, through pg_net:
-- the same origin, URL, bearer and request shape as the cron job that already gets 200s. pg_net is asynchronous (the call
-- returns at once), so the route never waits on the next run and nothing can be lost to a frozen function.
--
-- RATE GUARD (atomic, in the same RPC): ingestion_driver_heartbeats.last_kicked_at. A kick is sent only if the previous one
-- was more than 20 s ago, so a runaway chain is capped at 3 kicks a minute no matter what the caller does. The hop number is
-- passed as the x-ingestion-hop header; the route caps the chain at 30 hops and the cron resumes after that.
--
-- TIMEOUT: pg_net's default request timeout is 5 s. A looping route answers after ~240 s, so the kick AND the cron job are
-- given timeout_milliseconds := 290000 (just over the route's 280 s maxDuration). Without it pg_net hangs up at 5 s.
--
-- Access: SECURITY DEFINER (it reads vault secrets), EXECUTE for service_role ONLY (the route's server-side client); never
-- anon/authenticated. It takes no URL or secret from the caller: both come from the vault, exactly like the cron job.
-- No begin;/commit; -- the runner owns the transaction.

alter table public.ingestion_driver_heartbeats
  add column if not exists last_kicked_at timestamptz;

create or replace function public.kick_ingestion_driver(p_hop integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text;
  v_secret text;
  v_claimed integer;
begin
  if p_hop is null or p_hop < 1 or p_hop > 30 then
    return false;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'self_mastery_ingestion_secret';
  if v_url is null or v_secret is null then
    return false; -- not configured here (a fresh environment): nothing to kick, the cron is the only driver
  end if;

  -- Atomic rate guard: only the caller whose UPDATE matches a row (no kick in the last 20 s) goes on to send one.
  update public.ingestion_driver_heartbeats
     set last_kicked_at = now()
   where id = 1
     and (last_kicked_at is null or last_kicked_at < now() - interval '20 seconds');
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    return false;
  end if;

  perform net.http_post(
    url := v_url || '/api/self-mastery/ingestion/step',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret,
      'x-ingestion-hop', p_hop::text
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 290000
  );
  return true;
end;
$$;

revoke execute on function public.kick_ingestion_driver(integer) from public, anon, authenticated;
grant execute on function public.kick_ingestion_driver(integer) to service_role;

comment on function public.kick_ingestion_driver(integer) is
  'service_role only: pg_net POST to the ingestion step route (vault app_url + secret), hop in x-ingestion-hop, at most one kick per 20 s (ingestion_driver_heartbeats.last_kicked_at). Returns whether a kick was sent.';

-- The cron path must wait as long as the kick does (the route now answers after up to ~240 s). Same command as jobid 5 with
-- timeout_milliseconds added; found by name so a different job id in another environment still works, and skipped if absent.
do $$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'self-mastery-ingestion-driver-every-1min';
  if v_job is not null then
    perform cron.alter_job(
      v_job,
      command := $cmd$select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/self-mastery/ingestion/step', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'self_mastery_ingestion_secret')), body := '{}'::jsonb, timeout_milliseconds := 290000) as request_id;$cmd$
    );
  end if;
end $$;

-- Shape asserts (same habit as 172 / 271): only the server-side role can kick, and the rate-guard column exists.
do $$
begin
  if has_function_privilege('anon', 'public.kick_ingestion_driver(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.kick_ingestion_driver(integer)', 'execute') then
    raise exception '273 shape assert: a client role can execute kick_ingestion_driver';
  end if;
  if not has_function_privilege('service_role', 'public.kick_ingestion_driver(integer)', 'execute') then
    raise exception '273 shape assert: service_role cannot execute kick_ingestion_driver';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ingestion_driver_heartbeats' and column_name = 'last_kicked_at') then
    raise exception '273 shape assert: last_kicked_at is missing';
  end if;
end $$;
