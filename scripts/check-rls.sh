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
                         where p.schemaname='public' and p.tablename=t.tablename)),
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
OFF="$(echo "$OUT" | cut -d'|' -f1)"
NOPOL="$(echo "$OUT" | cut -d'|' -f2)"
TOTAL="$(echo "$OUT" | cut -d'|' -f3)"

echo "public tables: $TOTAL   rls_off: $OFF   rls_on_but_no_policy: $NOPOL"

FAIL=0
if [ "${OFF:-0}" -gt 0 ]; then
  FAIL=1; echo; echo "FAIL — tables with RLS DISABLED (readable/writable by any authenticated user):"
  query "select '  '||tablename from pg_tables where schemaname='public' and rowsecurity=false order by 1;"
fi
if [ "${NOPOL:-0}" -gt 0 ]; then
  FAIL=1; echo; echo "FAIL — RLS enabled but NO policy (unreachable to every non-service role):"
  query "select '  '||t.tablename from pg_tables t where t.schemaname='public' and t.rowsecurity=true
           and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=t.tablename)
         order by 1;"
fi

[ "$FAIL" -eq 0 ] && { echo "OK — every public table has RLS enabled and at least one policy."; exit 0; }
exit 1
