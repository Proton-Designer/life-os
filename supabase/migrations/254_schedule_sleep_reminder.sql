-- RS-03: schedule the sleep reminder. app/api/cron/sleep-reminder/route.ts has never been
-- polled: no cron.job calls it and sleep_reminder_log has 0 rows, so neither the 21:30
-- reminder nor the IA-P4a wind-down reminder has ever fired.
--
-- Same shape as the proven `mcp-scheduled-actions-every-5min` (ALLOCATIONS.md, "Operator
-- actions"): net.http_post to vault `app_url` + route, bearer from vault `mcp_cron_secret`
-- (the value of the route's CRON_SECRET). The secret is never in plaintext in cron.job.
-- Every 15 min is safe: dispatchSleepReminders claims (user_id, sent_date) in
-- sleep_reminder_log BEFORE pushing, and only touches profiles with sleep_plan ON and
-- sleep_reminder_enabled; each user's own wind-down window (<= 2 h) decides who is due.
--
-- Idempotent (unschedule-if-exists first). Needs the vault entries `app_url` and
-- `mcp_cron_secret`, which already exist in production. Reverse:
--   select cron.unschedule('sleep-reminder-every-15min');

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sleep-reminder-every-15min') then
    perform cron.unschedule('sleep-reminder-every-15min');
  end if;

  perform cron.schedule(
    'sleep-reminder-every-15min',
    '*/15 * * * *',
    $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/sleep-reminder',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mcp_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
    $job$
  );
end
$$;

-- Verification: the job exists, is active, on the right schedule, and targets the route.
do $$
declare
  j record;
begin
  select jobname, schedule, active, command into j from cron.job where jobname = 'sleep-reminder-every-15min';
  if not found then raise exception 'RS-03: sleep-reminder-every-15min was not scheduled'; end if;
  if j.schedule <> '*/15 * * * *' or not j.active then
    raise exception 'RS-03: job has schedule % active %', j.schedule, j.active;
  end if;
  if position('/api/cron/sleep-reminder' in j.command) = 0
     or position('mcp_cron_secret' in j.command) = 0 then
    raise exception 'RS-03: job command does not target the route with the vault secret';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'app_url')
     or not exists (select 1 from vault.decrypted_secrets where name = 'mcp_cron_secret') then
    raise exception 'RS-03: vault app_url / mcp_cron_secret missing; the job would call nowhere';
  end if;
end
$$;
