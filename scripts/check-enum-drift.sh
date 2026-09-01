#!/bin/bash
# check-enum-drift.sh — assert the database's CHECK-constrained value sets match
# the TypeScript unions and exhaustive Records that claim to mirror them.
#
# WHY THIS EXISTS (D-036, 2026-09-01)
#
# `work_sessions.kind` is `text` + CHECK, not a Postgres enum. Supabase's type
# generator emits `string` for a text column, so `WorkSessionKind` is
# hand-written — and `KIND_LABEL` is an exhaustive `Record` over it.
#
# NOTHING STRUCTURALLY CONNECTS THE TWO. Someone widens the CHECK in SQL to add
# a kind, gets a completely green typecheck, and ships `undefined` into a label
# the first time that kind reaches the UI. The read site casts
# (`data.kind as WorkSessionKind`), which erases exactly the mismatch that would
# otherwise surface.
#
# This is the same shape as check-rls.sh: an invariant nothing enforces, made
# loud by a cheap assertion. It is NOT a unit test — it needs a real database,
# and the unit suite must stay pure and offline.
#
# Precedent worth knowing (ULM): they hand-wrote an `EvidenceStrength` union
# that drifted against its DB enum — the type still said `strong_research_base`
# where the database said `strong_research`, and every consuming page carried a
# manual remap to paper over it. Their fix was to derive the type from the
# generated `Database["public"]["Enums"][...]` instead of hand-writing it. That
# only works for real PG enums; for text+CHECK columns, this script is the
# substitute.
#
# Usage:  ./scripts/check-enum-drift.sh "<postgres-url>"
#         ./scripts/check-enum-drift.sh --self-test "<postgres-url>"

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="pass"
if [ "${1:-}" = "--self-test" ]; then MODE="selftest"; shift; fi
URL="${1:-}"
[ -n "$URL" ] || { echo "usage: check-enum-drift.sh [--self-test] <postgres-url>" >&2; exit 2; }

# table.column -> the TS file whose union must cover it
PAIRS="work_sessions.kind:lib/business/work-session-kind.ts"

db_values() { # <table> <column> -> newline-separated allowed values
  psql "$URL" -X -q -t -A </dev/null -c "
    select regexp_replace(m[1], '''', '', 'g')
    from pg_constraint c
    cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
    where c.conrelid = 'public.$1'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%$2%'
      and pg_get_constraintdef(c.oid) like '%ANY%'
    ;" 2>/dev/null | sort -u | grep -v '^$'
}

ts_values() { # <file> -> values named in the union / Record keys
  grep -oE '"[a-z_]+"' "$1" 2>/dev/null | tr -d '"' | sort -u | grep -v '^$'
}

check_pair() { # <table.column>:<file>  -> 0 ok, 1 drift
  local spec="$1" tc file table col
  tc="${spec%%:*}"; file="${spec##*:}"
  table="${tc%%.*}"; col="${tc##*.}"
  local db ts missing extra
  db="$(db_values "$table" "$col")"
  ts="$(ts_values "$file")"
  if [ -z "$db" ]; then echo "  ? $tc — no CHECK found (column may have become an enum); review manually"; return 1; fi
  missing="$(comm -23 <(echo "$db") <(echo "$ts"))"
  extra="$(comm -13 <(echo "$db") <(echo "$ts"))"
  if [ -n "$missing" ]; then
    echo "  FAIL $tc — the DATABASE allows values the TypeScript does not name:"
    echo "$missing" | sed 's/^/    + /'
    echo "    -> $file must widen. A row with this kind renders undefined through any exhaustive Record."
    return 1
  fi
  if [ -n "$extra" ]; then
    echo "  warn $tc — TypeScript names values the database rejects: $(echo "$extra" | tr '\n' ' ')"
    echo "    (not a runtime bug; usually a leftover from a narrowed CHECK)"
  fi
  echo "  ok   $tc — $(echo "$db" | tr '\n' ' ')"
  return 0
}

if [ "$MODE" = "selftest" ]; then
  echo "SELF-TEST: widening work_sessions.kind in a rolled-back transaction so the check MUST go red."
  OUT="$(psql "$URL" -X -q -t -A </dev/null <<'SQL' 2>&1
begin;
alter table public.work_sessions drop constraint work_sessions_kind_check;
alter table public.work_sessions add constraint work_sessions_kind_check
  check (kind in ('deep_work','deep_study','canary_kind'));
select regexp_replace(m[1], '''', '', 'g')
from pg_constraint c
cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
where c.conrelid='public.work_sessions'::regclass and c.contype='c'
  and pg_get_constraintdef(c.oid) like '%kind%' and pg_get_constraintdef(c.oid) like '%ANY%';
rollback;
SQL
)"
  if echo "$OUT" | grep -q canary_kind; then
    echo "SELF-TEST PASSED — the reader saw the injected value ('canary_kind'), so drift is detectable."
    echo "Transaction rolled back; the real constraint is untouched."
    exit 0
  fi
  echo "SELF-TEST FAILED — the injected value was not observed. This check cannot see drift." >&2
  echo "$OUT" >&2
  exit 1
fi

echo "enum/union drift check"
FAIL=0
for spec in $PAIRS; do check_pair "$spec" || FAIL=1; done
[ "$FAIL" -eq 0 ] && { echo "OK — every CHECK-constrained value set is named in TypeScript."; exit 0; }
exit 1
