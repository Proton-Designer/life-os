-- 269: let the `books` bucket accept the Focus reader's files.
--
-- Verified live 2026-10-19: storage.buckets 'books' has allowed_mime_types = {application/pdf}, so the reader's
-- signed uploads of an EPUB / text / Markdown / HTML source (source.<ext>) and the server's own upload of the
-- built document (reader-v1.json, application/json) would be rejected by Storage.
--
-- Idempotent: sets the full list (it does not append), so re-applying is a no-op. file_size_limit is left alone
-- (the project-wide 50 MiB ceiling is what binds; see 216). Existing PDFs are unaffected.
-- No begin;/commit; -- the runner owns the transaction.

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/epub+zip',
  'text/plain',
  'text/markdown',
  'text/html',
  'application/xhtml+xml',
  'application/json'
]
where id = 'books';
