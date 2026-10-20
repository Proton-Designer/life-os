-- 268: Focus reader (Self-Mastery) — reader columns on books, position / highlights / sessions tables, reader prefs.
--
-- DESIGN.md §1. Every book becomes readable independent of LLM ingestion: a reader-only book is status 'ready',
-- lesson_count 0, ingestion_mode 'reader', no ingestion_jobs row. The reader document itself lives in the private
-- `books` bucket at <uid>/<bookId>/reader-v1.json (083's policies key on foldername(name)[1] = own uid, so a sub-folder
-- passes); this migration only records its state.
--
-- Position is a global word index into that document. reader_save_position() is the only write path that must be
-- atomic: newest client_updated_at wins, so a stale device can never move the bookmark backwards.
--
-- All new tables: composite tenancy FK (user_id, book_id) -> books(user_id, id) (books_user_id_id_key exists, 087),
-- RLS own-row, user_id default auth.uid(). Additive; existing rows get reader_status 'none'.
-- No begin;/commit; -- the runner owns the transaction.

-- ── books ───────────────────────────────────────────────────────────────────
alter table public.books
  add column reader_status text not null default 'none'
    constraint books_reader_status_check check (reader_status in ('none', 'preparing', 'ready', 'failed')),
  add column reader_word_count integer
    constraint books_reader_word_count_check check (reader_word_count is null or reader_word_count >= 0),
  add column reader_source text
    constraint books_reader_source_check check (reader_source is null or reader_source in ('pdf', 'epub', 'paste', 'text', 'url')),
  add column reader_source_url text,
  add column reader_error text,
  add column reader_doc_version smallint;

-- 187 declared the check inline (Postgres-generated name); drop whatever CHECK on books mentions ingestion_mode by
-- definition rather than trusting the generated name, then recreate it under a name we choose.
do $$
declare r record;
begin
  for r in select conname from pg_constraint
            where conrelid = 'public.books'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%ingestion_mode%'
  loop
    execute format('alter table public.books drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.books
  add constraint books_ingestion_mode_check check (ingestion_mode in ('standard', 'batch', 'reader'));

comment on column public.books.reader_status is
  'READER: state of the reader document (<uid>/<bookId>/reader-v1.json). none = not built yet (every pre-existing book), preparing, ready, failed (see reader_error).';
comment on column public.books.ingestion_mode is
  'P2-14: standard / batch = LLM ingestion mode (lib/self-mastery/ingestion/worker-stages.ts). READER: reader = a reader-only book (status ready, lesson_count 0, no ingestion_jobs row).';

-- ── reader_positions: one bookmark per (user, book) ─────────────────────────
create table public.reader_positions (
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id            uuid not null,
  word_index         integer not null check (word_index >= 0),
  wpm                smallint check (wpm is null or wpm between 50 and 2000),
  client_updated_at  timestamptz not null,
  updated_at         timestamptz not null default now(),
  primary key (user_id, book_id),
  constraint reader_positions_book_fk
    foreign key (user_id, book_id) references public.books (user_id, id) on delete cascade
);

alter table public.reader_positions enable row level security;
create policy "reader_positions_select_own" on public.reader_positions
  for select using (user_id = (select auth.uid()));
create policy "reader_positions_insert_own" on public.reader_positions
  for insert with check (user_id = (select auth.uid()));
create policy "reader_positions_update_own" on public.reader_positions
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "reader_positions_delete_own" on public.reader_positions
  for delete using (user_id = (select auth.uid()));

create trigger reader_positions_touch_updated_at
  before update on public.reader_positions
  for each row execute function public.touch_updated_at();

comment on table public.reader_positions is
  'READER: where the user is in a book (global word index into the reader document). Written only through reader_save_position(): newest client_updated_at wins.';

-- Atomic "newest wins" upsert. SECURITY INVOKER: RLS and the composite FK apply to the caller, user_id is auth.uid().
-- Returns the stored word_index (the caller's value if it won, the existing one if it was stale).
create function public.reader_save_position(
  p_book_id uuid,
  p_word_index integer,
  p_wpm smallint,
  p_client_updated_at timestamptz
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_word integer;
begin
  insert into public.reader_positions as rp (user_id, book_id, word_index, wpm, client_updated_at)
  values (auth.uid(), p_book_id, p_word_index, p_wpm, p_client_updated_at)
  on conflict (user_id, book_id) do update
    set word_index = excluded.word_index,
        wpm = excluded.wpm,
        client_updated_at = excluded.client_updated_at
    where excluded.client_updated_at > rp.client_updated_at
  returning rp.word_index into v_word;

  if v_word is null then
    select word_index into v_word from public.reader_positions where user_id = auth.uid() and book_id = p_book_id;
  end if;
  return v_word;
end;
$$;

revoke all on function public.reader_save_position(uuid, integer, smallint, timestamptz) from public, anon;
grant execute on function public.reader_save_position(uuid, integer, smallint, timestamptz) to authenticated;

-- ── reader_highlights ───────────────────────────────────────────────────────
create table public.reader_highlights (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id     uuid not null,
  start_word  integer not null check (start_word >= 0),
  end_word    integer not null,
  text        text not null check (length(text) between 1 and 4000),
  note        text check (note is null or length(note) <= 2000),
  created_at  timestamptz not null default now(),
  constraint reader_highlights_range_check check (end_word >= start_word),
  constraint reader_highlights_user_id_id_key unique (user_id, id),
  constraint reader_highlights_book_fk
    foreign key (user_id, book_id) references public.books (user_id, id) on delete cascade
);
create index reader_highlights_user_book_start_idx on public.reader_highlights (user_id, book_id, start_word);

alter table public.reader_highlights enable row level security;
create policy "reader_highlights_select_own" on public.reader_highlights
  for select using (user_id = (select auth.uid()));
create policy "reader_highlights_insert_own" on public.reader_highlights
  for insert with check (user_id = (select auth.uid()));
create policy "reader_highlights_update_own" on public.reader_highlights
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "reader_highlights_delete_own" on public.reader_highlights
  for delete using (user_id = (select auth.uid()));

comment on table public.reader_highlights is
  'READER: a saved word range of a book (start_word..end_word inclusive, global word indices) with its text snapshot.';

-- ── reader_sessions: feeds daily goal / streak / stats ──────────────────────
create table public.reader_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id     uuid not null,
  local_date  date not null,
  started_at  timestamptz not null,
  ended_at    timestamptz not null,
  words_read  integer not null check (words_read >= 0),
  mode        text not null check (mode in ('rsvp', 'page', 'listen')),
  avg_wpm     smallint check (avg_wpm is null or avg_wpm between 0 and 5000),
  constraint reader_sessions_time_check check (ended_at >= started_at),
  constraint reader_sessions_user_id_id_key unique (user_id, id),
  constraint reader_sessions_book_fk
    foreign key (user_id, book_id) references public.books (user_id, id) on delete cascade
);
create index reader_sessions_user_date_idx on public.reader_sessions (user_id, local_date);

alter table public.reader_sessions enable row level security;
create policy "reader_sessions_select_own" on public.reader_sessions
  for select using (user_id = (select auth.uid()));
create policy "reader_sessions_insert_own" on public.reader_sessions
  for insert with check (user_id = (select auth.uid()));
create policy "reader_sessions_update_own" on public.reader_sessions
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "reader_sessions_delete_own" on public.reader_sessions
  for delete using (user_id = (select auth.uid()));

comment on table public.reader_sessions is
  'READER: one reading stretch (written on pause/close). local_date is the USER''s local calendar date (lib/date-utils localDateString), never derived from a UTC timestamp in SQL.';

-- ── user_settings: reader prefs ─────────────────────────────────────────────
alter table public.user_settings
  add column reader_wpm smallint not null default 300
    constraint user_settings_reader_wpm_check check (reader_wpm between 100 and 1000),
  add column reader_font_scale numeric(3,2) not null default 1
    constraint user_settings_reader_font_scale_check check (reader_font_scale between 0.75 and 2),
  add column reader_theme text not null default 'dark'
    constraint user_settings_reader_theme_check check (reader_theme in ('dark', 'light', 'sepia', 'contrast')),
  add column reader_voice_uri text,
  add column reader_speech_rate numeric(3,2) not null default 1
    constraint user_settings_reader_speech_rate_check check (reader_speech_rate between 0.5 and 3),
  add column reader_focal_lines boolean not null default true,
  add column reader_daily_word_goal integer
    constraint user_settings_reader_daily_word_goal_check check (reader_daily_word_goal is null or reader_daily_word_goal > 0);

comment on column public.user_settings.reader_daily_word_goal is 'READER: words per day; NULL = goal off.';

-- ── self-check (raises inside the runner's transaction -> rolls the migration back) ──
do $$
declare
  v_n int;
begin
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'books'
     and column_name in ('reader_status','reader_word_count','reader_source','reader_source_url','reader_error','reader_doc_version');
  if v_n <> 6 then raise exception 'migration 268: expected 6 books reader columns, found %', v_n; end if;

  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'user_settings' and column_name like 'reader\_%';
  if v_n <> 7 then raise exception 'migration 268: expected 7 user_settings reader columns, found %', v_n; end if;

  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('reader_positions','reader_highlights','reader_sessions') and c.relrowsecurity;
  if v_n <> 3 then raise exception 'migration 268: expected 3 reader tables with RLS, found %', v_n; end if;

  select count(*) into v_n from pg_constraint
   where conname = 'books_ingestion_mode_check' and pg_get_constraintdef(oid) like '%reader%';
  if v_n <> 1 then raise exception 'migration 268: books_ingestion_mode_check not extended'; end if;
end $$;
