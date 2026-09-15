/**
 * Shared client+server constant (no `server-only` -- LecturePanel, a Client
 * Component, needs this for its own pre-upload check too). P3-14
 * 04-verification (tracking-app-a9) measured a HARD project-wide Supabase
 * Storage upload limit of 50 MiB on production, which overrides the
 * `lectures` bucket's own (higher) `file_size_limit` -- 50MiB-1-byte
 * uploads, 51MiB is rejected. Migration 216 lowered the bucket's own limit
 * to match.
 *
 * Env var override: once the account-level limit is raised in the Supabase
 * Dashboard (Storage -> Settings -- no Management API token available to do
 * this from code, see $SD/OPEN_QUESTIONS.md), set LECTURE_MAX_UPLOAD_BYTES
 * on Vercel and apply a migration raising the bucket's own file_size_limit
 * to match -- this constant then follows without a code change.
 */
export const LECTURE_MAX_BYTES = Number(process.env.LECTURE_MAX_UPLOAD_BYTES ?? 52428800);

export const LECTURE_MAX_SIZE_MESSAGE =
  "Recordings can be up to 50 MB. A 90-minute lecture at 64 kbps mono is about 43 MB; compress it or split it into parts.";
