-- 188 — `morning_routine_items` + `morning_routine_checks` (P3-01, overnight
-- run-20260915-0011, Sonnet ENG 1). NEW TABLES, same shape discipline as
-- 175's identity_habits/habit_votes pair (the closest existing precedent:
-- a user-defined list + an append/delete-only per-day log), deliberately not
-- folded into identity_habits/habit_votes or any existing checklist-shaped
-- table -- a morning routine item has no identity/decay-score concept, and
-- reusing either existing table would graft an unrelated meaning onto a
-- working feature's reader, the exact trap 175's own header names.
--
-- ARCHIVE, NEVER HARD-DELETE (Opus Lead ruling, overnight run-20260915-0011,
-- 15:0x CDT): an item is archived (`archived_at` set), never deleted, from
-- either the UI or the MCP write path -- past `morning_routine_checks` rows
-- must survive an item going away, and a hard DELETE would cascade them into
-- oblivion (this table's own FK below is ON DELETE CASCADE, which is exactly
-- why the app layer must never issue that DELETE). `archived_at` alone
-- (nullable, no separate status column) mirrors 056_user_domains.sql's own
-- simpler archive idiom -- no pause/resume concept exists here the way
-- identity_habits' status enum needed, so a second enum column would be
-- unused complexity.
--
-- CHECKS ARE TOGGLE-DELETE, NOT AN APPEND-ONLY LOG (same ruling as 175's
-- habit_votes, and Opus Lead's explicit "uncheck may delete today's own
-- check row (undo-shaped, allowed)" -- distinct from the no-hard-delete rule
-- above, which is about ITEMS, not today's own check). Checking is INSERT,
-- unchecking is DELETE of that same row. `morning_routine_checks_user_item_
-- date_key` -- unique on (user_id, item_id, checked_date) -- makes "two
-- checks for the same item, same local day" unrepresentable, and IS the
-- "checked once per day" rule, not a safeguard bolted onto it. Application
-- code (lib/morning-routine/actions-core.ts) is responsible for scoping
-- `checked_date` to the caller's own `localDateString(now, tz)` -- the
-- database has no notion of "the caller's local today" without being handed
-- it, same reasoning 175's own header gives for habit_votes.date.
--
-- `checked_date` HAS NO FOREIGN KEY TO ANYTHING -- a plain local calendar
-- date string, same shape as habit_votes.date/deen_habit_logs.date/
-- distraction_events.date elsewhere in this schema.
--
-- COMPOSITE TENANCY FK, per 058/086/087/100/101/140/165/175's pattern:
-- `morning_routine_checks_item_same_user` references
-- `morning_routine_items (user_id, id)`, not a bare `item_id ->
-- morning_routine_items(id)` FK -- a single-column FK only proves the item
-- row exists, never that the caller owns it, since FK checks bypass RLS.
-- ON DELETE CASCADE (not SET NULL): 140's "scope every SET NULL to its own
-- column" rule does not apply here, a cascade drops the whole dependent row
-- rather than nulling a NOT NULL column.
--
-- `morning_routine_items_user_id_id_key` exists solely as that composite-FK
-- anchor -- redundant with the primary key for uniqueness alone, same
-- reasoning as `identity_habits_user_id_id_key` (175) / `goals_user_id_id_
-- key` (165).
--
-- NO SCARCITY CEILING INDEX (unlike identity_habits' 7-rank partial unique
-- index): a morning routine checklist has no "slot number" concept the way
-- a ranked habit does -- items display in `created_at` order, and a sane
-- per-account item cap (if any) is a plain COUNT pre-check in application
-- code, the same posture `assignRanks`' own "at most 3 starred" check takes
-- (app-code judgment call, not a DB constraint, since there is no natural
-- index shape for "at most N items with no ordering slot to be scarce
-- about").
--
-- No `begin;`/`commit;` -- the runner owns the transaction (files >110 that
-- carry their own fail the apply, per migration 111's own history).

create table public.morning_routine_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- "Make the bed" — the checklist item's own label, not a task description.
  label       text not null check (length(btrim(label)) > 0),
  archived_at timestamptz null,
  created_at  timestamptz not null default now(),
  -- The composite-FK anchor for morning_routine_checks below.
  constraint morning_routine_items_user_id_id_key unique (user_id, id)
);

comment on table public.morning_routine_items is
  'User-defined morning routine checklist items (P3-01). Archived, never hard-deleted (archived_at set) -- a hard DELETE would cascade morning_routine_checks rows into oblivion, destroying real history. Displayed in created_at order; no rank/slot concept.';
comment on column public.morning_routine_items.archived_at is
  'NULL = active/visible on the checklist. Set = archived; morning_routine_checks rows for this item are preserved, never cascaded by an application DELETE (the app must never issue one against this table).';

alter table public.morning_routine_items enable row level security;

create policy "morning_routine_items_own_row" on public.morning_routine_items
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table public.morning_routine_checks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id      uuid not null,
  -- LOCAL calendar date the check applies to -- callers must derive this via
  -- localDateString(now, tz), never a raw Date (AGENTS.md's own hard rule).
  checked_date date not null,
  created_at   timestamptz not null default now(),
  -- Composite tenancy FK: a check whose item belongs to someone else is
  -- unrepresentable, not merely unlikely.
  constraint morning_routine_checks_item_same_user
    foreign key (user_id, item_id) references public.morning_routine_items (user_id, id) on delete cascade,
  -- "Checked once per item per local day," not a safeguard on top of it --
  -- a second check for the same (user, item, checked_date) has no legal row
  -- to occupy.
  constraint morning_routine_checks_user_item_date_key unique (user_id, item_id, checked_date)
);

comment on table public.morning_routine_checks is
  'Append/delete-only per-day check log (P3-01). A row = "checked off this local day." Toggle semantics: checking is INSERT, unchecking is DELETE of that same row -- both restricted to the caller''s own local today in application code (lib/morning-routine/actions-core.ts), never enforced here, since the database has no notion of "the caller''s local today" without being handed it.';
comment on column public.morning_routine_checks.checked_date is
  'Local calendar date string (localDateString(now, tz)), not a timestamptz slice -- a check at 11pm local must count for that local day regardless of UTC offset.';

alter table public.morning_routine_checks enable row level security;

create policy "morning_routine_checks_own_row" on public.morning_routine_checks
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

do $$
declare
  v_items_cols int;
  v_checks_cols int;
  v_checks_key int;
  v_items_fk int;
  v_checks_fk int;
  v_items_rls boolean;
  v_checks_rls boolean;
  v_items_policies int;
  v_checks_policies int;
begin
  select count(*) into v_items_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'morning_routine_items'
     and column_name in ('id','user_id','label','archived_at','created_at');
  if v_items_cols <> 5 then
    raise exception '188: morning_routine_items expected 5 known columns, found %', v_items_cols;
  end if;

  select count(*) into v_checks_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'morning_routine_checks'
     and column_name in ('id','user_id','item_id','checked_date','created_at');
  if v_checks_cols <> 5 then
    raise exception '188: morning_routine_checks expected 5 known columns, found %', v_checks_cols;
  end if;

  select count(*) into v_checks_key from pg_constraint
   where conname = 'morning_routine_checks_user_item_date_key' and contype = 'u';
  if v_checks_key <> 1 then
    raise exception '188: morning_routine_checks_user_item_date_key is absent -- "once per item per day" has no rule';
  end if;

  select count(*) into v_items_fk from pg_constraint
   where conname = 'morning_routine_items_user_id_id_key' and contype = 'u';
  if v_items_fk <> 1 then
    raise exception '188: morning_routine_items_user_id_id_key (composite-FK anchor) is absent';
  end if;

  select count(*) into v_checks_fk from pg_constraint
   where conname = 'morning_routine_checks_item_same_user' and contype = 'f';
  if v_checks_fk <> 1 then
    raise exception '188: morning_routine_checks_item_same_user composite FK is absent -- a check could point at someone else''s item';
  end if;

  select relrowsecurity into v_items_rls from pg_class where relname = 'morning_routine_items' and relnamespace = 'public'::regnamespace;
  select relrowsecurity into v_checks_rls from pg_class where relname = 'morning_routine_checks' and relnamespace = 'public'::regnamespace;
  if not (v_items_rls and v_checks_rls) then
    raise exception '188: RLS not enabled on both tables (items=%, checks=%)', v_items_rls, v_checks_rls;
  end if;

  select count(*) into v_items_policies from pg_policies where schemaname = 'public' and tablename = 'morning_routine_items';
  select count(*) into v_checks_policies from pg_policies where schemaname = 'public' and tablename = 'morning_routine_checks';
  if v_items_policies < 1 or v_checks_policies < 1 then
    raise exception '188: own-row RLS policy missing (items=%, checks=%)', v_items_policies, v_checks_policies;
  end if;

  raise notice '188 verified: morning_routine_items + morning_routine_checks present, once-per-item-per-day index, composite FK, RLS + own-row policies';
end $$;
