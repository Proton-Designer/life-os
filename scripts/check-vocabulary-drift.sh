#!/usr/bin/env bash
# check-vocabulary-drift.sh — find two DATABASE objects that encode the same concept
# with different spellings.
#
# WHY THIS EXISTS, AND WHY NOTHING ELSE CAUGHT IT:
# `attempts.confidence` (text + CHECK) allowed {sure, thinkso, guessing}.
# `confidence_level`    (postgres enum) allowed {sure, think_so, guessing}.
# Same user-facing calibration tap, two spellings, one product. Nothing errored --
# each value validated against its own rule -- and it would have thrown at grade time
# the moment the shared FSRS mapping consumed both, because its `never` exhaustiveness
# arm raises on an unrecognised literal.
#
# `check-enum-drift.sh` structurally could not see it: it compares text+CHECK columns to
# hand-written TypeScript unions. The enum half is out of its scope, and the CHECK half
# had no TS mirror to drift from. BOTH HALVES WERE INDIVIDUALLY BELOW THE DETECTOR'S
# FLOOR, and the defect lived only in the relationship between them.
#
# Every other check in this repo compares one database object to one code artifact.
# This one compares database objects to each other. That is the whole point.
#
# It is a HEURISTIC, deliberately. It flags value sets that are near-identical but not
# identical -- high overlap with at least one mismatch -- which is the signature of an
# accidental divergence rather than two genuinely different vocabularies. Expect some
# noise; triage it once. A false positive costs a glance, a miss costs a runtime throw.
#
# ---------------------------------------------------------------------------
# WHAT A GREEN FROM THIS SCRIPT DOES *NOT* MEAN. READ THIS BEFORE TRUSTING ONE.
#
# This is a PAIRWISE check. It can only find a conflict between two value sets that
# are both present in the database it is pointed at. **A green against a database
# missing one half of a pair is not evidence of consistency -- it is the absence of
# anything to compare.** A single-sided comparison cannot disagree with itself.
#
# This is not hypothetical. On 2026-09-01 this script ran green against production
# and green against scratch, and only the scratch green meant anything: production
# had 64 value sets to scratch's 66, and the two missing ones were exactly the School
# tables carrying the other half of the `think_so` pair.
#
# So: a green is only as strong as the schema's completeness. After any migration
# that ADDS a value set, re-run it -- that run is the one where the green is earned.
# The failure mode this script exists to catch is the same one a careless green from
# it would create: success that looks identical to having examined nothing.
# ---------------------------------------------------------------------------
#
# Usage:  ./scripts/check-vocabulary-drift.sh "$DATABASE_URL"
#         ./scripts/check-vocabulary-drift.sh --self-test "$DATABASE_URL"

set -euo pipefail

SELF_TEST=0
if [ "${1:-}" = "--self-test" ]; then SELF_TEST=1; shift; fi
DB="${1:-}"
if [ -z "$DB" ]; then echo "usage: $0 [--self-test] <database-url>" >&2; exit 2; fi

# Every named value set in the schema: postgres enums, and single-column CHECK ... IN
# constraints. Both are "a closed vocabulary" even though Postgres models them differently
# -- and that modelling difference is exactly what let this defect hide.
read -r -d '' COLLECT <<'SQL' || true
with enums as (
  select t.typname as name, 'enum' as kind,
         array_agg(e.enumlabel::text order by e.enumlabel) as vals
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname not in ('pg_catalog','information_schema')
  group by t.typname
),
checks as (
  select c.relname || '.' || con.conname as name, 'check' as kind,
         (select array_agg(m[1] order by m[1])
            from regexp_matches(pg_get_constraintdef(con.oid), '''([^'']+)''::text', 'g') as m
         ) as vals
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where con.contype = 'c' and n.nspname = 'public'
    and pg_get_constraintdef(con.oid) like '%= ANY (ARRAY[%'
)
select name, kind, array_to_string(vals, ',') from (
  select * from enums union all select * from checks
) s
where array_length(vals,1) between 2 and 12
order by name;
SQL

if [ "$SELF_TEST" = "1" ]; then
  echo "SELF-TEST: creating two near-identical value sets so the check must go RED."
  psql "$DB" -q -c "
    drop table if exists public._vocab_selftest_a cascade;
    drop table if exists public._vocab_selftest_b cascade;
    create table public._vocab_selftest_a (v text check (v in ('alpha','beta_two','gamma')));
    create table public._vocab_selftest_b (v text check (v in ('alpha','betatwo','gamma')));" >/dev/null
fi

ROWS="$(psql "$DB" -tA -F'|' -c "$COLLECT")"

# Compare every pair. Same size, all-but-one value shared -- AND the two odd values must
# themselves be near-identical strings once separators are stripped.
#
# That last condition is what makes this usable rather than noisy. A first version without
# it flagged {deen,fitness} against {business,deen}: same size, sharing one value, differing
# by one. Both true, and meaningless -- at cardinality 2 that pattern is everywhere. Those
# are two genuinely different vocabularies that happen to overlap.
#
# The actual signature of accidental drift is that the SAME WORD is spelled two ways:
# `thinkso` vs `think_so`, `final_midterm` vs `midterm_final`. Normalising away underscores,
# hyphens and case turns the real case into an exact match and leaves deen-vs-business as
# the non-match it is.
FINDINGS="$(printf '%s\n' "$ROWS" | awk -F'|' '
  function norm(s) { gsub(/[_-]/,"",s); return tolower(s) }
  { name[NR]=$1; kind[NR]=$2; vals[NR]=$3; n=NR }
  END {
    for (i=1;i<=n;i++) for (j=i+1;j<=n;j++) {
      if (vals[i]==vals[j]) continue
      split(vals[i],A,","); split(vals[j],B,",")
      if (length(A)!=length(B)) continue
      # collect the values unique to each side
      oddA=""; for (a in A) { hit=0; for (b in B) if (A[a]==B[b]) hit=1; if (!hit) oddA=oddA A[a] "\n" }
      oddB=""; for (b in B) { hit=0; for (a in A) if (B[b]==A[a]) hit=1; if (!hit) oddB=oddB B[b] "\n" }
      na=split(oddA,OA,"\n"); nb=split(oddB,OB,"\n")
      if (na!=2 || nb!=2) continue          # exactly one odd value on each side
      if (norm(OA[1]) != norm(OB[1])) continue   # ...and they are the same word, respelled
      printf "  %s (%s)\n    %s   <-- %s\n  %s (%s)\n    %s   <-- %s\n\n", \
        name[i],kind[i],vals[i],OA[1], name[j],kind[j],vals[j],OB[1]
    }
  }')"

if [ "$SELF_TEST" = "1" ]; then
  psql "$DB" -q -c "drop table if exists public._vocab_selftest_a cascade;
                    drop table if exists public._vocab_selftest_b cascade;" >/dev/null
  if printf '%s' "$FINDINGS" | grep -q '_vocab_selftest'; then
    echo "SELF-TEST PASSED — the check detected the planted near-identical pair."
    echo "It is now safe to trust a green from this script."
    exit 0
  fi
  echo "SELF-TEST FAILED — the planted pair was NOT detected. Do not trust this script." >&2
  exit 1
fi

if [ -n "$FINDINGS" ]; then
  echo "VOCABULARY DRIFT — value sets that are near-identical but not identical:"
  echo
  printf '%s\n' "$FINDINGS"
  echo "Each pair is either an accidental divergence (fix it) or two genuinely"
  echo "different vocabularies that happen to look alike (leave it, and say so"
  echo "in a comment so the next run doesn't re-litigate it)."
  exit 1
fi

echo "OK — no near-identical value sets found."
