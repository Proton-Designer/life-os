-- 177 — `book_ready_notification_log` (#6's second half: "your book is
-- ready" when ingestion completes). NUMBER ALLOCATED FOR THIS TRACK BY THE
-- LEAD (ALLOCATIONS.md's "177 | goals-builder (#6 book-ready
-- notification)" row) — do not apply until the lead confirms.
--
-- THE CEILING IS `unique (book_id)` ALONE, NO DATE COLUMN — unlike 170's
-- `due_card_notification_log` (a "daily" notion, unique per user PER
-- LOCAL DAY), a book only ever finishes ingesting once, ever. "Fire
-- exactly once per book" (the lead's own requirement for #6) is exactly
-- what a bare `unique (book_id)` states: a second row for the same book
-- is unrepresentable, full stop, not merely unlikely on any given day.
--
-- CLAIM-FIRST, THE SAME LOCKING SHAPE AS 170 (Opus Lead review of #10,
-- 2026-09-14, generalized here on the same instinct): the caller INSERTs
-- this row BEFORE calling `sendPushToUser`, using the unique index itself
-- as the lock — not a check-then-send-then-record read that a genuinely
-- concurrent retry of `finalizingStage` (a crash between the `books`
-- status update and the ingestion cursor advancing) could race past. A
-- send that fails delivery entirely gets the row DELETEd by the caller so
-- a later retry of the SAME book can still notify once it actually
-- succeeds — see `lib/notifications/book-ready-notification.ts`'s own
-- header for the full reasoning, ported from `due_card_notification_log`'s
-- identical design.
--
-- WHY A NEW TABLE, NOT A WRITE INTO `notification_log` -- SAME REASONING
-- migration 145's header gives for `mcp_notification_dispatch_log`, and
-- migration 170's header repeats for `due_card_notification_log`:
-- `notification_log` is `supabase/functions/dispatch-notifications/
-- index.ts`'s OWN bookkeeping (Deno, prayer/checkin-only CHECK) — touching
-- its schema from this codebase for an unrelated notification kind is
-- exactly the "on the way past" scope creep already ruled out twice for
-- the identical shape of decision.
--
-- `user_id` is carried on this table (not derivable from `book_id` alone
-- without a join) so `sendPushToUser` and the RLS policy below both stay
-- single-table reads — same denormalization reasoning migration 165 gives
-- for `goal_milestones.month_start`.
--
-- RLS: SELECT-only for the owning user, same posture as
-- `due_card_notification_log` (migration 170) and `mcp_notification_
-- dispatch_log` (migration 145) — INSERT/UPDATE/DELETE happen exclusively
-- through the service-role ingestion worker (the ONE authorized edit in
-- lib/self-mastery/ingestion/worker-stages.ts's `finalizingStage`).
--
-- No begin;/commit; -- the runner owns the transaction (files >110 that
-- carry their own fail the apply, per migration 111's history).

create table public.book_ready_notification_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id    uuid not null references public.books(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- THE CEILING: a book is notified-ready at most once, ever — no date
  -- component, unlike due_card_notification_log. See this migration's
  -- header for why that is the whole point, not a simplification of it.
  constraint book_ready_notification_log_book_id_key unique (book_id)
);

comment on table public.book_ready_notification_log is
  '#6''s exactly-once-per-book delivery ledger for the "your book is ready" push — unique(book_id) alone (no date) because a book only finishes ingesting once. Claim-first: the caller inserts here BEFORE sending, using the unique index as the lock, and deletes the row if delivery fails so a genuine retry can still notify once it succeeds. See lib/notifications/book-ready-notification.ts for the full design.';

alter table public.book_ready_notification_log enable row level security;

-- Select-only for the owning user -- INSERT/UPDATE/DELETE happen
-- exclusively through the service-role ingestion worker.
create policy book_ready_notification_log_select_own on public.book_ready_notification_log
  for select using (user_id = (select auth.uid()));

do $$
declare
  v_cols int;
  v_key int;
  v_fk int;
  v_rls boolean;
  v_policies int;
  v_write_by_authenticated boolean;
begin
  select count(*) into v_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'book_ready_notification_log'
     and column_name in ('id','user_id','book_id','created_at');
  if v_cols <> 4 then
    raise exception '177: book_ready_notification_log expected 4 known columns, found %', v_cols;
  end if;

  select count(*) into v_key from pg_constraint
   where conname = 'book_ready_notification_log_book_id_key' and contype = 'u';
  if v_key <> 1 then
    raise exception '177: book_ready_notification_log_book_id_key is absent -- #6 has no exactly-once ceiling';
  end if;

  select count(*) into v_fk from pg_constraint
   where conname = 'book_ready_notification_log_book_id_fkey' and contype = 'f';
  if v_fk <> 1 then
    raise exception '177: book_ready_notification_log has no FK to books(id)';
  end if;

  select relrowsecurity into v_rls from pg_class where relname = 'book_ready_notification_log' and relnamespace = 'public'::regnamespace;
  if not coalesce(v_rls, false) then
    raise exception '177: RLS not enabled on book_ready_notification_log';
  end if;

  select count(*) into v_policies from pg_policies where schemaname='public' and tablename='book_ready_notification_log';
  if v_policies < 1 then
    raise exception '177: no RLS policy on book_ready_notification_log';
  end if;

  -- Confirms the policy is SELECT-only -- an authenticated user must not
  -- be able to insert/update/delete their own row here (that would let a
  -- client forge or clear "already notified" for their own book).
  select bool_or(cmd in ('INSERT','UPDATE','DELETE') and 'authenticated' = any(roles))
    into v_write_by_authenticated
    from pg_policies where schemaname='public' and tablename='book_ready_notification_log';
  if coalesce(v_write_by_authenticated, false) then
    raise exception '177: book_ready_notification_log has a write policy for authenticated -- must be select-only, service-role writes only';
  end if;

  raise notice '177 verified: book_ready_notification_log present, exactly-once-per-book ceiling is a unique index on book_id alone, FK to books, RLS select-only for the owning user';
end $$;
