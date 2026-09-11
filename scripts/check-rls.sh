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
#   rls_no_policy  — RLS on with zero policies: unreachable to everyone but the
#                    service role. Not a security hole, but almost never intended,
#                    and it looks identical to "protected" if you only check the flag.
#
# EXEMPTIONS — TWO DISTINCT CATEGORIES, NEVER A BARE NAME LIST (D-032, revised 2026-09-11)
#
# "RLS on, zero policies" is CORRECT, not a gap, for two genuinely different
# reasons, and conflating them into one hand-maintained name list is exactly
# the mistake this revision fixes:
#
#   1. OWNERLESS BY DESIGN — the table has no `user_id` column AT ALL, so
#      there is nothing to scope an own-row policy to. Deny-all (RLS on, zero
#      policies) is the only correct posture: it fails closed for anon/
#      authenticated, and the service role bypasses RLS regardless.
#      `migration_ledger` (this program) and `mcp_oauth_clients` (added here,
#      2026-09-11 — DCR/client registration happens before any user session
#      exists at all, see lib/mcp/oauth.ts's own header) are BOTH this shape.
#      **This is a CONDITION, checked live against `information_schema.columns`
#      every run, never a name list.** A table qualifies by having no
#      `user_id` column today — not by being named on this list. Give either
#      table a `user_id` column tomorrow and it falls out of this category on
#      its own, automatically, the next time this script runs, because the
#      condition that justified the exemption stopped being true. This is the
#      generalization of what migration_ledger's exemption already did in
#      spirit (it verified its own no-user_id precondition rather than
#      trusting its name) — mcp_oauth_clients needed the same treatment
#      applied as a rule, not copied as a second special case with its own
#      hardcoded name, which is what let it go unnoticed as a genuine gap in
#      the meantime: it fit the REASONING migration_ledger's exemption was
#      built on, but not the reasoning's letter, because the letter only
#      ever mentioned migration_ledger by name.
#
#   2. AUDIT-ONLY, BY DECISION — the table DOES have a `user_id` (the rows
#      ARE user-owned) but a human decided, for a stated reason, that no
#      policy is needed because nothing but the service role ever reads it.
#      This CANNOT be verified from shape alone — a table with a user_id and
#      no policy is, by default, the real failure this script exists to
#      catch. So this category stays a small, explicit, named list, and
#      every entry says why:
#        - migration_115_orphaned_group_weight_log — records a user's
#          Personal Growth weight tier when 115's flatten found no live
#          children to attach it to, so a protect-two answer isn't silently
#          discarded. Audit-only. If this table ever becomes app-facing it
#          needs a real policy, and this line must come out.
#
# A bare name-based allowlist with no live condition behind it is the same
# "documented exclusion" that let 058's false 'exercises is a shared
# catalogue' footer hide nine real gaps: a reason nobody re-checks outlives
# the conditions that made it true. Category 1 above is the fix for exactly
# that failure mode, applied generally rather than patched per-incident.
#
# Usage:  ./scripts/check-rls.sh "<postgres-url>"
#         ./scripts/check-rls.sh --self-test "<postgres-url>"
#
# --self-test proves the check can FAIL before you trust it passing, in BOTH
# directions this revision cares about, not just "RLS disabled entirely":
#   1/3 an unprotected (rls_off) table is detected                  — unchanged
#   2/3 an OWNED (has user_id), unprotected-by-policy table FAILS   — the real
#       hole this script exists to catch, proven still caught after the new
#       ownerless exemption was added, so the exemption didn't overreach
#   3/3 an OWNERLESS (no user_id), unprotected-by-policy table is EXEMPT, not
#       a failure — proving the new category actually recognizes its shape,
#       not just its name
# A one-sided proof (only ever showing the exemption firing, never showing it
# correctly NOT firing for an owned table) would just move the blind spot
# check-enum-drift.sh's own two-self-test split was built to avoid.

set -uo pipefail
MODE="pass"
if [ "${1:-}" = "--self-test" ]; then MODE="selftest"; shift; fi
URL="${1:-}"
[ -n "$URL" ] || { echo "usage: check-rls.sh [--self-test] <postgres-url>" >&2; exit 2; }

query() { psql "$URL" -X -q -t -A -F'|' -c "$1" </dev/null 2>&1; }

# The ONE canonical categorization, used everywhere below rather than
# re-derived three slightly-different ways (which is exactly how the old
# migration_ledger-by-name special case and the exempt-listing query drifted
# apart from each other in spirit, if not yet in fact). A table with RLS on
# and zero policies is bucketed by a live shape check, not a name:
#   'ownerless'      — no user_id column today (category 1 above)
#   'audit_decision' — has user_id, but is on the small named list (category 2)
#   'fail'           — has user_id, not on the named list: the real gap
RLS_GAP_CTE="
  with rls_gap as (
    select t.tablename,
           exists (
             select 1 from information_schema.columns c
             where c.table_schema = 'public' and c.table_name = t.tablename
               and c.column_name = 'user_id'
           ) as has_user_id
    from pg_tables t
    where t.schemaname = 'public' and t.rowsecurity = true
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = t.tablename
      )
  )
  select tablename,
         case
           when not has_user_id then 'ownerless'
           when tablename in ('migration_115_orphaned_group_weight_log') then 'audit_decision'
           else 'fail'
         end as category
  from rls_gap
"

read_counts() {
  query "
    select
      (select count(*) from pg_tables where schemaname='public' and rowsecurity=false),
      (select count(*) from ($RLS_GAP_CTE) g where g.category = 'fail'),
      (select count(*) from pg_tables where schemaname='public');"
}

# category_of() -> the RLS_GAP_CTE category ('ownerless'|'audit_decision'|
# 'fail') for one named table, or empty if that table isn't currently in the
# gap set at all (RLS off, or RLS on with a real policy). Used only by the
# self-test below, against the SAME $RLS_GAP_CTE the real run uses — never a
# second, hand-copied version of the same SQL that could quietly drift from it.
category_of() {
  query "select category from ($RLS_GAP_CTE) g where g.tablename = '$1';"
}

if [ "$MODE" = "selftest" ]; then
  CLEANUP="drop table if exists public._rls_selftest_canary;
           drop table if exists public._rls_selftest_canary_owned;
           drop table if exists public._rls_selftest_canary_ownerless;"
  trap 'query "$CLEANUP" >/dev/null' EXIT

  echo "SELF-TEST 1/3: an RLS-disabled table must be detected (rls_off)."
  query "create table if not exists public._rls_selftest_canary (id int);
         alter table public._rls_selftest_canary disable row level security;" >/dev/null
  OUT="$(read_counts)"; OFF="${OUT%%|*}"
  query "drop table if exists public._rls_selftest_canary;" >/dev/null
  if [ "${OFF:-0}" -ge 1 ]; then
    echo "  PASSED — the check detected the unprotected table (rls_off=$OFF)."
  else
    echo "SELF-TEST FAILED (1/3) — an unprotected table was NOT detected. This check is decoration." >&2
    exit 1
  fi

  echo "SELF-TEST 2/3: an OWNED table (has user_id), RLS on, no policy — the real hole — must still FAIL."
  query "create table public._rls_selftest_canary_owned (id int, user_id uuid not null);
         alter table public._rls_selftest_canary_owned enable row level security;" >/dev/null
  CAT="$(category_of "_rls_selftest_canary_owned")"
  query "drop table if exists public._rls_selftest_canary_owned;" >/dev/null
  if [ "$CAT" = "fail" ]; then
    echo "  PASSED — the owned canary was categorized 'fail', not exempted. The ownerless exemption does not overreach."
  else
    echo "SELF-TEST FAILED (2/3) — an owned, unprotected table was categorized '$CAT', not 'fail'. The exemption overreaches." >&2
    exit 1
  fi

  echo "SELF-TEST 3/3: an OWNERLESS table (no user_id), RLS on, no policy — deny-all by construction — must be EXEMPT, not a failure."
  query "create table public._rls_selftest_canary_ownerless (id int);
         alter table public._rls_selftest_canary_ownerless enable row level security;" >/dev/null
  CAT2="$(category_of "_rls_selftest_canary_ownerless")"
  query "drop table if exists public._rls_selftest_canary_ownerless;" >/dev/null
  if [ "$CAT2" = "ownerless" ]; then
    echo "  PASSED — the ownerless canary was categorized 'ownerless', not 'fail'."
    echo "SELF-TEST PASSED (3/3) — all three canary tables dropped; nothing on the real schema was touched."
    exit 0
  fi
  echo "SELF-TEST FAILED (3/3) — an ownerless, unprotected table was categorized '$CAT2', not 'ownerless'. The exemption misses its own target shape." >&2
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

# Exempted tables are REPORTED, never silently skipped, in BOTH categories --
# an allowlist (or a live condition standing in for one) that hides its own
# entries is how a real finding gets muted. Printed every run so a reader can
# re-judge either category, not just the hand-maintained one.
query "select '  exempt (' ||
         case category when 'ownerless' then 'ownerless by design, no user_id column'
                        else 'audit-only, service-role reads only' end ||
         '): ' || tablename
       from ($RLS_GAP_CTE) g
       where g.category in ('ownerless', 'audit_decision')
       order by 1;"

FAIL=0
if [ "${OFF:-0}" -gt 0 ]; then
  FAIL=1; echo; echo "FAIL — tables with RLS DISABLED (readable/writable by any authenticated user):"
  query "select '  '||tablename from pg_tables where schemaname='public' and rowsecurity=false order by 1;"
fi
if [ "${NOPOL:-0}" -gt 0 ]; then
  FAIL=1; echo; echo "FAIL — RLS enabled but NO policy, and the table HAS a user_id (unreachable to every non-service role, and nothing exempts it):"
  query "select '  '||tablename from ($RLS_GAP_CTE) g where g.category = 'fail' order by 1;"
fi

[ "$FAIL" -eq 0 ] && { echo "OK — every public table has RLS enabled and at least one policy, except the exempt tables listed above."; exit 0; }
exit 1
