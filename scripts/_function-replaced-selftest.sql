-- Self-test payload for check-function-replaced.sh. Injects a throwaway
-- function and runs the REAL detection logic against it — byte-identical
-- redefinition (must report NO-OP: this is the failure mode nothing else
-- caught), a genuinely different redefinition (must report CHANGE), a
-- present marker (must report PRESENT), an absent marker (must report
-- MISSING), and an overloaded second signature (must report OVERLOAD) —
-- all in ONE session, inside a transaction that is always rolled back.
--
-- Injection and detection must share a session: a rolled-back transaction
-- is invisible to a separate psql connection, so a two-session self-test
-- would report "not detected" for the wrong reason and look exactly like a
-- broken detector (the lesson from check-fk-tenancy.sh's own self-test).

begin;

-- Body A: the "before" state.
create function public._check_function_replaced_canary(a int)
returns int language sql as $body$
  select a + 1
$body$;

select md5(pg_get_functiondef(oid)) as snapshot_md5
  from pg_proc where proname = '_check_function_replaced_canary'
\gset

-- Byte-identical redefinition. THE case: everything about this body is
-- fine, and a marker/arity/count check alone would report success on a
-- migration that changed nothing.
create or replace function public._check_function_replaced_canary(a int)
returns int language sql as $body$
  select a + 1
$body$;

select case when md5(pg_get_functiondef(oid)) = :'snapshot_md5'
            then 'NOOP: DETECTED' else 'NOOP: MISSED' end
  from pg_proc where proname = '_check_function_replaced_canary';

-- A genuinely different body, carrying a marker to exercise --must-contain.
create or replace function public._check_function_replaced_canary(a int)
returns int language sql as $body$
  -- MARKER_PRESENT_IN_B
  select a + 2
$body$;

select case when md5(pg_get_functiondef(oid)) <> :'snapshot_md5'
            then 'CHANGE: DETECTED' else 'CHANGE: MISSED' end
  from pg_proc where proname = '_check_function_replaced_canary';

select case when pg_get_functiondef(oid) like '%MARKER_PRESENT_IN_B%'
            then 'MUST_CONTAIN_PRESENT: DETECTED' else 'MUST_CONTAIN_PRESENT: MISSED' end
  from pg_proc where proname = '_check_function_replaced_canary';

select case when pg_get_functiondef(oid) not like '%MARKER_NOT_IN_ANY_BODY%'
            then 'MUST_CONTAIN_MISSING: DETECTED' else 'MUST_CONTAIN_MISSING: MISSED' end
  from pg_proc where proname = '_check_function_replaced_canary';

-- A second function, same name, different signature -- CREATE OR REPLACE's
-- overload trap (convergence-coverage.md §6, Hazard 1).
create function public._check_function_replaced_canary(a int, b int)
returns int language sql as $body2$
  select a + b
$body2$;

select case when count(*) = 2 then 'OVERLOAD: DETECTED' else 'OVERLOAD: MISSED' end
  from pg_proc where proname = '_check_function_replaced_canary';

rollback;
