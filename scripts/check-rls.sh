#!/bin/bash
# check-rls.sh — assert every public table has RLS enabled AND at least one policy.
#
# WHY THIS EXISTS (D-032, 2026-09-01)
#
# Live has an `ensure_rls` event trigger that auto-enables RLS on every newly
# created table. It is a real safety net and it is the reason all 48 tables are
# currently protected. But creating an event trigger requires superuser, and
# Supabase's `postgres` role deliberately is not one — so `ensure_rls` CANNOT
# install in any restricted rebuild: a scratch container, CI, a future staging
# project.
#
# That inverts the usual assumption. Normally staging is the safe place to be
# wrong. Here, a forgotten policy is silently corrected on live and REAL
# everywhere else — so the environments we test in are permanently more
# dangerous than production, in the one dimension where a mistake is
# unrecoverable. This script is what stands in for the trigger where the
# trigger cannot exist.
#
# Two distinct failures, both checked, because they are not the same thing:
#   rls_off        — wide open. Any authenticated user reads/writes it via PostgREST.
#
# ONE DOCUMENTED EXCEPTION: public.migration_ledger (migration 102) is
# operational metadata — which migrations are on this database — with no
# user_id and no user-facing reader. RLS on with zero policies is the CORRECT
# posture for it: it fails closed for anon/authenticated, and the service role
# bypasses RLS.
#
# The exception VERIFIES ITS OWN JUSTIFICATION rather than trusting the name:
# it applies only while that table genuinely has no user_id column. Add user_id
# to it and the exemption evaporates and this check fails again — which is the
# point. A bare name-based allowlist is the same "documented exclusion" that let
# 058's false 'exercises is a shared catalogue' footer hide nine real gaps: a
# reason nobody re-checks outlives the conditions that made it true.
#   rls_no_policy  — RLS on with zero policies: unreadable to everyone but the
#                    service role. Not a security hole, but almost never intended,
#                    and it looks identical to "protected" if you only check the flag.
#
# Usage:  ./scripts/check-rls.sh "<postgres-url>"
#         ./scripts/check-rls.sh --self-test "<postgres-url>"
#
# --self-test proves the check can FAIL before you trust it passing. An unfired
# check and a passing check are indistinguishable (D-030).

set -uo pipefail
MODE="pass"
if [ "${1:-}" = "--self-test" ]; then MODE="selftest"; shift; fi
URL="${1:-}"
[ -n "$URL" ] || { echo "usage: check-rls.sh [--self-test] <postgres-url>" >&2; exit 2; }

query() { psql "$URL" -X -q -t -A -F'|' -c "$1" </dev/null 2>&1; }

read_counts() {
  query "
    select
      (select count(*) from pg_tables where schemaname='public' and rowsecurity=false),
      (select count(*) from pg_tables t where t.schemaname='public' and t.rowsecurity=true
         and not exists (select 1 from pg_policies p
                         where p.schemaname='public' and p.tablename=t.tablename)
         and not (t.tablename = 'migration_ledger'
              and not exists (select 1 from information_schema.columns c
                               where c.table_schema='public' and c.table_name=t.tablename
                                 and c.column_name='user_id'))
         and t.tablename <> 'migration_115_orphaned_group_weight_log'),
      (select count(*) from pg_tables where schemaname='public');"
}

if [ "$MODE" = "selftest" ]; then
  echo "SELF-TEST: creating a deliberately unprotected table so the check must go RED."
  query "create table if not exists public._rls_selftest_canary (id int);
         alter table public._rls_selftest_canary disable row level security;" >/dev/null
  OUT="$(read_counts)"; OFF="${OUT%%|*}"
  query "drop table if exists public._rls_selftest_canary;" >/dev/null
  if [ "${OFF:-0}" -ge 1 ]; then
    echo "SELF-TEST PASSED — the check detected the unprotected table (rls_off=$OFF)."
    echo "It is now safe to trust a green from this script."
    exit 0
  fi
  echo "SELF-TEST FAILED — an unprotected table was NOT detected. This check is decoration." >&2
  exit 1
fi

OUT="$(read_counts)"
case "$OUT" in *ERROR*|"") echo "could not query: $OUT" >&2; exit 2;; esac

# ── R70: REFUSE TO INTERPRET A NON-RESULT ────────────────────────────────────
# This script reported GREEN against a reachable database with a wrong
# password. psql failed, its error text landed in the variables the checks
# read, bash complained on stderr that it had been given a string where it
# wanted an integer -- and the script exited 0 anyway.
#
# Found by the ULM lead auditing every instrument in both trees. It matters
# more here than almost anywhere: this is one of the two checks that answers
# "is user data isolated", and it was structurally incapable of saying no.
#
# A check must distinguish MEASURED ZERO from COULD NOT MEASURE. A shell
# default that silently turns the second into the first is a bug in the check,
# not in the shell.
require_integer() { # <value> <what>
  case "$1" in
    ''|*[!0-9]*)
      echo "CANNOT MEASURE — expected an integer for $2, got:" >&2
      printf '%s\n' "$1" | head -3 >&2
      exit 1
      ;;
  esac
}

require_integer "$(echo "$OUT" | cut -d'|' -f1)" "rls_off"
require_integer "$(echo "$OUT" | cut -d'|' -f2)" "rls_on_but_no_policy"
require_integer "$(echo "$OUT" | cut -d'|' -f3)" "total public tables"

OFF="$(echo "$OUT" | cut -d'|' -f1)"
NOPOL="$(echo "$OUT" | cut -d'|' -f2)"
TOTAL="$(echo "$OUT" | cut -d'|' -f3)"

echo "public tables: $TOTAL   rls_off: $OFF   rls_on_but_no_policy: $NOPOL"

# Exempted tables are REPORTED, never silently skipped. An allowlist that
# hides its own entries is how a real finding gets muted by a stale
# exemption -- the entry has to stay visible so a reader can re-judge it.
#
#   migration_ledger  — no user_id; the runner writes it as table owner.
#   migration_115_orphaned_group_weight_log — audit-only. Records a user's
#     Personal Growth weight tier when 115's flatten found no live children
#     to attach it to, so a protect-two answer is not silently discarded.
#     It HAS a user_id, so unlike migration_ledger it is not exempt by
#     shape; it is exempt by decision, and that is why it is named here.
#     If this table ever becomes app-facing it needs a real policy, and
#     this line must come out.
query "select '  exempt (audit-only, service-role reads only): '||t.tablename
       from pg_tables t where t.schemaname='public' and t.rowsecurity=true
         and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=t.tablename)
         and t.tablename in ('migration_ledger','migration_115_orphaned_group_weight_log')
       order by 1;"

FAIL=0
if [ "${OFF:-0}" -gt 0 ]; then
  FAIL=1; echo; echo "FAIL — tables with RLS DISABLED (readable/writable by any authenticated user):"
  query "select '  '||tablename from pg_tables where schemaname='public' and rowsecurity=false order by 1;"
fi
if [ "${NOPOL:-0}" -gt 0 ]; then
  FAIL=1; echo; echo "FAIL — RLS enabled but NO policy (unreachable to every non-service role):"
  query "select '  '||t.tablename from pg_tables t where t.schemaname='public' and t.rowsecurity=true
           and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=t.tablename)
           and not (t.tablename = 'migration_ledger'
              and not exists (select 1 from information_schema.columns c
                               where c.table_schema='public' and c.table_name=t.tablename
                                 and c.column_name='user_id'))
         and t.tablename <> 'migration_115_orphaned_group_weight_log'
         order by 1;"
fi

[ "$FAIL" -eq 0 ] && { echo "OK — every public table has RLS enabled and at least one policy, except the audit-only tables listed above."; exit 0; }
exit 1
