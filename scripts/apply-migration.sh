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
if [ "${1:-}" = "--dry-run" ]; then DRY_RUN=1; shift; fi
URL="${1:-}"; FILE="${2:-}"
[ -n "$URL" ] && [ -n "$FILE" ] || { echo "usage: apply-migration.sh [--dry-run] <url> <file>" >&2; exit 2; }
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
psql "$URL" -X -q -v ON_ERROR_STOP=1 -f "$FILE" </dev/null > "$LOG" 2>&1
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
