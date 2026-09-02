-- 128: a retired promotion takes no further verdicts.
--
-- WHAT THIS CLOSES, AND WHOSE GAP IT IS. `124` (mine) made `lesson_verdicts`
-- append-only and gave it a FK to `lesson_promotions`, and
-- `retire_promotion_on_terminal_verdict` uses
-- `coalesce(retired_at, new.verdict_at)` so a later verdict cannot move the
-- retirement date. Nothing anywhere checks whether the promotion is ALREADY
-- retired. Verified on a container rather than assumed: inserting a second
-- terminal verdict on a retired promotion is ACCEPTED today.
--
-- The promotion UI was written believing the database refused this. It does
-- not, and a client-side guard is not a guarantee: a double submit, a stale
-- evening close left open overnight, or a replayed Server Action all land a
-- second judgement on a closed experiment. `retired_at` would stay correct and
-- `check-retired-at-drift.sh` would stay green -- the log would simply contain
-- a verdict on something already judged, and the close would show the user a
-- decision they made once as though they had made it twice.
--
-- WHY IT REFUSES `still_testing` TOO, not only the terminal verdicts. Once a
-- promotion is retired the experiment is over. "Still testing" on a finished
-- experiment is not a milder version of the same mistake, it is a claim that
-- the thing is still running -- which is exactly the state the retirement
-- says it is not in.
--
-- ORDERING IS LOAD-BEARING AND IS ASSERTED BELOW. Postgres fires BEFORE
-- triggers in NAME order. `lesson_verdicts_set_user_id` populates
-- `new.user_id` from the caller, and this trigger scopes its lookup by that
-- column, so it must fire AFTER it: `trg_...` sorts after
-- `lesson_verdicts_...`. That is a real dependency on a naming coincidence, so
-- the DO block at the end checks it instead of trusting it.
--
-- Transaction control is the RUNNER's (R33) — no begin/commit in this file.

create or replace function public.reject_verdict_on_retired_promotion()
returns trigger
language plpgsql
as $$
declare
  already_retired timestamptz;
begin
  select p.retired_at into already_retired
    from public.lesson_promotions p
   where p.id = new.promotion_id
     and p.user_id = new.user_id;

  -- NOT FOUND is deliberately not an error here. Under RLS a promotion
  -- belonging to someone else is invisible to this lookup, and the FK
  -- (lesson_verdicts_user_id_promotion_id_fkey) is what must reject that --
  -- by name, with the message it already has. Raising our own exception here
  -- would replace a precise, existing rejection with a vaguer new one.
  if already_retired is not null then
    raise exception
      'lesson_verdicts: promotion % was retired at % and takes no further verdicts',
      new.promotion_id, already_retired
      -- 55000 object_not_in_prerequisite_state, and the choice matters. The
      -- obvious pick is check_violation, but the client already maps
      -- check_violation on this table to the abandoned-needs-a-reason CHECK
      -- and would answer "say what didn't work" to a user who said plenty and
      -- simply answered twice. Two different refusals sharing one code means
      -- one of them gets the wrong sentence. 55000 says what is actually
      -- true: the promotion is not in a state that permits this.
      using errcode = '55000';
  end if;

  return new;
end;
$$;

comment on function public.reject_verdict_on_retired_promotion() is
  'Phase C / 128. A promotion retired by an adopted or abandoned verdict accepts no further verdicts of any kind. Raises 55000 (object_not_in_prerequisite_state) rather than check_violation, so the client can tell this refusal apart from the abandoned-needs-a-reason CHECK on the same table. Must fire after lesson_verdicts_set_user_id -- see 128''s header and its ordering assert.';

drop trigger if exists trg_reject_verdict_on_retired_promotion on public.lesson_verdicts;
create trigger trg_reject_verdict_on_retired_promotion
  before insert on public.lesson_verdicts
  for each row execute function public.reject_verdict_on_retired_promotion();

do $$
declare
  guard_position int;
  setter_position int;
begin
  select count(*) into setter_position
    from pg_trigger t
   where t.tgrelid = 'public.lesson_verdicts'::regclass
     and not t.tgisinternal
     and t.tgname <= 'lesson_verdicts_set_user_id';

  select count(*) into guard_position
    from pg_trigger t
   where t.tgrelid = 'public.lesson_verdicts'::regclass
     and not t.tgisinternal
     and t.tgname <= 'trg_reject_verdict_on_retired_promotion';

  if guard_position <= setter_position then
    raise exception
      'shape assert failed: trg_reject_verdict_on_retired_promotion must sort AFTER lesson_verdicts_set_user_id, or new.user_id is still null when the guard reads it';
  end if;

  raise notice '128 shape assert passed: the guard fires after user_id is set.';
end $$;
