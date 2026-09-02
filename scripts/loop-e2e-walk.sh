#!/bin/bash
# loop-e2e-walk.sh — walk one account through the whole loop seam and print
# what is true at each step: promote -> verdict -> the cards leave the queue.
#
# WHY A WALK AND NOT A CHECK. The drift instruments
# (check-retired-at-drift.sh, check-suspension-drift.sh) answer "do the stored
# facts agree with the log?" for the whole table. This answers a different and
# narrower question: does ONE user, going through the loop once, actually stop
# being asked the thing they said they now do? Those are not the same claim,
# and the first can be green while the second is broken -- if, say,
# get_session_queue were reverted, every derived column would still agree with
# every log and the user would still be quizzed on an adopted lesson.
#
# It prints at every step ON PURPOSE. A pass/fail line alone is a claim; the
# printed queue before and after is the evidence for it, readable by someone
# who does not trust this script.
#
# DEFAULT IS A ROLLED-BACK REHEARSAL. The walk runs inside a transaction that
# is rolled back unless --commit is passed. That makes it re-runnable against
# the same account any number of times and non-destructive by default. Pass
# --commit when you want the state left visible for a UI check.
#
# Usage:
#   ./scripts/loop-e2e-walk.sh --target <postgres-url> --user <uuid> [--commit] [--allow-production]
#
# R50: the target must be named, its host is printed before anything is
# written, and a non-local host is refused unless --allow-production is passed.
set -uo pipefail

TARGET=""; USER_ID=""; COMMIT=0; ALLOW_PROD=0; STOP_AFTER_PROMOTE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --target)           TARGET="${2:-}"; shift 2 ;;
    --user)             USER_ID="${2:-}"; shift 2 ;;
    --commit)           COMMIT=1; shift ;;
    --stop-after-promote) STOP_AFTER_PROMOTE=1; shift ;;
    --allow-production) ALLOW_PROD=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$TARGET" ] || { echo "loop-e2e-walk: --target <postgres-url> is REQUIRED. This script WRITES." >&2; exit 2; }
[ -n "$USER_ID" ] || { echo "loop-e2e-walk: --user <uuid> is REQUIRED. It is never guessed or invented -- naming the account is the point." >&2; exit 2; }

HOST=$(printf '%s' "$TARGET" | sed -E 's|^[^@]*@||; s|[:/].*$||')
echo "loop-e2e-walk: TARGET HOST = ${HOST}"
case "$HOST" in
  localhost|127.0.0.1|::1) ;;
  *) if [ "$ALLOW_PROD" -ne 1 ]; then
       echo "loop-e2e-walk: REFUSING a non-local host without --allow-production." >&2; exit 2
     fi ;;
esac
if [ "$COMMIT" -eq 1 ]; then
  echo "loop-e2e-walk: --commit given; state WILL be left behind."
  if [ "$STOP_AFTER_PROMOTE" -eq 1 ]; then
    echo "loop-e2e-walk: --stop-after-promote; a promotion is committed, NO verdict is recorded."
    echo "                That promotion is REVERSIBLE: delete it and nothing remains."
  else
    # PERMANENCE WARNING. Proven on a container as superuser, not assumed:
    #   deleting the verdict      -> REFUSED (lesson_verdicts is append-only,
    #                                no role exemption)
    #   deleting the promotion    -> REFUSED (cascades into the verdict, which
    #                                refuses)
    #   un-suspending the cards   -> succeeds, and then check-suspension-drift
    #                                goes RED, because the adopted verdict that
    #                                justifies the suspension cannot be removed
    # So a committed full walk cannot be cleanly undone on ANY account.
    echo "loop-e2e-walk: WARNING -- a committed full walk is PERMANENT."
    echo "                The verdict cannot be deleted (append-only, no role exemption),"
    echo "                the promotion cannot be deleted (it cascades into the verdict),"
    echo "                and un-suspending the cards alone turns check-suspension-drift RED."
    echo "                Use --stop-after-promote if you only need the verdict card to render."
  fi
else
  echo "loop-e2e-walk: rehearsal; the transaction is rolled back at the end."
fi

# PRECONDITION GATE (R70). A walk against a database missing the mechanism must
# FAIL LOUDLY, never print a tidy "0 cards in queue, pass". "Could not measure"
# is not "measured zero".
MISSING=$(psql "$TARGET" -X -q -t -A </dev/null 2>&1 <<'SQL'
select string_agg(missing, ', ') from (
  select 'cards.suspended_at (126)' as missing
   where not exists (select 1 from information_schema.columns
                      where table_schema='public' and table_name='cards' and column_name='suspended_at')
  union all
  select 'lesson_promotions (124)'
   where to_regclass('public.lesson_promotions') is null
  union all
  select 'lesson_verdicts (124)'
   where to_regclass('public.lesson_verdicts') is null
  union all
  select 'trg_suspend_cards_on_adopted_verdict (126)'
   where not exists (select 1 from pg_trigger where tgname='trg_suspend_cards_on_adopted_verdict' and not tgisinternal)
  union all
  select 'get_session_queue does not filter suspended cards (126 not applied?)'
   where not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                      where n.nspname='public' and p.proname='get_session_queue'
                        and pg_get_functiondef(p.oid) like '%suspended_at is null%')
) t;
SQL
)
# Compare the VARIABLE, not grep's exit code on it. The first version was
# `printf '%s' "$MISSING" | grep -qE '^\s*$'` -- and an EMPTY string produces
# ZERO LINES, which grep never matches, so the healthy case (nothing missing)
# took the failure branch every time. Same family as R70 read backwards: an
# exit code answering a question about lines when the question was about
# emptiness.
MISSING_TRIMMED=$(printf '%s' "$MISSING" | tr -d '[:space:]')
if [ -n "$MISSING_TRIMMED" ]; then
  echo "PRECONDITIONS NOT MET -- this database cannot answer the question." >&2
  if printf '%s' "$MISSING" | grep -qi "psql: error"; then
    # Distinguish "could not connect" from "connected and found the mechanism
    # missing". Telling someone to apply a migration when the real problem is
    # a password sends them a long way in the wrong direction.
    echo "  the query never ran:" >&2
    printf '%s\n' "$MISSING" | sed 's/^/    /' >&2
  else
    echo "  missing: $MISSING" >&2
    echo "  Not a failure of the loop; a failure to be able to test it. Apply 124 and 126 first." >&2
  fi
  exit 1
fi
# SECOND GATE: this ACCOUNT must be able to promote at all.
#
# `lesson_promotions.area_id` is NOT NULL and FKs to user_domains, so an
# account with no areas (legacy mode -- Ayman's real account and SEED are both
# in that state) cannot promote anything. Without this check the walk would
# reach STEP 3 and die on a not-null violation, which reads as "the loop is
# broken" when the truth is "this account was never eligible". Distinguishing
# those two is the entire job of a gate.
AREAS=$(psql "$TARGET" -X -q -t -A </dev/null 2>&1 -c \
  "select count(*) from public.user_domains where user_id = '$USER_ID' and archived_at is null;")
if ! printf '%s' "$AREAS" | grep -qE '^[0-9]+$'; then
  echo "loop-e2e-walk: could not count this account's areas -- the query never ran:" >&2
  printf '%s\n' "$AREAS" | sed 's/^/    /' >&2
  exit 1
fi
if [ "$AREAS" -eq 0 ]; then
  echo "NOT ELIGIBLE: user $USER_ID has no active user_domains rows." >&2
  echo "  lesson_promotions.area_id is NOT NULL, so this account cannot promote anything." >&2
  echo "  That is a legacy-mode account, not a broken loop. Run this on a domains-mode" >&2
  echo "  account (seed-domains), not on SEED." >&2
  exit 1
fi
echo "loop-e2e-walk: account has ${AREAS} active area(s) -- eligible to promote."
echo "loop-e2e-walk: preconditions met (124 + 126 present, queue filters suspended cards)."
echo

psql "$TARGET" -X -q -t -A -v ON_ERROR_STOP=1 -v uid="$USER_ID" -v commit="$COMMIT" -v stop_after_promote="$STOP_AFTER_PROMOTE" </dev/null <<'SQL'
begin;
select set_config('request.jwt.claim.sub', :'uid', false);

\echo '--- STEP 1: the queue BEFORE anything ---------------------------------'
select '  ' || q.reason || '  ' || left(l.title, 44) || '   [card ' || right(q.card_id::text, 6) || ']'
  from public.get_session_queue(20, 20) q
  join public.cards c on c.id = q.card_id
  join public.lessons l on l.id = c.lesson_id
 order by q.queue_position;

\echo '--- STEP 2: pick a lesson that is IN the queue and not yet promoted ----'
create temporary table walk_subject on commit drop as
select l.id as lesson_id, l.title,
       (select count(*) from public.cards c2 where c2.lesson_id = l.id and c2.suspended_at is null) as live_cards
  from public.get_session_queue(20, 20) q
  join public.cards c on c.id = q.card_id
  join public.lessons l on l.id = c.lesson_id
 where not exists (select 1 from public.lesson_promotions p
                    where p.lesson_id = l.id and p.user_id = auth.uid() and p.retired_at is null)
 limit 1;

select case when count(*) = 0
       then '  NO SUBJECT: every queued lesson is already promoted, or the queue is empty. COVERAGE GAP, not a pass.'
       else '  subject: ' || (select left(title, 50) || '  (' || live_cards || ' live cards)' from walk_subject) end
  from walk_subject;

do $$ begin
  if not exists (select 1 from walk_subject) then
    raise exception 'loop-e2e-walk: no unpromoted lesson in this account''s queue -- nothing to walk';
  end if;
end $$;

\echo '--- STEP 3: PROMOTE it ------------------------------------------------'
-- In --stop-after-promote mode the due date is set to NOW so the verdict card
-- renders immediately in the close. That date is fabricated for the capture
-- and is the one dishonest value in this script -- stated here rather than
-- left for someone to discover. The alternative is waiting thirty days.
insert into public.lesson_promotions (user_id, lesson_id, area_id, accepted_text, verdict_due_at)
select '00000000-0000-0000-0000-000000000000', s.lesson_id,
       (select id from public.user_domains where user_id = auth.uid() and archived_at is null order by position limit 1),
       'loop-e2e-walk: the thing I said I would actually do',
       case when :stop_after_promote = 1 then now() else now() + interval '30 days' end
  from walk_subject s;

select '  promotion created: ' || left(p.id::text, 8) || '  retired_at=' || coalesce(p.retired_at::text, 'null (active)')
       || '  verdict due ' || to_char(p.verdict_due_at, 'YYYY-MM-DD')
  from public.lesson_promotions p join walk_subject s on s.lesson_id = p.lesson_id
 where p.user_id = auth.uid() and p.retired_at is null;

\echo '--- STEP 4: the cards are STILL in the queue (promoting is not adopting)'
select '  live cards for the subject still queued: ' || count(*)
  from public.get_session_queue(20, 20) q
  join public.cards c on c.id = q.card_id
  join walk_subject s on s.lesson_id = c.lesson_id;

\if :stop_after_promote
  \echo '--- STOPPING AFTER PROMOTE (--stop-after-promote) ---------------------'
  \echo '    A promotion exists and is due NOW, so the verdict card renders in'
  \echo '    the close. No verdict recorded, nothing suspended, fully reversible:'
  \echo '      delete from public.lesson_promotions where id = <the id above>;'
  commit;
  \q
\endif

\echo '--- STEP 5: record the ADOPTED verdict --------------------------------'
insert into public.lesson_verdicts (promotion_id, verdict)
select p.id, 'adopted' from public.lesson_promotions p join walk_subject s on s.lesson_id = p.lesson_id
 where p.user_id = auth.uid() and p.retired_at is null;

select '  promotion retired at: ' || coalesce(p.retired_at::text, 'STILL NULL -- the retire trigger did not fire')
  from public.lesson_promotions p join walk_subject s on s.lesson_id = p.lesson_id
 where p.user_id = auth.uid();

select '  cards suspended: ' || count(*) filter (where c.suspended_at is not null) || ' of ' || count(*)
       || '  reason=' || coalesce(max(c.suspended_reason), 'none')
  from public.cards c join walk_subject s on s.lesson_id = c.lesson_id;

\echo '--- STEP 6: the queue AFTER ------------------------------------------'
select '  ' || q.reason || '  ' || left(l.title, 44) || '   [card ' || right(q.card_id::text, 6) || ']'
  from public.get_session_queue(20, 20) q
  join public.cards c on c.id = q.card_id
  join public.lessons l on l.id = c.lesson_id
 order by q.queue_position;

\echo '--- STEP 7: the verdict ----------------------------------------------'
do $$
declare
  still_queued int;
  other_queued int;
begin
  select count(*) into still_queued
    from public.get_session_queue(20, 20) q
    join public.cards c on c.id = q.card_id
    join walk_subject s on s.lesson_id = c.lesson_id;

  select count(*) into other_queued
    from public.get_session_queue(20, 20) q
    join public.cards c on c.id = q.card_id
   where c.lesson_id <> (select lesson_id from walk_subject);

  if still_queued > 0 then
    raise exception 'FAIL: % card(s) of the adopted lesson are STILL being served', still_queued;
  end if;
  -- The control. A queue that returns nothing at all would also pass
  -- "the adopted lesson is gone", and would mean the filter removed
  -- everything rather than the right thing.
  if other_queued = 0 then
    raise exception 'INCONCLUSIVE: the adopted lesson left the queue, but so did everything else. That is not a pass -- seed an account with more than one lesson.';
  end if;
  raise notice 'PASS: the adopted lesson stopped being asked (0 of its cards served); % other card(s) still served.', other_queued;
end $$;

\if :commit
  \echo '--- committing (--commit given) ---'
  commit;
\else
  \echo '--- rolling back (rehearsal; pass --commit to keep the state) ---'
  rollback;
\endif
SQL
RC=$?
echo
if [ "$RC" -eq 0 ]; then echo "loop-e2e-walk: completed. Read the printed steps, not just this line."; else echo "loop-e2e-walk: FAILED (exit $RC). The printed steps above say where." >&2; fi
exit "$RC"
