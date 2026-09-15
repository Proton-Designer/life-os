-- P3-07: habit pause/freeze and resume. `lib/habits/actions-core.ts`'s own
-- header on `archiveIdentityHabitCore` named this as explicitly deferred
-- ("Pause/freeze/resume and kill-habit escalation... are explicitly Phase
-- 2+ per the ruling") -- this is that follow-up, for pause/resume (kill
-- escalation already shipped separately, P2-11).
--
-- PRODUCT DECISION, LOGGED HERE AND IN THE TASK'S OWN PLAN (also
-- OPEN_QUESTIONS.md): what happens to a habit's decaying score while
-- paused. The score is NEVER STORED (decay-score.ts's own header) -- it is
-- replayed from `habit_votes` on every read via a closed-form sum over
-- `0.96^daysBetween(vote, today)`. "Pause" is chosen to mean the score
-- FREEZES for the duration of the pause -- the whole point of an explicit
-- pause is that it is NOT neglect, so it must not be penalized the way an
-- unvoted gap already is. Concretely: every day spent paused is EXCLUDED
-- from the days-elapsed count between a vote and "today" when computing
-- score, for every vote that predates the pause -- same effect as if the
-- paused days never happened on the calendar, computed in
-- lib/habits/decay-score.ts's extended `computeHabitDecayScore`.
--
-- A single `paused_at` column on `identity_habits` cannot correctly support
-- this: a habit can be paused and resumed MULTIPLE times over its life,
-- and the exclusion is PER-VOTE (a vote cast between two pause windows
-- must only be offset by the pause AFTER it, not both) -- only a real
-- history of pause RANGES gives the decay math a correct input across
-- more than one pause cycle. Hence a genuine child table, same shape
-- `habit_votes` itself already is for `identity_habits` (one habit, many
-- dated rows).
--
-- RANK IS DELIBERATELY UNCHANGED BY PAUSE: pausing does not mean "not one
-- of my chosen identities anymore" (that is what archiving already means)
-- -- it stays a real occupant of one of the up-to-7 rank slots, so the
-- partial unique index widens to cover 'paused' alongside 'active'
-- (a resumed habit keeps the same rank it had, no reassignment logic
-- needed at all).
--
-- VOTING WHILE PAUSED: not handled by a DB constraint here -- the write
-- path (castHabitVoteCore) already only ever touches habits the caller's
-- own UI shows on the active board, and the active board's own query
-- (`getActiveHabitsWithStatus`) is scoped to `status = 'active'`, so a
-- paused habit is structurally absent from the surface a vote could be
-- cast from. Left as an application-layer guarantee (same trust level
-- `assertRequestedDateIsToday` already places on the UI not sending a
-- backfilled date), not duplicated as a redundant DB check.

alter table public.identity_habits
  drop constraint identity_habits_status_check,
  add constraint identity_habits_status_check check (status = any (array['active', 'archived', 'paused']));

drop index public.identity_habits_rank_per_user_idx;
create unique index identity_habits_rank_per_user_idx on public.identity_habits (user_id, rank) where status in ('active', 'paused');

create table public.identity_habit_pauses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_id uuid not null,
  paused_at date not null,
  -- null = still open (currently paused). Closed on resume.
  resumed_at date,
  created_at timestamptz not null default now(),
  foreign key (user_id, habit_id) references public.identity_habits (user_id, id) on delete cascade,
  constraint identity_habit_pauses_resumed_after_paused check (resumed_at is null or resumed_at >= paused_at)
);

-- At most one OPEN pause per habit -- the database's own guarantee against
-- a double-pause race, same shape habit_votes' own one-vote-per-day unique
-- constraint gives castHabitVoteCore's upsert.
create unique index identity_habit_pauses_one_open_per_habit on public.identity_habit_pauses (user_id, habit_id) where resumed_at is null;

alter table public.identity_habit_pauses enable row level security;

create policy identity_habit_pauses_own_row on public.identity_habit_pauses
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
