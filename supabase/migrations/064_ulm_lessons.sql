-- ULM content tables, batch 1: `lessons`. Parent-derived (reuses
-- `set_user_id_from_book()` from 062_ulm_book_sections.sql). `provenance_quote
-- not null` plus the non-empty check is the third of the three
-- hallucination-firewall enforcement points (brief §4.1) — any extracted
-- lesson without a verbatim-matching grounding quote from the source book is
-- dropped before it reaches this table; the constraint is the database-level
-- backstop for that rule, not merely defensive documentation.

create table public.lessons (
  id                 uuid primary key default gen_random_uuid(),
  book_id            uuid not null references public.books(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  section_id         uuid references public.book_sections(id) on delete set null,
  source_chunk_id    uuid references public.source_chunks(id) on delete set null,
  title              text not null,
  core_claim         text,
  mechanism          text,
  action_template    text,
  evidence_strength  public.evidence_strength,
  provenance_quote   text not null check (length(btrim(provenance_quote)) > 0),
  page_ref           int,
  rank               int,
  status             public.lesson_status not null default 'active',
  embedding          vector(384),
  created_at         timestamptz not null default now()
);

create trigger lessons_set_user_id
  before insert or update of book_id on public.lessons
  for each row execute function public.set_user_id_from_book();

create index lessons_book_id on public.lessons (book_id);

create index lessons_embedding_hnsw
  on public.lessons using hnsw (embedding vector_cosine_ops);

alter table public.lessons enable row level security;

create policy lessons_own_row on public.lessons
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
