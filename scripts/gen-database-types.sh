#!/usr/bin/env bash
# scripts/gen-database-types.sh -- regenerate lib/supabase/database.types.ts
# against a live database URL, WITHOUT Docker or Podman.
#
# WHY THIS EXISTS: `supabase gen types typescript --db-url ...` (what
# apply-migration.sh used to shell out to) always tries to launch
# `supabase/postgres-meta` inside a local Docker container, even in --db-url
# mode -- the CLI's own binary embeds no type-generation logic at all; it is
# a thin client for a service that runs in Docker. On a machine with no
# Docker/Podman and no root to install one (this project's whole dev sandbox,
# see .brain/memory/known-issues.md), that command fails outright, and did so
# silently across migrations 150, 151, 152 and 156 -- four real production
# migrations that landed with a stale database.types.ts and no visible error
# in the apply log beyond one easily-missed warning line.
#
# THE FIX: `@supabase/postgres-meta` is an ordinary npm package (MIT, plain
# Node/Fastify, no native Docker dependency of its own) -- it is the EXACT
# code that runs inside the Docker container the CLI launches. Its compiled
# `dist/server/server.js` already supports a documented env-var-driven
# "generate once and exit" mode (`PG_META_GENERATE_TYPES=typescript`), used
# by the package's own `gen:types:typescript` dev script. Installing it with
# plain `npm install` and running that entry point directly reproduces
# byte-for-byte what the CLI's Docker path would produce, because it IS
# that path's implementation -- confirmed by extracting the pinned image tag
# from the CLI binary itself:
#
#   strings <path-to-supabase-cli-binary> | grep 'FROM supabase/postgres-meta'
#   -> FROM supabase/postgres-meta:v0.99.0 AS pgmeta
#
# which is the exact version this script installs below. If a future CLI
# upgrade moves that pin, re-run the `strings` command above against the
# then-current `npx supabase` binary (find it under
# ~/.npm/_npx/*/node_modules/@supabase/cli-*/bin/supabase) and bump
# PGMETA_VERSION to match -- do not assume "latest" tracks the CLI's pin.
#
# SCHEMA SET: the CLI's default (no --schema flag, which is how
# apply-migration.sh has always called it) has always produced exactly
# `public` + `graphql_public` in this project's committed file -- confirmed
# by inspecting lib/supabase/database.types.ts before this change. This
# script reproduces that default explicitly rather than relying on the
# generator's own default, which is `public` only (`graphql_public` would
# silently disappear from the file without this).
#
# Usage:
#   scripts/gen-database-types.sh <db-url> [output-path]
#
# <db-url>      A full postgres:// connection string (e.g. the pooler URL
#               apply-migration.sh already resolves). REQUIRED.
# [output-path] Defaults to lib/supabase/database.types.ts.
#
# Exit non-zero on ANY failure -- including a truncated/short write -- so a
# caller (apply-migration.sh) can tell "regeneration genuinely failed" apart
# from "wrote a broken file and moved on".

set -euo pipefail

DB_URL="${1:?usage: gen-database-types.sh <db-url> [output-path]}"
OUT_PATH="${2:-lib/supabase/database.types.ts}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PGMETA_VERSION="0.99.0"
PGMETA_DIR="$REPO_ROOT/.local/pgmeta-gen"
PGMETA_SERVER="$PGMETA_DIR/node_modules/@supabase/postgres-meta/dist/server/server.js"

if [ ! -f "$PGMETA_SERVER" ]; then
  echo "gen-database-types: installing @supabase/postgres-meta@$PGMETA_VERSION into $PGMETA_DIR (one-time, ~190 packages)..." >&2
  mkdir -p "$PGMETA_DIR"
  (
    cd "$PGMETA_DIR"
    [ -f package.json ] || npm init -y >/dev/null 2>&1
    npm install --no-audit --no-fund "@supabase/postgres-meta@$PGMETA_VERSION"
  )
fi

if [ ! -f "$PGMETA_SERVER" ]; then
  echo "gen-database-types: install did not produce $PGMETA_SERVER -- aborting, NOT touching $OUT_PATH" >&2
  exit 1
fi

TMP_OUT="$(mktemp)"
TMP_ERR="$(mktemp)"
trap 'rm -f "$TMP_OUT" "$TMP_ERR"' EXIT

set +e
PG_META_GENERATE_TYPES=typescript \
PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS="public,graphql_public" \
PG_META_DB_URL="$DB_URL" \
  node "$PGMETA_SERVER" > "$TMP_OUT" 2> "$TMP_ERR"
RC=$?
set -e

if [ $RC -ne 0 ]; then
  echo "gen-database-types: generator exited $RC -- NOT touching $OUT_PATH. stderr:" >&2
  cat "$TMP_ERR" >&2
  exit 1
fi

# Sanity-parse: a truncated or empty write must never be mistaken for
# success. This is deliberately cheap (no TS parser dependency) but checks
# both ends of the file, since a silent-truncation failure (a known risk for
# large writes into this repo -- see .brain/memory/known-issues.md) would
# most likely cut the tail off.
SIZE="$(wc -c < "$TMP_OUT" | tr -d ' ')"
if [ "$SIZE" -lt 20000 ]; then
  echo "gen-database-types: output suspiciously small ($SIZE bytes) -- NOT touching $OUT_PATH" >&2
  exit 1
fi
if ! head -c 200 "$TMP_OUT" | grep -q "export type Json"; then
  echo "gen-database-types: output does not start with the expected 'export type Json' header -- NOT touching $OUT_PATH" >&2
  exit 1
fi
if ! tail -c 400 "$TMP_OUT" | grep -q "as const"; then
  echo "gen-database-types: output does not end with the expected 'as const' Constants block -- NOT touching $OUT_PATH" >&2
  exit 1
fi

cp "$TMP_OUT" "$OUT_PATH"

# Verify the copy landed byte-for-byte -- catches exactly the silent-write-
# truncation failure mode this project has hit before with large files.
SRC_SUM="$(md5sum "$TMP_OUT" | awk '{print $1}')"
DST_SUM="$(md5sum "$OUT_PATH" | awk '{print $1}')"
if [ "$SRC_SUM" != "$DST_SUM" ]; then
  echo "gen-database-types: copy to $OUT_PATH did not match generated output (checksum mismatch) -- treat $OUT_PATH as CORRUPT, do not commit it" >&2
  exit 1
fi

echo "gen-database-types: wrote $OUT_PATH ($SIZE bytes, checksum $DST_SUM verified)"
