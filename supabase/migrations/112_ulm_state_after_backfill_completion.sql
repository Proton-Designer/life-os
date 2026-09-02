-- ULM: R1 completion. Closes the two nullable columns `111` deliberately
-- left open (`reviews.state_after`, `reviews.learning_steps_after`) with
-- real `SET NOT NULL`s, corrects `card_states.learning_steps` from the
-- now-complete log, and retires the one-time backfill RPC `111` shipped
-- specifically to make this migration possible.
--
-- PREREQUISITE, RUN BEFORE THIS FILE, NOT PART OF IT: scripts/
-- backfill-review-state-after.ts against the target environment, via its
-- RPC calls to public._backfill_review_state_after (111) -- SQL cannot call
-- ts-fsrs, so Tier 2 of the state_after backfill has to happen in
-- TypeScript, before this file's SET NOT NULL can succeed. Re-runnable; see
-- its own header. On production specifically (0 reviews after R20.7's
-- purge) this script will report "0 cards with a null state_after row.
-- Nothing to do." -- a correct no-op, not a skipped step, and stated here
-- so a future reader doesn't mistake an empty-table run for an unrun one.
--
-- CONFIRM BEFORE RUNNING THIS FILE: zero remaining nulls on both columns.
--   select count(*) from public.reviews where state_after is null;
--   select count(*) from public.reviews where learning_steps_after is null;
-- Both must return 0, or the SET NOT NULL statements below fail loudly --
-- which is the intended, honest failure mode if the backfill script left
-- anything behind, not a bug in this migration.

-- ---------------------------------------------------------------------------
-- learning_steps_after correction. Pure SQL (unlike state_after, this is a
-- direct function of state_after + rating, both real now) -- guarded by
-- `is null` so it only touches rows the Tier 2 script's state_after write
-- didn't already let a prior correction cover, and is safely re-runnable.
-- Needs the same append-only disable/enable bracket 111's own backfill did
-- -- reviews has no role exemption, including for this migration.
-- ---------------------------------------------------------------------------
alter table public.reviews disable trigger reviews_no_update;
update public.reviews
set learning_steps_after = case when state_after = 'learning' and rating = 3 then 1 else 0 end
where learning_steps_after is null;
alter table public.reviews enable trigger reviews_no_update;

-- ---------------------------------------------------------------------------
-- card_states.learning_steps correction: each row's value is its owning
-- card's LATEST review's (now-complete) learning_steps_after. Only updates
-- rows that actually disagree -- most will already hold the correct value
-- from 111's own DEFAULT 0, since Tier 1 backfilled nothing on today's data.
-- ---------------------------------------------------------------------------
update public.card_states cs
set learning_steps = r.learning_steps_after
from (
  select distinct on (card_id) card_id, learning_steps_after
  from public.reviews
  where card_id is not null
  order by card_id, reviewed_at desc, id desc
) r
where cs.card_id = r.card_id and cs.learning_steps <> r.learning_steps_after;

-- ---------------------------------------------------------------------------
-- The real gate. Fails loudly, honestly, if the backfill left a single row
-- behind -- that is this ALTER's job, not a risk to work around.
-- ---------------------------------------------------------------------------
alter table public.reviews
  alter column state_after set not null;
alter table public.reviews
  alter column learning_steps_after set not null;

-- ---------------------------------------------------------------------------
-- Retire the one-time backfill RPC now that its job is done. LifeOS lead's
-- own note on 111: "its own comment says 'drop this function once the
-- backfill is complete', and that's a note asking a future person to
-- remember. Put the drop in 112 so the door closes by construction rather
-- than by intention." It was SECURITY DEFINER specifically to open/close
-- the append-only trigger within one call for a PostgREST-based script that
-- has no other way to do that -- once nothing needs that door open, the
-- door itself should not still exist to be reused for something else.
-- ---------------------------------------------------------------------------
drop function public._backfill_review_state_after(uuid, public.fsrs_state);

comment on column public.reviews.state_after is
  'The fsrs_state resulting from this review -- symmetric with stability_before/after and difficulty_before/after (R1). NOT NULL as of 112 -- every existing row backfilled, every new row supplied by submit_review.';
comment on column public.reviews.learning_steps_after is
  'ts-fsrs''s learning-step counter resulting from this review (R17). NOT NULL as of 112.';
