-- Second self-test payload for check-enum-drift.sh, proving the CATALOG SCAN
-- half (added 2026-09-10/11) rather than the original pairwise-drift half
-- (_enum-drift-selftest.sql, unchanged, still proves that one).
--
-- WHY THIS ONE IS DIFFERENT AND BOTH ARE NEEDED
--
-- The original self-test proves: "a column already listed in PAIRS, whose
-- allowed set widens, is detected." It cannot prove the other failure mode
-- this pass exists to close: a column with a REAL, live CHECK constraint that
-- was never added to PAIRS at all -- which is exactly what happened to
-- `mcp_widgets.kind`. That column wasn't drifting under a check that was
-- watching it; it was invisible to the check from the moment the table was
-- created, because nobody had written its line into PAIRS yet, and the old
-- script had no mechanism to notice a constrained column it didn't already
-- know to look for.
--
-- This self-test proves the NEW mechanism (the catalog scan in
-- check-enum-drift.sh's `catalog_scan()`) would have caught that shape of
-- gap on day one: create a single-column, value-set CHECK constraint with NO
-- corresponding PAIRS entry (there never will be one for this canary name),
-- confirm the scan's own query sees it, then roll back so the canary table
-- never exists outside this one transaction, on any database.

begin;

create table public._enum_drift_selftest_canary (
  val text not null check (val = any (array['aaa', 'bbb']))
);

-- Same query shape catalog_scan() runs in the real script -- restated here
-- rather than sourced from one place, because this file has no way to import
-- bash; kept deliberately identical so this self-test exercises the real
-- logic, not a lookalike that could drift from it.
select conrelid::regclass::text || '.' || a.attname
from pg_constraint c
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
where c.contype = 'c'
  and c.connamespace = 'public'::regnamespace
  and array_length(c.conkey, 1) = 1
  and pg_get_constraintdef(c.oid) ~ ''''
  and conrelid = 'public._enum_drift_selftest_canary'::regclass;

rollback;
