-- 197: match_source_chunks RPC (P2-13D semantic search). Function-only --
-- no new tables/columns/extensions.
--
-- SEARCHES source_chunks, NOT lessons: P2-13 Slice C only ever persists
-- source_chunks.embedding (lib/self-mastery/ingestion/worker-stages.ts's
-- embeddingStage) -- lessons.embedding (migration 064) has a column and an
-- HNSW index but nothing writes to it anywhere in this codebase. A
-- function over lessons would compile and always return zero rows for
-- every real user; named here rather than built blind.
--
-- SECURITY DEFINER with set search_path = '' (Opus Lead's explicit
-- ruling): with an empty search_path only pg_catalog resolves implicitly,
-- so every other reference below is written schema-qualified by hand,
-- including the pgvector type and its cosine-distance operator --
-- confirmed live against this project's own pg_extension/pg_namespace
-- catalogs (Opus Lead, 2026-09-16): the "vector" extension and all three
-- of its distance operators live in the public schema on this database,
-- not a separate "extensions" schema. An unqualified `<=>` would fail to
-- resolve under search_path='', so it is written as the explicit
-- `OPERATOR(public.<=>)` form, and the parameter type as `public.vector`.
--
-- WHY DEFINER RATHER THAN INVOKER, DESPITE RLS ALREADY ISOLATING BY OWNER
-- (source_chunks_own_row/books_own_row, migrations 063/061): the Lead's
-- explicit requirement for this task. The explicit `sc.user_id = auth.uid()`
-- predicate below is still written by hand as defense in depth (this
-- schema's own established convention, e.g. complete_target in 028) --
-- never a caller-supplied user_id parameter, so this can never be asked to
-- search anyone else's chunks regardless of what RLS would have allowed.
--
-- EMBEDDING_MODEL IS A REQUIRED, EXACT-MATCH FILTER: vectors from
-- different embedding models are not on the same axes -- a cosine
-- distance between an OpenAI text-embedding-3-small vector and a Google
-- gemini-embedding-001 vector is meaningless, not just imprecise
-- (migration 193's own comment). The caller always supplies the exact
-- "provider:model" tag its own just-computed query vector was embedded
-- under (lib/ai/embeddings.ts's embeddingModelTag()).
--
-- RESULT COUNT IS HARD-CAPPED AT 50 REGARDLESS OF WHAT THE CALLER PASSES
-- (`least(p_match_count, 50)`), and never negative (`greatest(..., 0)`) --
-- an RPC reachable from an authenticated client session must not let the
-- caller ask for an unbounded scan.
--
-- INNER JOIN ON books IS DELIBERATE, NOT AN OVERSIGHT: books_own_row
-- (migration 081) narrows to `deleted_at is null`, so a soft-deleted
-- book's chunks correctly vanish from search too, same as every other
-- read path in this app treats a soft-deleted book.
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

create or replace function public.match_source_chunks(
  p_query_embedding public.vector(384),
  p_embedding_model text,
  p_match_count int default 8
)
returns table (
  id uuid,
  book_id uuid,
  book_title text,
  text text,
  page_start int,
  page_end int,
  similarity float8
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    sc.id,
    sc.book_id,
    b.title,
    sc.text,
    sc.page_start,
    sc.page_end,
    (1 - (sc.embedding OPERATOR(public.<=>) p_query_embedding))::float8
  from public.source_chunks sc
  join public.books b on b.id = sc.book_id
  where sc.user_id = auth.uid()
    and sc.embedding is not null
    and sc.embedding_model = p_embedding_model
  order by sc.embedding OPERATOR(public.<=>) p_query_embedding
  limit greatest(least(p_match_count, 50), 0);
$$;

comment on function public.match_source_chunks(public.vector, text, int) is
  'P2-13D: semantic search over the caller''s own source_chunks (never lessons -- lessons.embedding has no writer). '
  'security definer + search_path='''' with every reference hand-qualified (Opus Lead ruling, 2026-09-16) -- the '
  'vector extension and its operators live in the public schema on this database, confirmed live, not assumed. '
  'auth.uid() only, never a caller-supplied user_id. embedding_model is a required exact-match filter -- cross-model '
  'vectors are never compared. Result count hard-capped at 50 regardless of the caller''s own p_match_count.';

revoke execute on function public.match_source_chunks(public.vector, text, int) from public;
grant execute on function public.match_source_chunks(public.vector, text, int) to authenticated;
