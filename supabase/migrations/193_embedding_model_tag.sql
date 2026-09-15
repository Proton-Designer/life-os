-- 193: embedding_model tag columns (Phase 2 #P2-13, Team A / Sonnet ENG 2,
-- Opus Lead's condition #2 on the P2-13 Plan).
--
-- Vectors from different embedding models are NOT comparable -- cosine
-- distance between an OpenAI text-embedding-3-small vector and a Google
-- gemini-embedding-001 vector is meaningless, even though both happen to
-- be truncated to the same vector(384) shape (migrations 063/064). This
-- column records WHICH model actually produced a row's stored embedding,
-- so any future comparison/dedupe/search (P2-13 Slice C/D) can restrict
-- itself to same-model rows and re-embed (not merely reuse) when a user's
-- available provider changes.
--
-- "provider:model" combined string (e.g. "openai:text-embedding-3-small"),
-- not two separate columns -- there is exactly one thing this needs to
-- answer ("were these two rows embedded compatibly"), and a single
-- equality check on one column is simpler than a two-column AND for a
-- fact that is always set or read together.
--
-- PER-ROW, NOT PER-BOOK: a book's chunks/lessons can in principle be
-- (re-)embedded independently over time (a user adds an embeddings key
-- after already ingesting several books, or switches provider) -- a
-- single books.embedding_model column would force an all-or-nothing
-- re-embed and couldn't represent a book mid-migration between models.
--
-- No begin;/commit; -- the runner owns the transaction.

alter table public.source_chunks
  add column embedding_model text;

alter table public.lessons
  add column embedding_model text;

comment on column public.source_chunks.embedding_model is
  'P2-13: "provider:model" (e.g. "openai:text-embedding-3-small") that produced this row''s `embedding` vector, or NULL when `embedding` itself is NULL (never embedded). Vectors from different models are not comparable -- any comparison/search must restrict itself to matching values, never assume all non-null embeddings in this table are compatible.';

comment on column public.lessons.embedding_model is
  'P2-13: same convention as source_chunks.embedding_model -- see that column''s own comment.';

do $$
declare
  v_chunks_col boolean;
  v_lessons_col boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'source_chunks' and column_name = 'embedding_model'
  ) into v_chunks_col;
  if not v_chunks_col then
    raise exception '193: source_chunks.embedding_model is absent';
  end if;

  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'lessons' and column_name = 'embedding_model'
  ) into v_lessons_col;
  if not v_lessons_col then
    raise exception '193: lessons.embedding_model is absent';
  end if;

  raise notice '193 verified: source_chunks.embedding_model and lessons.embedding_model both present';
end $$;
