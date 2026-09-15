-- 216: lower the `lectures` bucket's own file_size_limit to match the
-- account's real, effective project-wide Supabase Storage upload limit
-- (P3-14 04-verification finding, tracking-app-a9).
--
-- Migration 211 set file_size_limit to 500 MiB, an assumption about the
-- bucket's own limit that turned out to be moot: production measured a
-- HARD project-wide ceiling of 50 MiB (52428800 bytes) that overrides any
-- individual bucket's own, higher limit -- confirmed by direct measurement
-- on production (a signed upload of 50MiB-1-byte succeeds, 51MiB is
-- rejected with "The object exceeded the maximum allowed size"). There is
-- no Management API token available to raise the account-level limit
-- itself; that's an operator action in the Supabase Dashboard (Storage ->
-- Settings), logged in OPEN_QUESTIONS.md for the morning.
--
-- Lowering the BUCKET's own value to match reality doesn't change what
-- Storage actually enforces (the project-wide ceiling was already binding),
-- but stops this bucket from advertising a 500 MiB capacity the account can
-- never actually deliver -- the exact "check examines nothing" trap CLAUDE.md
-- warns about, just for a config value instead of a test. App-level
-- validation (lib/school/lecture-limits.ts, prepareLectureUpload) is updated
-- in the same commit to match, so a user gets a clear message before
-- uploading, not Storage's raw rejection after minutes of upload time.
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

update storage.buckets
set file_size_limit = 52428800
where id = 'lectures';
