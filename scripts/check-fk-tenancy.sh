#!/bin/bash
# check-fk-tenancy.sh — fail if any single-column foreign key points at a
# user-scoped parent table.
#
# WHY THIS EXISTS (2026-09-01)
#
# Foreign-key checks run as the table owner and BYPASS RLS. So `child.parent_id
# -> parent(id)` lets user A create a row owned by A that references B's parent:
# the FK is satisfied (the parent exists) and the RLS `with check` is satisfied
# (the user_id is A's). Nothing rejects it.
#
# When the child also carries a uniqueness constraint that includes the FK
# column but NOT user_id, that becomes a cross-tenant DENIAL OF SERVICE: A
# occupies the slot, and B can never write their own row. B cannot diagnose it
# — under RLS they see zero rows, their delete affects zero rows, and their
# insert keeps failing with a constraint error naming a row that, to them, does
# not exist. Proven by exploit three times across this schema (058, 086, 100).
#
# THE REASON THIS IS A SCRIPT AND NOT A CHECKLIST:
#
# 058 fixed ten pairs and documented its exclusions in a section explicitly
# headed "so the omissions read as decisions rather than misses". One of those
# documented reasons was FALSE — it called `exercises` and `workouts` shared
# catalogues when both are `user_id NOT NULL` — and it hid nine real gaps for a
# day. A gap nobody looked at gets caught by the next sweep. **A gap with a
# confident wrong reason written beside it does not.**
#
# So the rule enforced here is flat and admits no per-pair judgement: no
# single-column FK to a user-scoped parent, ever. Use a composite FK,
# `(user_id, parent_id) -> parent(user_id, id)`, which makes a cross-tenant row
# unrepresentable rather than merely unlikely.
#
# Usage:  ./scripts/check-fk-tenancy.sh "<postgres-url>"
#         ./scripts/check-fk-tenancy.sh --self-test "<postgres-url>"

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="check"
if [ "${1:-}" = "--self-test" ]; then MODE="selftest"; shift; fi
URL="${1:-}"
[ -n "$URL" ] || { echo "usage: check-fk-tenancy.sh [--self-test] <postgres-url>" >&2; exit 2; }

# Tables owned by the ULM and CollegeOS tracks. These are OUTSTANDING, not
# approved: each is a known-open pair in someone else's schema, reported every
# run so the list is visibly shrinking rather than quietly permanent. Delete
# entries as those teams convert them. Do NOT add a LifeOS table here — that
# would recreate the per-pair judgement this script exists to replace.
NOT_MINE="book_sections|cards|card_states|lessons|reviews|self_explanations|source_chunks|sources|ingestion_jobs"

QUERY="
select c.conrelid::regclass::text||'.'||a.attname||' -> '||c.confrelid::regclass::text
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
 where c.contype = 'f'
   and c.connamespace = 'public'::regnamespace
   and array_length(c.conkey, 1) = 1
   and c.confrelid::regclass::text <> 'users'
   and exists (select 1 from pg_attribute p
                where p.attrelid = c.confrelid and p.attname = 'user_id' and not p.attisdropped)
 order by 1;"

if [ "$MODE" = "selftest" ]; then
  echo "SELF-TEST: injecting a real single-column FK to a user-scoped parent (rolled back)."
  OUT="$(psql "$URL" -X -q -t -A -f scripts/_fk-tenancy-selftest.sql </dev/null 2>&1)"
  if echo "$OUT" | grep -q '_fk_tenancy_canary.habit_id'; then
    echo "SELF-TEST PASSED — detector saw the injected violation. Transaction rolled back."
    exit 0
  fi
  echo "SELF-TEST FAILED — injected violation NOT detected. This check cannot see the bug class." >&2
  echo "$OUT" >&2
  exit 1
fi

# ── R70: REFUSE TO INTERPRET A NON-RESULT ────────────────────────────────────
# This script reported "OK — zero single-column FKs to user-scoped parents"
# against a reachable database with a WRONG PASSWORD. psql wrote its error to
# stderr, the query produced no rows, and zero rows is indistinguishable from
# a clean result.
#
# It is one of the two instruments that answers "is user data isolated", and it
# was structurally incapable of saying no. Found by the ULM lead auditing every
# check in both trees against an unauthenticatable URL.
#
# The fix is not to parse the error text — it is to require POSITIVE evidence
# that the query ran: this database must have public tables, and a connection
# that cannot count them has not measured anything.
PROBE="$(psql "$URL" -X -q -t -A </dev/null -c "select count(*) from pg_tables where schemaname='public';" 2>&1)"
case "$PROBE" in
  ''|*[!0-9]*)
    echo "CANNOT MEASURE — the connection did not return a table count:" >&2
    printf '%s\n' "$PROBE" | head -3 >&2
    exit 1
    ;;
esac
if [ "$PROBE" -eq 0 ]; then
  echo "CANNOT MEASURE — this database has no public tables; a zero-FK result would be vacuous." >&2
  exit 1
fi

ALL="$(psql "$URL" -X -q -t -A </dev/null -c "$QUERY" | grep -v '^$')"
MINE="$(echo "$ALL" | grep -Ev "^($NOT_MINE)\." | grep -v '^$')"
THEIRS="$(echo "$ALL" | grep -E "^($NOT_MINE)\." | grep -v '^$')"

echo "FK tenancy check — single-column FKs to user-scoped parents"
if [ -n "$THEIRS" ]; then
  echo "  outstanding in other tracks (reported, not enforced here):"
  echo "$THEIRS" | sed 's/^/    · /'
fi
if [ -n "$MINE" ]; then
  echo "  FAIL — LifeOS tables with a single-column FK to a user-scoped parent:"
  echo "$MINE" | sed 's/^/    + /'
  echo "    -> convert to (user_id, parent_id) -> parent(user_id, id). See 100/101."
  exit 1
fi
echo "  OK — zero single-column FKs to user-scoped parents on LifeOS tables."
exit 0
