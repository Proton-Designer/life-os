#!/bin/bash
# apply-migration.sh — apply a migration AND record it, so "what is on this
# database" is never a matter of memory.
#
# WHY (D-046): production applies are gated on one person. That is correct, but
# nothing supplied a signal for "is the queue drained?", so a migration fixing a
# PROVEN cross-tenant exploit sat unapplied for hours and was found by accident.
# The ledger exists so check-migrations-applied.sh can answer that question.
#
# Records the file's md5 at apply time. That is what makes the ledger more than
# a checklist: it detects a migration EDITED AFTER APPLYING, where the file in
# git no longer describes the database it supposedly produced.
#
# Usage: ./scripts/apply-migration.sh <postgres-url> supabase/migrations/NNN_x.sql

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
DRY_RUN=0
NO_TX=0
while :; do
  case "${1:-}" in
    --dry-run)        DRY_RUN=1; shift ;;
    --no-transaction) NO_TX=1;   shift ;;
    *) break ;;
  esac
done
URL="${1:-}"; FILE="${2:-}"
[ -n "$URL" ] && [ -n "$FILE" ] || { echo "usage: apply-migration.sh [--dry-run] [--no-transaction] <url> <file>" >&2; exit 2; }
[ -f "$FILE" ] || { echo "no such file: $FILE" >&2; exit 2; }

NAME="$(basename "$FILE")"
MD5="$(md5 -q "$FILE" 2>/dev/null || md5sum "$FILE" | cut -d' ' -f1)"

PRIOR="$(psql "$URL" -X -q -t -A </dev/null -c \
  "select status||' md5='||md5 from public.migration_ledger where filename='$NAME';" 2>/dev/null)"
if [ -n "$PRIOR" ]; then
  echo "ALREADY RECORDED: $NAME ($PRIOR)"
  echo "$PRIOR" | grep -q "md5=$MD5" \
    && { echo "  file unchanged since apply; nothing to do."; exit 0; } \
    || { echo "  WARNING: file has CHANGED since it was applied." >&2
         echo "  The database was built by a different version of this file." >&2
         echo "  Write a new migration; do not re-run an edited one." >&2; exit 1; }
fi

# OBJECT MANIFEST, DERIVED FROM THE FILE TEXT (R31's standing gate).
#
# WHY: 111 was reported cold-verified as "creating questions" by two people who
# had genuinely watched it run. It never contained a `create table` at all — it
# REFERENCED public.questions in two FKs and two trigger bodies, and its own
# comment said "097 created questions_user_id_id_key", which read as context
# rather than as the contradiction it was. Their scratch had the table from a
# separate apply; the claim was about the database, and the defect was in the
# file. It failed at line 190 on the first database that had never had it —
# production.
#
# So: print what the FILE says it does, before running it. A claim that a
# migration creates something is checked against this manifest, never against
# where it happened to run. `grep -c 'create table'` is the minimum honest form
# of this check and it costs nothing.
echo "--- objects this file CREATES/ALTERS (parsed from the text, not the DB) ---"
grep -inE '^[[:space:]]*(create|alter|drop)[[:space:]]+(or[[:space:]]+replace[[:space:]]+)?(table|index|unique[[:space:]]+index|function|trigger|type|policy|view|constraint)' "$FILE" \
  | sed -E 's/[[:space:]]+/ /g; s/^/    /' | cut -c1-140
echo "--- tables merely REFERENCED but never created here (must already exist) ---"
grep -oiE 'references[[:space:]]+(public\.)?[a-z_]+' "$FILE" | awk '{print $2}' | sed 's/^public\.//' | sort -u | sed 's/^/    /'
echo "---------------------------------------------------------------------------"


# TRANSACTIONAL BY DEFAULT (R33).
#
# THE ROOT CAUSE OF TWO HALF-APPLIES TONIGHT: this script ran psql with
# ON_ERROR_STOP but WITHOUT --single-transaction, and 111 carried no
# begin/commit of its own. So every statement autocommitted and a failure
# midway left everything above it applied. Production ended up with a
# `questions` table and five new `reviews` columns but none of the
# constraints -- a state no file describes and no ledger records.
#
# ON_ERROR_STOP only stops the RUN. It never unwinds what already committed.
# Those are different guarantees and the gap between them is a half-migrated
# production database.
#
# Opting out requires BOTH the flag and a header line naming the statement
# that needs it, because a flag alone is a thing someone passes to make an
# error go away.
NON_TX_PATTERN='alter[[:space:]]+type[[:space:]]+[^;]*add[[:space:]]+value|create[[:space:]]+index[[:space:]]+concurrently|reindex[[:space:]]+concurrently|^[[:space:]]*vacuum'
HEADER_MARK='REQUIRES-NO-TRANSACTION:'

# STRIP COMMENTS BEFORE MATCHING. This pattern searches for SQL a transaction
# cannot run, and it used to search the raw file — so a migration whose header
# EXPLAINED why it chose a CHECK over an enum ("`alter type ... add value`
# cannot run in one at all") was refused for containing a statement it does not
# contain. Prose about a hazard is not the hazard.
#
# The same class as the `begin;`/`commit;` check below, which greps for
# statements at line start and so is already comment-safe. Line numbers are
# preserved by blanking comment text rather than deleting lines, so a real hit
# still reports the right line.
NON_TX_HITS="$(sed -e 's/--.*$//' "$FILE" | grep -inE "$NON_TX_PATTERN" | head -5 || true)"

# THE RUNNER OWNS THE TRANSACTION; FILES CARRY NONE (R33 addendum).
#
# Under --single-transaction a file's own `commit;` ENDS the runner's
# transaction early. Everything after it then runs unprotected while every
# reader believes the whole file is covered -- and the failure only shows up
# the day someone appends a statement below that line. Caught by the ULM lead
# before either change landed.
#
# The pattern requires the semicolon immediately after the keyword, which is
# what distinguishes top-level transaction control from a plpgsql body's
# `begin` (no semicolon) and its `end;` (a different word).
# HISTORICAL EXEMPTION: migrations 054, 055, 085, 108 and 110 carry bare
# begin;/commit; from the old runner, which did NOT wrap files itself. They are
# correct history and must never be rewritten -- a replay would otherwise read
# five pieces of correct history as five bugs, and someone would "fix" them.
# The rule binds files numbered ABOVE 110, which is where the runner took
# ownership of the transaction.
MIG_NUM="$(basename "$FILE" | grep -oE '^[0-9]+' || echo "")"
TX_CTRL_EXEMPT=0
if [ -n "$MIG_NUM" ] && [ "$((10#$MIG_NUM))" -le 110 ]; then TX_CTRL_EXEMPT=1; fi

TX_CTRL_HITS="$(grep -inE '^[[:space:]]*(begin|commit|rollback)[[:space:]]*;' "$FILE" | head -5 || true)"
if [ "$TX_CTRL_EXEMPT" = "1" ] && [ -n "$TX_CTRL_HITS" ]; then
  echo "note: $MIG_NUM is pre-111 history and may carry its own begin/commit; not refused."
  TX_CTRL_HITS=""
fi
if [ -n "$TX_CTRL_HITS" ]; then
  echo "REFUSING: this file contains its own transaction control:" >&2
  printf '%s\n' "$TX_CTRL_HITS" | sed 's/^/    /' >&2
  echo "  The RUNNER owns the transaction (--single-transaction is the default)." >&2
  echo "  A file's own commit; ends the runner's transaction early, so anything" >&2
  echo "  appended below it later runs UNPROTECTED while looking covered." >&2
  echo "  Remove the begin;/commit; and let the runner wrap the file." >&2
  exit 7
fi


if [ "$NO_TX" = "0" ] && [ -n "$NON_TX_HITS" ]; then
  echo "REFUSING: this file contains statements Postgres cannot run inside a transaction," >&2
  echo "and a transactional apply would fail on them:" >&2
  printf '%s\n' "$NON_TX_HITS" | sed 's/^/    /' >&2
  echo "  Re-run with --no-transaction AND add a header line:" >&2
  echo "    -- $HEADER_MARK <which statement and why>" >&2
  echo "  Note: an enum value added and USED in the same transaction fails even on PG17." >&2
  exit 5
fi

if [ "$NO_TX" = "1" ] && ! grep -q "$HEADER_MARK" "$FILE"; then
  echo "REFUSING: --no-transaction passed, but the file does not say why." >&2
  echo "  Add a header line naming the non-transactable statement:" >&2
  echo "    -- $HEADER_MARK <which statement and why>" >&2
  echo "  Without a transaction a mid-file failure leaves production half-applied," >&2
  echo "  which is how 111 happened. The flag alone is not a reason." >&2
  exit 6
fi

# Dry run exits HERE -- AFTER the refusal checks, not before.
# It sat above them first, so --dry-run silently bypassed every guard and
# reported success on a file the real apply would have refused. A preview
# that does not preview the refusals is worse than no preview: it answers
# "would this be allowed?" with a confident yes.

if [ "$DRY_RUN" = "1" ]; then
  # R32.2: a manifest must be obtainable WITHOUT touching the database. I produced
  # one by re-running a real migration against production to demonstrate the gate,
  # which created a table and advanced production's state -- a demonstration on a
  # real file against production IS an apply. This exit is what makes that
  # impossible to repeat by accident.
  echo "(dry run: nothing was applied)"
  exit 0
fi

LOG="$(mktemp)"
if [ "$NO_TX" = "1" ]; then
  echo "applying WITHOUT a transaction (file declares $HEADER_MARK) -- a failure will leave partial state."
  psql "$URL" -X -q -v ON_ERROR_STOP=1 -f "$FILE" </dev/null > "$LOG" 2>&1
else
  psql "$URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$FILE" </dev/null > "$LOG" 2>&1
fi
RC=$?
# psql errors read "psql:file:line: ERROR:", so a '^ERROR' anchor never matches —
# that exact bug once reported "0 errors" from a check that examined nothing.
if [ $RC -ne 0 ] || grep -qEi '(^|: )ERROR:' "$LOG"; then
  echo "FAILED — not recorded:" >&2; cat "$LOG" >&2; rm -f "$LOG"; exit 1
fi
rm -f "$LOG"

psql "$URL" -X -q </dev/null -c \
  "insert into public.migration_ledger (filename, md5, status, note)
   values ('$NAME','$MD5','applied','via apply-migration.sh')
   on conflict (filename) do nothing;" >/dev/null
echo "APPLIED and recorded: $NAME"

# R32.4: regenerate the generated types as a POST-STEP of a successful production
# apply, so the file can never describe a database that no longer exists.
#
# WHY THIS IS AUTOMATIC AND NOT A REMINDER: database.types.ts was regenerated
# against a scratch missing 105/106, so it carried none of their columns -- and
# two engineers hand-declared the shapes to work around it, which is drift
# becoming code. It also silently lacked 109's advance_ingestion_cursor. Nobody
# was careless; regeneration was simply a step someone had to remember, and the
# generated file gives no sign of being stale.
#
# Only for the production URL: types must come from production, or a scratch
# PROVEN identical by the R24 diff -- never from whatever database happened to
# be at hand.
if printf '%s' "$URL" | grep -q 'pooler.supabase.com'; then
  echo "regenerating lib/supabase/database.types.ts from the database just applied to..."
  if npx supabase gen types typescript --db-url "$URL" > /tmp/_regen_types.ts 2>/dev/null && [ -s /tmp/_regen_types.ts ]; then
    cp /tmp/_regen_types.ts lib/supabase/database.types.ts
    echo "  types regenerated -- COMMIT THIS DIFF WITH THE MIGRATION."
  else
    echo "  WARNING: type regeneration failed. The generated file now describes an OLDER schema" >&2
    echo "  than the database. Regenerate manually before trusting it." >&2
  fi
fi
