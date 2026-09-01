-- ULM: soft-delete + the sanctioned purge door. Sourced from
-- `20260815050000_l1a_soft_delete_and_purge.sql`, with `delete_book` ported
-- from its later fix (`20260815051000_l1a_fix_storage_delete.sql`) —
-- Supabase blocks direct SQL writes to `storage.objects` even from a
-- SECURITY DEFINER function ("Direct deletion from storage tables is not
-- allowed. Use the Storage API instead", error 42501); the fixed version
-- returns `storage_path` for the caller to delete via the Storage API with
-- its own session, authorised by the same `books_bucket_delete` policy
-- below.
--
-- Storage bucket setup (base schema §7) explicitly NOT landed here, on
-- inspection rather than assumption: `storage.buckets` on this platform is
-- a minimal stub (id/name/owner/created_at/updated_at only — no `public`,
-- no `file_size_limit`; the full Storage schema is normally completed by
-- the storage-api service's own migrations at startup, which isn't running
-- in this bare-Postgres scratch environment). Checked whether anything in
-- THIS migration's own SQL actually needs the bucket to exist: it doesn't —
-- `delete_book` (fixed version) never touches `storage.objects`, only
-- returns `storage_path` for the caller's own Storage API call;
-- `confirm_storage_deleted`/`purge_user_data` only touch
-- `pending_storage_deletions`, never `storage.objects`/`storage.buckets`
-- directly. Matches the Opus Lead's ruling on smoke-isolation's deferred
-- Storage section: no upload path exists in the merged platform yet (no
-- worker), so standing up real Storage infrastructure now would test
-- something nothing writes to. Revisit alongside that ruling when the
-- worker lands.
--
-- 🔴 TWO DEFERRALS CLOSE HERE, both held since they need `books.deleted_at`:
-- `submit_review`'s defensive check against reviewing a soft-deleted book's
-- card (deferred from 078 — reviews is append-only, so a bad row would have
-- been permanent), and `get_session_queue`'s third revision, joining
-- `books.deleted_at is null` in both the due and new-cards branches
-- (deferred alongside 071, which stayed correctly un-joined since the
-- column didn't exist).
--
-- 🔴 `purge_user_data` IS THE SINGLE SANCTIONED EXEMPTION IN THIS ENTIRE
-- SCHEMA. It disables both `reviews` triggers inside its own transaction
-- and re-enables before returning — `alter table ... disable trigger` is
-- transactional DDL, so if anything in here raises, the whole transaction
-- (including the disable) rolls back and the trigger is never left
-- disabled; no exception handler needed for that guarantee. Ported exactly,
-- not generalised: two authorised callers only — the account owner
-- (`auth.uid() = p_user_id`) or `service_role` (no JWT, `auth.uid()` is
-- null, for admin/support-triggered deletion). No other exemption exists or
-- should exist anywhere in this schema; a new one is a design conversation
-- with the Opus Lead, not a migration.

alter table public.books add column deleted_at timestamptz;

-- Soft-deleted books vanish from every normal read path automatically.
drop policy books_own_row on public.books;
create policy books_own_row on public.books
  for all to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null)
  with check (user_id = (select auth.uid()));

-- delete_book: hard-delete if no review history exists, else soft-delete.
-- source_chunks/lessons are kept either way (provenance must keep resolving
-- even for a soft-deleted book).
create function public.delete_book(p_book_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  target public.books;
  review_count int;
  hard_deleted boolean;
begin
  if caller is null then
    raise exception 'delete_book: no authenticated user';
  end if;

  select * into target from public.books where id = p_book_id for update;
  if not found or target.user_id <> caller then
    raise exception 'delete_book: book % not found for caller', p_book_id;
  end if;
  if target.deleted_at is not null then
    raise exception 'delete_book: book % is already deleted', p_book_id;
  end if;

  select count(*) into review_count from public.reviews where book_id = p_book_id;

  if review_count = 0 then
    delete from public.books where id = p_book_id;
    hard_deleted := true;
  else
    update public.books set deleted_at = now() where id = p_book_id;
    hard_deleted := false;
  end if;

  return jsonb_build_object(
    'book_id', p_book_id,
    'hard_deleted', hard_deleted,
    'review_count', review_count,
    'storage_path', target.file_path
  );
end;
$$;

revoke execute on function public.delete_book(uuid) from public;
grant execute on function public.delete_book(uuid) to authenticated;

-- restore_book — undo. SECURITY DEFINER so it isn't blinded by the
-- books_own_row narrowing above (a soft-deleted row is invisible to a plain
-- SELECT under RLS by design).
create function public.restore_book(p_book_id uuid)
returns public.books
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  result public.books;
begin
  if caller is null then
    raise exception 'restore_book: no authenticated user';
  end if;

  update public.books set deleted_at = null
    where id = p_book_id and user_id = caller and deleted_at is not null
    returning * into result;

  if not found then
    raise exception 'restore_book: book % not found, not owned by caller, or not deleted', p_book_id;
  end if;

  return result;
end;
$$;

revoke execute on function public.restore_book(uuid) from public;
grant execute on function public.restore_book(uuid) to authenticated;

-- confirm_storage_deleted: the client calls this after its own immediate
-- Storage API delete succeeds, so the worker sweep doesn't redundantly
-- retry a file that's already gone.
create function public.confirm_storage_deleted(p_storage_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'confirm_storage_deleted: no authenticated user';
  end if;

  delete from public.pending_storage_deletions
    where storage_path = p_storage_path and user_id = caller;
end;
$$;

revoke execute on function public.confirm_storage_deleted(text) from public;
grant execute on function public.confirm_storage_deleted(text) to authenticated;

-- purge_user_data: enqueue every one of the user's book files before
-- purging, or account deletion leaves a full orphaned library behind.
create function public.purge_user_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'purge_user_data: caller may only purge their own account';
  end if;

  insert into public.pending_storage_deletions (storage_path, user_id)
    select file_path, p_user_id
    from public.books
    where user_id = p_user_id and file_path is not null;

  alter table public.reviews disable trigger reviews_no_update;
  alter table public.reviews disable trigger reviews_no_delete;

  delete from auth.users where id = p_user_id;

  alter table public.reviews enable trigger reviews_no_update;
  alter table public.reviews enable trigger reviews_no_delete;
end;
$$;

revoke execute on function public.purge_user_data(uuid) from public;
grant execute on function public.purge_user_data(uuid) to authenticated, service_role;

-- Found while verifying the defensive check below, not in ULM's original:
-- submit_review is SECURITY INVOKER, so a plain `select ... from
-- public.books` inside it is subject to the SAME books_own_row RLS policy
-- that hides a soft-deleted book from a normal read — including from its
-- own owner. A direct query for `deleted_at` on a soft-deleted book
-- therefore finds NOTHING under RLS, `book_deleted` stays NULL, and the
-- check silently never fires. Same shape as restore_book needing SECURITY
-- DEFINER to see past the RLS narrowing books_own_row applies — this one
-- narrow helper exists so submit_review (which stays SECURITY INVOKER for
-- everything else) can ask ONE otherwise-invisible fact without changing
-- its own security model.
create function public.book_is_deleted(p_book_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select deleted_at is not null from public.books where id = p_book_id;
$$;

revoke execute on function public.book_is_deleted(uuid) from public;
grant execute on function public.book_is_deleted(uuid) to authenticated, service_role;

-- submit_review: the deferred defensive check. get_session_queue shouldn't
-- legitimately offer a card from a soft-deleted book (its own deleted_at
-- filter, below), so this is defence in depth, not the primary path — but
-- reviews is append-only, so "shouldn't" isn't good enough on its own.
create or replace function public.submit_review(
  p_card_id uuid,
  p_session_id uuid,
  p_rating smallint,
  p_elapsed_ms int,
  p_answered_text text,
  p_ai_feedback text,
  p_ai_suggested_rating smallint,
  p_next_state jsonb
)
returns public.reviews
language plpgsql
security invoker
as $$
declare
  caller uuid := auth.uid();
  prev public.card_states;
  new_reps int;
  new_stability real;
  new_difficulty real;
  new_due_at timestamptz;
  new_state public.fsrs_state;
  inserted public.reviews;
  book_deleted boolean;
begin
  if caller is null then
    raise exception 'submit_review: no authenticated user';
  end if;
  if p_rating not between 1 and 4 then
    raise exception 'submit_review: rating must be 1..4';
  end if;

  insert into public.user_stats (user_id) values (caller) on conflict (user_id) do nothing;

  select * into prev from public.card_states
    where card_id = p_card_id and user_id = caller
    for update;

  if not found then
    raise exception 'submit_review: no card_states row for card % / user %', p_card_id, caller;
  end if;

  book_deleted := public.book_is_deleted(prev.book_id);
  if book_deleted then
    raise exception 'submit_review: book for card % has been deleted', p_card_id;
  end if;

  new_reps       := coalesce((p_next_state->>'reps')::int, prev.reps + 1);
  new_stability  := (p_next_state->>'stability')::real;
  new_difficulty := (p_next_state->>'difficulty')::real;
  new_due_at     := (p_next_state->>'due_at')::timestamptz;
  new_state      := (p_next_state->>'state')::public.fsrs_state;

  if new_reps <> prev.reps + 1 then
    raise exception 'submit_review: reps must increase by exactly 1 (was %, proposed %)',
      prev.reps, new_reps;
  end if;
  if new_stability is null or new_stability <= 0 then
    raise exception 'submit_review: stability must be > 0 (proposed %)', new_stability;
  end if;
  if new_due_at is null or new_due_at <= now() then
    raise exception 'submit_review: due_at must be in the future (proposed %)', new_due_at;
  end if;
  if new_state is null then
    raise exception 'submit_review: state is required';
  end if;
  if prev.state = 'new' and new_state not in ('learning', 'review') then
    raise exception 'submit_review: illegal transition new -> %', new_state;
  end if;

  insert into public.reviews (
    card_id, session_id, rating, elapsed_ms, answered_text, ai_feedback,
    ai_suggested_rating, state_before, stability_before, difficulty_before,
    stability_after, difficulty_after, scheduled_days
  ) values (
    p_card_id, p_session_id, p_rating, p_elapsed_ms, p_answered_text, p_ai_feedback,
    p_ai_suggested_rating, prev.state, prev.stability, prev.difficulty,
    new_stability, new_difficulty,
    extract(epoch from (new_due_at - now())) / 86400.0
  ) returning * into inserted;

  update public.card_states set
    stability = new_stability,
    difficulty = new_difficulty,
    due_at = new_due_at,
    reps = new_reps,
    lapses = case when p_rating = 1 then prev.lapses + 1 else prev.lapses end,
    state = new_state,
    last_review_at = now(),
    last_rating = p_rating
  where card_id = p_card_id and user_id = caller;

  if p_session_id is not null then
    update public.work_sessions set cards_reviewed = coalesce(cards_reviewed, 0) + 1
      where id = p_session_id and user_id = caller;
  end if;

  update public.user_stats set total_reviews = total_reviews + 1
    where user_id = caller;

  return inserted;
end;
$$;

-- get_session_queue: the deferred deleted_at joins, on top of 071's
-- source_id generalisation (unchanged otherwise — same three bug fixes,
-- same untouched warm-up pick).
create or replace function public.get_session_queue(p_limit_due int, p_limit_new int)
returns table (
  card_id uuid,
  book_id uuid,
  queue_position int,
  reason text
)
language plpgsql
security invoker
as $$
#variable_conflict use_column
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'get_session_queue: no authenticated user';
  end if;

  return query
  with due as (
    select cs.card_id, cs.book_id, cs.due_at, cs.stability,
           row_number() over (partition by s.id order by cs.due_at asc) as source_rank,
           row_number() over (order by cs.due_at asc) as overall_rank
    from public.card_states cs
    join public.sources s on s.book_id = cs.book_id and s.kind = 'book'
    join public.books bk on bk.id = cs.book_id and bk.deleted_at is null
    where cs.user_id = caller and cs.state <> 'new' and cs.due_at <= now()
    limit greatest(p_limit_due, 1) * 4
  ),
  warm_up as (
    select card_id, book_id, 0::int as queue_position, 'warm_up'::text as reason
    from due
    order by stability desc nulls last, due_at asc
    limit 1
  ),
  due_interleaved as (
    select card_id, book_id,
           (row_number() over (order by source_rank asc, overall_rank asc))::int as queue_position,
           'due'::text as reason
    from due
    where card_id not in (select card_id from warm_up)
    limit greatest(p_limit_due - 1, 0)
  ),
  new_cards as (
    select cs.card_id, cs.book_id,
           (row_number() over (order by cs.card_id))::int as queue_position,
           'new'::text as reason
    from public.card_states cs
    join public.books bk on bk.id = cs.book_id and bk.deleted_at is null
    where cs.user_id = caller and cs.state = 'new'
    limit greatest(p_limit_new, 0)
  )
  select card_id, book_id, queue_position, reason from warm_up
  union all
  select card_id, book_id, queue_position + 1, reason from due_interleaved
  union all
  select card_id, book_id, queue_position + 1000, reason from new_cards
  order by queue_position asc;
end;
$$;
