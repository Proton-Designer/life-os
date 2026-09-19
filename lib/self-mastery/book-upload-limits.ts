/**
 * Shared client+server constant (no `server-only` -- UploadBookDialog, a
 * Client Component, needs this for its own pre-upload check too). Same
 * shape as lib/school/lecture-limits.ts, deliberately not merged with it
 * (different ownership, see CLAIMS.md) even though the underlying number
 * comes from the same finding: P3-14 04-verification (tracking-app-a9)
 * measured a HARD project-wide Supabase Storage upload limit of 50 MiB on
 * production, which overrides any bucket's own (higher) `file_size_limit`
 * -- 50MiB-1-byte uploads, 51MiB is rejected. This is why `self-mastery-
 * actions.ts` no longer advertises 200MB (URGENT pdf-upload fix,
 * 2026-09-19): a promise the runtime could never keep even before the
 * separate 1MB Server Action body-size crash that prompted this fix.
 *
 * Env var override: once the account-level limit is raised in the Supabase
 * Dashboard (Storage -> Settings -- no Management API token available to do
 * this from code, see $SD/OPEN_QUESTIONS.md), set BOOK_MAX_UPLOAD_BYTES on
 * Vercel and apply a migration raising the `books` bucket's own
 * file_size_limit to match -- this constant then follows without a code
 * change. If that ever happens, raise LECTURE_MAX_UPLOAD_BYTES the same way
 * -- they're two env vars for one underlying account-level ceiling.
 */
export const BOOK_MAX_BYTES = Number(process.env.BOOK_MAX_UPLOAD_BYTES ?? 52428800);

export const BOOK_MAX_SIZE_MESSAGE = "That file is too large. Books can be up to 50 MB.";
