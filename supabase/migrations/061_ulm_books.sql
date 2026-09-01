-- ULM content tables, batch 1: `books`. Caller-owned (always written by an
-- authenticated end user, directly or via a SECURITY INVOKER RPC) — user_id
-- is forced from auth.uid() by trigger, never trusted from client input, and
-- the trigger fires on every insert so a client can never smuggle a
-- different user's id through even if it tries. References `auth.users`
-- directly, not `public.profiles` — ULM's original schema referenced its own
-- `profiles(id)`, but LifeOS's `profiles` PK column is `user_id`, not `id`
-- (checked against 000_baseline.sql), and migration 056's own convention
-- already references `auth.users(id)` directly for exactly this reason. RLS
-- and its policy ship in this same file, per the Opus Lead's ruling: a table
-- and its policy landing in separate migrations is a window where RLS is on
-- with no policy, i.e. a table nobody can read.

create table public.books (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  title            text not null,
  author           text,
  file_path        text,
  file_size_bytes  bigint,
  status           public.book_status not null default 'uploading',
  stage            public.ingest_stage not null default 'queued',
  progress_pct     int not null default 0 check (progress_pct between 0 and 100),
  page_count       int,
  lesson_count     int not null default 0,
  error_message    text,
  cover_hue        int,
  created_at       timestamptz not null default now(),
  ready_at         timestamptz
);

create function public.set_user_id_from_caller()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    raise exception 'set_user_id_from_caller: no authenticated user';
  end if;
  new.user_id := auth.uid();
  return new;
end;
$$;

create trigger books_set_user_id
  before insert on public.books
  for each row execute function public.set_user_id_from_caller();

create index books_user_id on public.books (user_id);

alter table public.books enable row level security;

create policy books_own_row on public.books
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
