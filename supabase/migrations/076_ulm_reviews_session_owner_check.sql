-- ULM: close a cross-owner gap in `reviews` (072) before the first real row
-- can ever be written. `reviews` is append-only — UPDATE/DELETE are denied
-- to `authenticated` by policy and to `service_role` by trigger, and the
-- one sanctioned door (`purge_user_data`) is whole-account deletion, not
-- row repair. A bad row here is permanent for the life of the account. That
-- makes this migration's ordering absolute: it has to land before the
-- merged app writes its first review, not merely before production —
-- there are zero rows in `reviews` right now, and that window closes the
-- moment one is written.
--
-- The hole: 072's `set_review_owner_from_card` forces `user_id`/`book_id`
-- from the referenced CARD's real owner, which is correct and was verified
-- adversarially — but nothing verified that `session_id` (nullable, FK to
-- `work_sessions`) actually belongs to the caller. Forcing user_id from the
-- caller satisfies RLS's WITH CHECK regardless of what session_id
-- references, so user B could insert a review that is legitimately B's own
-- (their own card, their own user_id) while pointing session_id at user A's
-- session. B still can't READ A's reviews — RLS holds — but A's session now
-- has a foreign row attached by session_id, silently corrupting every
-- session-scoped aggregate built from it: cards_reviewed, the session
-- recap, the retention delta. Nothing errors anywhere.
--
-- Sourced from ULM's `20260815041000_l1a_fix_cross_owner_ref.sql`
-- (`check_review_session_owner`, adapted to `work_sessions` — the FK target
-- changed in 072, the ownership check did not), the same file
-- `check_self_explanation_owner` (073) came from — this instruction should
-- have been standing from the reviews batch itself, not added after; caught
-- by widening the grep past the base schema on my own initiative while
-- researching 073-075, the same discipline the Lead asked for on those
-- three tables specifically.

create function public.check_review_session_owner()
returns trigger
language plpgsql
as $$
declare
  session_owner uuid;
begin
  if new.session_id is null then
    return new;
  end if;
  select user_id into session_owner from public.work_sessions where id = new.session_id;
  if session_owner is null then
    raise exception 'check_review_session_owner: session % not found', new.session_id;
  end if;
  if session_owner <> auth.uid() then
    raise exception 'check_review_session_owner: session % does not belong to the caller', new.session_id;
  end if;
  return new;
end;
$$;

create trigger reviews_check_session_owner
  before insert on public.reviews
  for each row execute function public.check_review_session_owner();
