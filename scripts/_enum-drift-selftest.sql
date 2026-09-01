-- Self-test payload for check-enum-drift.sh. Runs inside a transaction that is
-- ALWAYS rolled back — the real constraint is never modified.
--
-- DERIVES the canary constraint from the constraint currently in place rather
-- than restating the allowed set literally.
--
-- WHY: an earlier version hardcoded
--     check (kind in ('deep_work','deep_study','canary_kind'))
-- which was correct when written and became WRONG the moment migration 077
-- added 'learn'. The hardcoded set dropped it, so ADD CONSTRAINT failed
-- validation against rows that by then existed, and the self-test errored out.
-- **The detector drifted in exactly the way it exists to detect.**
--
-- A failing self-test is worse than a missing one: it leaves the next person
-- choosing between "the tool is broken, skip the drift check" and "skip the
-- self-test, trust the green" — and the second is precisely what a self-test
-- exists to make unnecessary.

begin;

do $$
declare
  v_def  text;
  v_vals text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.work_sessions'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%kind%'
     and pg_get_constraintdef(oid) like '%ANY%';

  -- Preserve every currently-allowed literal, then append the canary.
  select string_agg(quote_literal(v), ', ')
    into v_vals
    from (select distinct m[1] as v
            from regexp_matches(v_def, $re$'([a-z_]+)'$re$, 'g') m) t;

  execute 'alter table public.work_sessions drop constraint work_sessions_kind_check';
  execute format(
    'alter table public.work_sessions add constraint work_sessions_kind_check check (kind in (%s, %L))',
    v_vals, 'canary_kind');
end
$$;

select regexp_replace(m[1], $re$'$re$, '', 'g')
  from pg_constraint c
  cross join lateral regexp_matches(pg_get_constraintdef(c.oid), $re$'([a-z_]+)'$re$, 'g') m
 where c.conrelid = 'public.work_sessions'::regclass
   and c.contype = 'c'
   and pg_get_constraintdef(c.oid) like '%kind%'
   and pg_get_constraintdef(c.oid) like '%ANY%';

rollback;
