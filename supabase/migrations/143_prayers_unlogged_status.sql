-- DRAFT — NOT a numbered migration. Per supabase/migrations/ALLOCATIONS.md's
-- rule ("Numbers are allocated by the LifeOS lead only. Nobody
-- self-assigns"), this file lives OUTSIDE supabase/migrations/ so it can
-- never be mistaken for an applied or pending migration. File it as
-- supabase/migrations/<N>_prayers_unlogged_status.sql once a number is
-- allocated, then delete this draft.
--
-- R9 (PROGRAM-PLAN.md, approved): a real, non-destructive "unlog" for
-- prayers. The owner asked for "checking off/unchecking particular logs...
-- for any domain" — checking-off exists (`write(domain:"deen",
-- entity:"prayer", action:"log")`); unchecking did not, because the
-- obvious substitute (`status: 'pending'`) is actively wrong: `lib/deen/
-- prayer-status.ts`'s `effectivePrayerStatus` does `if (stored) return
-- stored`, so a stored 'pending' would freeze there FOREVER rather than
-- re-deriving as upcoming/pending/missed while the clock moves — see
-- docs/ai-connector/WRITE-DELETE-DECISION.md for the full history this
-- migration resolves.
--
-- WHY A NEW VALUE, NOT `'pending'` (already legal per 000_baseline.sql's
-- `prayers_status_check`, but never written by any app code today — the
-- app's TS type `StoredPrayerStatus` never includes it): 'unlogged' is
-- semantically distinct from 'pending' precisely so it can be given
-- different treatment in code (lib/deen/prayer-status.ts's
-- `effectivePrayerStatus`/`resolvePrayerStatuses`, both updated in this
-- program's companion commit to treat 'unlogged' EXACTLY like an absent
-- row) without silently changing what a legacy/stray 'pending' row means
-- to any code that already handles it.
--
-- THE ASYMMETRY IS DELIBERATE, NOT AN OVERSIGHT: the app's own
-- `unmarkPrayer` (app/(app)/deen/actions.ts) keeps its real DELETE. A
-- person deleting their own row in their own UI acts on their own data
-- with intent; an MCP call may originate from a model acting on content
-- it was injected with. The no-hard-delete rule is about the ACTOR, not
-- the operation — both paths converge on the same effective status
-- (upcoming/pending/missed, re-derived), so nothing downstream can tell
-- them apart.
--
-- No backfill needed: this is a purely additive CHECK widening. No
-- existing row's status changes meaning, and nothing writes 'unlogged'
-- until this lands (write-registry.ts's `deen.prayer.unlog` handler is
-- already wired in the companion commit, so it starts working the moment
-- this migration applies — not before, since the CHECK would reject the
-- write until then).

alter table public.prayers drop constraint prayers_status_check;

alter table public.prayers add constraint prayers_status_check
  check (status = any (array['pending'::text, 'on_time'::text, 'qada'::text, 'missed'::text, 'unlogged'::text]));
