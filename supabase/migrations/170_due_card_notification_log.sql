-- 170 — `due_card_notification_log` (#10: daily notification naming a real
-- due card). NUMBER RESERVED FOR THIS TRACK BY THE LEAD (ALLOCATIONS.md's
-- "170 | reserved spare for goals-builder" row) — do not apply until the
-- lead confirms.
--
-- THE DEDUP MECHANISM IS A DB UNIQUENESS, NOT MEMORY (the lead's explicit
-- requirement): `unique (user_id, sent_date)` — at most one row per user
-- per local calendar day, the same discipline every other scarcity
-- constraint in this schema uses (goals_rank_per_month_idx, migration 165;
-- goal_milestones_user_goal_month_key, same file). `sent_date` is a plain
-- `date`, computed by the caller from `localDateString(now, tz)` (never a
-- raw `Date`, CLAUDE.md's hard constraint) — this is the user's OWN LOCAL
-- day, not the server's UTC day, so "daily" means what the user experiences
-- as daily.
--
-- WHY A NEW TABLE, NOT A WRITE INTO THE EXISTING `notification_log` --
-- SAME REASONING migration 145's header already gives for the identical
-- question about `mcp_notification_dispatch_log`: `notification_log` is
-- `supabase/functions/dispatch-notifications/index.ts`'s OWN bookkeeping
-- (a Deno Edge Function, prayer/checkin-only, its `notif_type` CHECK
-- constrained to exactly those two values) — touching its schema or
-- writing into it from this Next.js codebase would be precisely the
-- "on the way past" scope creep the lead ruled out for that feature, and
-- widening its CHECK for an unrelated notification kind risks that
-- function's own logic in a file this track does not own and was told not
-- to touch. A new, dedicated table this feature owns outright is the same
-- move 145 already made for the identical shape of decision.
--
-- `user_id NOT NULL DEFAULT auth.uid()` -- matches every other per-user log
-- table in this schema, though the only real writer is the service-role
-- cron route (app/api/cron/daily-due-card/route.ts), which always supplies
-- `user_id` explicitly (the default only matters for a hypothetical
-- user-session write, which this table's own RLS policy below does not
-- permit anyway).
--
-- RLS: SELECT-only for the owning user, same posture migration 145 took on
-- `mcp_notification_dispatch_log` ("a delivery ledger with the identical
-- shape of concern") and migration 130 took on `mcp_audit_log` ("an audit
-- log its subject can edit is not an audit log"). INSERT/UPDATE/DELETE
-- happen exclusively through the service-role cron route.
--
-- No begin;/commit; -- the runner owns the transaction (files >110 that
-- carry their own fail the apply, per migration 111's history).

create table public.due_card_notification_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sent_date  date not null,
  created_at timestamptz not null default now(),
  -- THE CEILING: at most one row per user per local day. See this
  -- migration's header for why this is a DB constraint, not app-layer
  -- memory.
  constraint due_card_notification_log_user_date_key unique (user_id, sent_date)
);

comment on table public.due_card_notification_log is
  '#10''s daily-dispatch idempotency ledger -- at most one due-card push notification per user per local day, enforced by due_card_notification_log_user_date_key, not by in-process memory. A dedicated table, not a write into notification_log (that table is supabase/functions/dispatch-notifications/index.ts''s own bookkeeping -- see this migration''s header for the full reasoning, mirroring migration 145''s identical decision for mcp_notification_dispatch_log).';

alter table public.due_card_notification_log enable row level security;

-- Select-only for the owning user -- INSERT/UPDATE/DELETE happen
-- exclusively through the service-role cron route.
create policy due_card_notification_log_select_own on public.due_card_notification_log
  for select using (user_id = (select auth.uid()));

do $$
declare
  v_cols int;
  v_key int;
  v_rls boolean;
  v_policies int;
  v_insertable_by_authenticated boolean;
begin
  select count(*) into v_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'due_card_notification_log'
     and column_name in ('id','user_id','sent_date','created_at');
  if v_cols <> 4 then
    raise exception '170: due_card_notification_log expected 4 known columns, found %', v_cols;
  end if;

  select count(*) into v_key from pg_constraint
   where conname = 'due_card_notification_log_user_date_key' and contype = 'u';
  if v_key <> 1 then
    raise exception '170: due_card_notification_log_user_date_key is absent -- #10 has no per-day ceiling';
  end if;

  select relrowsecurity into v_rls from pg_class where relname = 'due_card_notification_log' and relnamespace = 'public'::regnamespace;
  if not coalesce(v_rls, false) then
    raise exception '170: RLS not enabled on due_card_notification_log';
  end if;

  select count(*) into v_policies from pg_policies where schemaname='public' and tablename='due_card_notification_log';
  if v_policies < 1 then
    raise exception '170: no RLS policy on due_card_notification_log';
  end if;

  -- Confirms the policy is SELECT-only -- an authenticated user must not
  -- be able to insert/update/delete their own row here (that would let a
  -- client forge "already notified" or clear it to re-trigger a send).
  select bool_or(cmd in ('INSERT','UPDATE','DELETE') and 'authenticated' = any(roles))
    into v_insertable_by_authenticated
    from pg_policies where schemaname='public' and tablename='due_card_notification_log';
  if coalesce(v_insertable_by_authenticated, false) then
    raise exception '170: due_card_notification_log has a write policy for authenticated -- must be select-only, service-role writes only';
  end if;

  raise notice '170 verified: due_card_notification_log present, one-per-user-per-day ceiling is a unique index, RLS select-only for the owning user';
end $$;
