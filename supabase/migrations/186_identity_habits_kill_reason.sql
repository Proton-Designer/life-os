-- P2-11, overnight run 2026-09-15, Sonnet ENG 1 (Team A).
--
-- Escalating kill-habit flow, on top of Phase 1's identity_habits/
-- habit_votes/score (migration 175). `archiveIdentityHabitCore`
-- (lib/habits/actions-core.ts) already exists as Phase 1's one-step
-- archive and is UNCHANGED by this migration -- kill is a new, parallel,
-- escalation-aware path (lib/habits/actions-core.ts's own header already
-- named this exact gap: "kill-habit escalation... explicitly Phase 2+").
--
-- kill_reason is nullable and populated ONLY when the escalated path
-- fires (lib/habits/kill-escalation.ts's killRequiresReason, reusing the
-- SAME pure-gate-function shape as lib/distractions/plan-rules.ts's own
-- mustRewrite/FORCED_REWRITE_AFTER_SKIPS -- the concrete "existing
-- escalation pattern" the roadmap names as reusable). A habit killed
-- below the escalation threshold has no reason on file, same as an
-- ordinary Phase 1 archive -- this is additive context, not a required
-- field on every archive.
--
-- No RLS change: identity_habits_own_row (175) already covers this
-- column for the owning user.
--
-- No begin;/commit; -- the runner owns the transaction.

alter table public.identity_habits
  add column kill_reason text null;

comment on column public.identity_habits.kill_reason is
  'P2-11: the required reason a user gave when killing a habit past the escalation threshold (lib/habits/kill-escalation.ts''s killRequiresReason). Null for an ordinary Phase 1 archive, or a kill below the threshold.';
