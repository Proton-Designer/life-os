-- ULM content tables, batch 1: `source_chunks`. Parent-derived (see
-- 062_ulm_book_sections.sql's comment for why this is a trigger off the
-- parent book, not auth.uid() or a client-supplied value) — reuses
-- `set_user_id_from_book()` defined there. `embedding` is the pgvector
-- column ingestion writes local sentence-transformer output into (no API
-- key on this platform); the HNSW index is what makes the ingestion
-- pipeline's similarity lookups viable at scale rather than a full scan.

create table public.source_chunks (
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid not null references public.books(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  section_id   uuid references public.book_sections(id) on delete set null,
  text         text not null,
  page_start   int,
  page_end     int,
  token_count  int,
  sort_order   int not null default 0,
  embedding    vector(384)
);

create trigger source_chunks_set_user_id
  before insert or update of book_id on public.source_chunks
  for each row execute function public.set_user_id_from_book();

create index source_chunks_book_id on public.source_chunks (book_id);

create index source_chunks_embedding_hnsw
  on public.source_chunks using hnsw (embedding vector_cosine_ops);

alter table public.source_chunks enable row level security;

create policy source_chunks_own_row on public.source_chunks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
