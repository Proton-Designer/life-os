-- ULM/R43: per-lesson disposition of the hallucination firewall's THIRD
-- arm -- the claim/provenance cosine relevance floor (packages/core's
-- `passesClaimProvenanceRelevance`, ULM's write-time gate #5). Number 117
-- allocated by the LifeOS lead (R5).
--
-- WHY THIS EXISTS, PRECISELY: the firewall runs on two live arms today --
-- verbatim quote match (`isGrounded`, structural) and LLM entailment
-- (`checkEntailment`, real as of A5 item 7b via the dev shim). The THIRD
-- arm needs a local embedding model, which ADR-003 keeps OUT of this
-- repo's runtime dependencies on security grounds (R43: adding
-- `@huggingface/transformers` for the merge benchmark alone produced 4
-- unfixable HIGH advisories -- decoder vulnerabilities in the exact path
-- fed by untrusted user-uploaded PDFs; the risk returns the moment a real
-- caller exists, which is precisely when the caller now does). So the
-- floor is DEFERRED, not broken and not silently dropped -- R43's explicit
-- ruling is that this deferral must be a fact a query can find on the
-- lesson it applies to, never a comment someone has to already know to
-- look for.
--
-- WHY THIS IS NOT THE SAME SHAPE AS `extracted_by` (084), EVEN THOUGH THE
-- ENUM MECHANICS MATCH: 084's NULL means "unknown" and is a REAL, distinct
-- state from any of its named values -- deliberately nullable, no default.
-- This column's NULL would mean something different and worse: "nobody
-- recorded whether the floor ran," which is indistinguishable from
-- "recorded, and it happens to be unset" to any consumer that queries it.
-- R43 was explicit: "not_checked must be a real value, never an absence
-- -- an unset field reads as a pass to anyone querying it, which is the
-- confusion that produced four separate bugs here tonight." So unlike
-- 084, this column is NOT NULL with an explicit DEFAULT -- there is no
-- NULL state to accidentally read as anything.
--
-- WHY NOT REUSE `tokens_in = 0` (the shape already rejected once, R43):
-- that would conflate "spent nothing" with "checked nothing" -- two
-- different facts that happen to coincide today for a stage that hasn't
-- run at all, and stop coinciding the moment any provider makes a real
-- call that still isn't a genuine check, or reports 0 tokens on a fully
-- cached call. A dedicated, explicit value has no such collision.
--
-- PER-LESSON, NOT PER-ATTEMPT: a lesson passes the two live arms while the
-- third was never run, and that must be visible ON THE LESSON -- not
-- buried in `ingestion_job_stage_attempts`' per-invocation telemetry,
-- which answers "did an attempt happen," never "what is true about this
-- specific lesson right now." Same reasoning as 084's own header: the
-- promotion/review flow this exists for grades individual lessons, never
-- books or job runs.
--
-- Native Postgres enum, not text+CHECK, per this repo's house pattern (the
-- `confidence`/`extracted_by` precedent) -- structurally cannot drift from
-- the generated TypeScript type the way a hand-written union mirroring a
-- CHECK constraint can.
--
-- THREE VALUES: `not_checked` (today's universal starting state -- the
-- floor has never run for any lesson, seeded or ingested), `passed` and
-- `failed` for once a real embedder is wired and the check actually runs.
-- No fourth value for "check errored" -- an errored check is not a
-- disposition of the lesson, it's a telemetry failure on the attempt that
-- tried to compute it (ingestion_job_stage_attempts already has succeeded/
-- error for exactly that), and the lesson's own relevance_floor column
-- correctly stays `not_checked` until a check actually completes one way
-- or the other.
--
-- R33: no begin;/commit; in this file -- apply-migration.sh owns the
-- transaction. Apply to SCRATCH ONLY, hash announced and frozen before
-- verification. R14: authored here, verified by Eng 1 -- I am the
-- consumer of this column in future telemetry work, so someone else reads
-- the requirement before it lands.

create type public.relevance_floor_status as enum ('not_checked', 'passed', 'failed');

alter table public.lessons
  add column relevance_floor public.relevance_floor_status not null default 'not_checked';

comment on column public.lessons.relevance_floor is
  'Disposition of the claim/provenance cosine relevance floor (the hallucination firewall''s third, deferred arm -- R43/ADR-003). NOT NULL, no NULL state possible: not_checked is the explicit, real value for "this has never run," never an absence a consumer could mistake for a pass. Set to passed/failed only once a real embedder is wired and the check actually executes for this lesson.';
