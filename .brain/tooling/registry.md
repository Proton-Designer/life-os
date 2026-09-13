---
id: tool.registry
title: Tool Registry
layer: L2
type: tooling
status: canonical
owner: unassigned
updated: 2026-09-13
answers:
  - "how do I build this"
  - "how do I run the tests"
  - "what commands exist"
covers: "Everyday, slow, and destructive commands; environment setup; Agent-Brain's own commands"
excludes: "External services and CI configuration (see tool.integrations), token-optimization tooling (see tool.optimization-registry)"
tokens_est: 2150
---

# Tool Registry

**Package manager:** npm (`package-lock.json`) · **Runtime:** Node.js, Next.js 16
(App Router, `proxy.ts` not `middleware.ts`) · **CI:** none — no `.github/` in
this repo.

---

## Everyday

| Command | Does | Notes |
|---|---|---|
| `npm install` | install deps | |
| `npm run dev` | run locally | `next dev`; needs `.env.local` (not committed) |
| `npm test` | run the Vitest suite | `vitest run`; scope with a path argument, see `gov.tool-output-policy` |
| `npm run test:watch` | Vitest in watch mode | `vitest` |
| `npm run lint` | ESLint | `eslint` |
| `npm run build` | production build | `next build` |
| `npm start` | serve the production build | `next start` |

## Slow / heavy

| Command | Does | Cost | Prerequisite |
|---|---|---|---|
| `npm run test:e2e` | Playwright suite | multi-minute; serialized by convention | `scripts/loop-e2e-walk.sh` exists because concurrent runs corrupted shared fixtures before — session-"Lead"-only |
| `npm run build` | production build | ~minutes | — |

## Destructive — confirm before running

| Command | Does | Blast radius |
|---|---|---|
| `scripts/apply-migration.sh` | applies a numbered Postgres migration | schema-wide; numbers hand-allocated in `supabase/migrations/ALLOCATIONS.md`, do not self-number |
| `scripts/deploy-prod.sh` | deploys to production (Vercel) | production; Lead-role-only convention, never a partial run |
| `scripts/fresh-start-wipe.sh` | wipes local data | destroys local data, irreversible on that machine |

## Verification / drift scripts (`scripts/`)

Non-destructive check scripts run before commit/deploy — `check-rls.sh`,
`check-fk-tenancy.sh`, `check-enum-drift.sh`, `check-vocabulary-drift.sh`,
`check-migrations-applied.sh`, `check-applied-migrations-tracked.sh`,
`check-function-replaced.sh`, `check-scarcity-indexes.sh`,
`check-scheduler-cache-drift.sh`, `check-suspension-drift.sh`,
`check-retired-at-drift.sh`, `check-rsc-function-props.py`. `agent-commit.sh`
wraps commits with these checks plus a mutex so concurrent agent sessions don't
race on the same lock.

## Environment

| Variable | For | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client | `.env.local` (gitignored) |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side Supabase access | `.env.local` |
| `SUPABASE_LEGACY_JWT_SECRET` | signs MCP connector session JWTs (see `.brain/memory/known-issues.md`) | `.env.local` / Vercel |
| `API_KEY_ENCRYPTION_SECRET` | encrypts stored provider API keys (`lib/ai/encryption.ts`) | `.env.local` |
| `MCP_SIGNING_KEY_JWK`, `CRON_SECRET` | MCP OAuth / scheduled-action auth | `.env.local` / Vercel |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web Push | `.env.local` |
| `SELF_MASTERY_DEV_PROVIDER_URL`, `SELF_MASTERY_INGESTION_URL`, `SELF_MASTERY_INGESTION_SECRET` | Self-Mastery/ULM ingestion pipeline | `.env.local` |

No secret values are recorded here or anywhere in `.brain/` — ask whoever holds
the "Lead" role for the current session, or Ayman.

## Agent-Brain

This install placed a git-free copy of the Agent-Brain tool at
`agent-brain-tool/` inside this repo (gitignored) so it has a stable local path.

| Command | Does |
|---|---|
| `node agent-brain-tool/bin/brain verify . --strict` | validate `.brain` health |
| `node agent-brain-tool/bin/brain index .` | regenerate `.brain/indexes/` |
| `node agent-brain-tool/bin/brain audit .` | token/context report |
| `node agent-brain-tool/bin/brain graph .` | interactive knowledge-graph HTML |

## Verifying this repo from a constrained/sandboxed shell

Some environments this repo is worked in (a remote-device shell, a sandboxed
agent container) cap every command at ~180s wall time and kill background
jobs when the call ends — `nohup ... &` does not survive. The commands below
are each sized to fit comfortably inside that cap and were timed on a 4-core
aarch64 Ubuntu 22.04 box (2026-09-13). On a normal unconstrained machine, just
run `./scripts/preflight.sh` — this section only exists because that single
command does not fit in a 180s window.

**Timings below are wall-clock and will vary by machine — treat them as "this
shape of command fits the cap," not as a guaranteed number.**

### `tsc` — fast, run whole

```bash
npx tsc --noEmit
```
Cold (no `tsconfig.tsbuildinfo`): ~10s. Warm/incremental: ~3s. Always capture
the real exit code — `npx tsc | head` reports `head`'s exit code (always 0)
and has produced a false "tsc clean" report twice on this team. Run it
unpiped and check `$?`, exactly as `preflight.sh` does.

### `vitest` — must be sharded to fit the cap

Un-sharded, the full suite exceeds 180s (confirmed: a single `--shard=1/4`
slice alone took ~128s). **8-way sharding is the minimum that fits
comfortably**, at ~60–70s wall per shard with margin to spare. Two shards
pack into one call at ~130s if you want fewer round trips:

```bash
npx vitest run --shard=1/8 --reporter=dot
npx vitest run --shard=2/8 --reporter=dot
npx vitest run --shard=3/8 --reporter=dot
npx vitest run --shard=4/8 --reporter=dot
npx vitest run --shard=5/8 --reporter=dot
npx vitest run --shard=6/8 --reporter=dot
npx vitest run --shard=7/8 --reporter=dot
npx vitest run --shard=8/8 --reporter=dot
```
Or packed two-per-call: `npx vitest run --shard=1/8 --reporter=dot; npx vitest run --shard=2/8 --reporter=dot` (repeat for 3/4, 5/6, 7/8).

As of 2026-09-13: 353 test files, 3465 tests total, **3462 passed, 0 failed,
1 skipped** (the deliberate `RUN_R22_INJECTION` gate in
`lib/ai/__tests__/dev-provider-injection.test.ts` — see
`.brain/memory/known-issues.md` and `preflight.sh`'s `ALLOWED_SKIPS`). A
skip anywhere else is a real failure, not sharding noise — `preflight.sh`
enforces this by exact test identity, not by count.

Sum every shard's file/test counts before trusting a "green" — a shard
silently dropped from a script (wrong `--shard` arg, a typo) reports the
same "all passed" shape as a genuinely smaller suite.

### `next build` — fits in one call, do not skip it

```bash
npx next build
```
~28s on a clean `.next/`. This is the **only** check that catches a Server
Component passing a function prop to a Client Component — `tsc` and
`vitest` are both structurally blind to it (see root `CLAUDE.md`). A
sharded/partial vitest run is not a substitute for this.

### Database checks — need `psql` and a live URL

E1 restored a userspace `psql` (PostgreSQL 14, arm64, extracted from Ubuntu
jammy `.deb`s — no root, no `apt-get`) at `$HOME/.local/pgsql/`. Source it
once per fresh shell before any of the `scripts/check-*.sh` scripts or
`preflight.sh`'s DB branch:

```bash
source $HOME/.local/pgsql/env.sh
psql --version   # sanity check: should print "psql (PostgreSQL) 14.x"
```
All 11 `scripts/check-*.sh` scripts (`check-rls.sh`, `check-fk-tenancy.sh`,
`check-enum-drift.sh`, `check-vocabulary-drift.sh`,
`check-migrations-applied.sh`, `check-applied-migrations-tracked.sh`,
`check-function-replaced.sh`, `check-scarcity-indexes.sh`,
`check-scheduler-cache-drift.sh`, `check-suspension-drift.sh`,
`check-retired-at-drift.sh`) take a `<postgres-url>` argument — none of them
are pure-code checks, so none run without a live database.
`check-rsc-function-props.py` is the one exception: pure static analysis, no
DB, runs in well under a second (`python3 scripts/check-rsc-function-props.py`).

### Regenerating `lib/supabase/database.types.ts` — needs no Docker

`npx supabase gen types typescript --db-url ...` looks like a pure API call
but is not one: the CLI's own binary has zero type-generation logic in it,
it is a thin client that always launches `supabase/postgres-meta` in a local
Docker (or Podman) container and talks to it over HTTP -- true even with
`--db-url`, even with no other Docker usage anywhere else in the command.
On a machine with no Docker/Podman and no root to install one (this
project's whole dev sandbox), that command fails with `docker: command not
found (podman also not found)` and produces empty stdout. It did this
silently across migrations 150, 151, 152 and 156 (E1, 2026-09-13): four real
production migrations landed with `apply-migration.sh`'s regen step failing
every time, each failure visible only as one warning line in a long apply
log, easy to miss and missed four times running. `ai_usage_log` (156) went
untyped, a finished feature reading 152's new columns had to be reverted,
and `class_assessments.type`'s CHECK-constraint vocabulary (151's rename)
went stale in the type system's eyes.

**The fix — `scripts/gen-database-types.sh <db-url> [output-path]`:**
`@supabase/postgres-meta` is an ordinary MIT-licensed npm package (plain
Node/Fastify, no native Docker dependency) — it IS the exact code Docker
would have run; the CLI's own Docker image is confirmed (by `strings`-ing
the CLI binary itself) to be `FROM supabase/postgres-meta:v0.99.0`, and its
compiled `dist/server/server.js` already ships a documented env-var "generate
once and print to stdout, then exit" mode (`PG_META_GENERATE_TYPES=typescript`)
used by the package's own `gen:types:typescript` dev script. The script
installs that exact pinned version into a machine-local, gitignored
`.local/pgmeta-gen/` (first run only, ~190 packages, ~20s; every run after
that is a ~3s `node` invocation against that cache) and runs it directly —
no container involved at any point.

```bash
scripts/gen-database-types.sh "$DATABASE_URL_POOLER"        # writes lib/supabase/database.types.ts
scripts/gen-database-types.sh "$DATABASE_URL_POOLER" /tmp/x.ts   # or any other output path
```

`apply-migration.sh`'s own post-apply regen step now calls this script
instead of `npx supabase gen types` directly, and — unlike the old
`2>/dev/null && [ -s ... ]` check it replaced — fails LOUDLY: non-zero exit
and a message on stderr, not one warning line among many. The script itself
refuses to touch the output path at all (rather than write something
truncated or empty) if: the generator process exits non-zero, the output is
under 20KB, it doesn't start with `export type Json`, it doesn't end with
an `as const` Constants block, or — the specific silent-truncation failure
mode this repo has hit before on large writes — the copied file's checksum
doesn't match the generated one.

**Fidelity, verified 2026-09-13 (E1):** regenerating against production and
diffing against the then-committed file showed every difference accounted
for by either (a) real schema changes (150/151/152/156's new tables,
columns, and composite FKs) or (b) the pinned postgres-meta version's own
generator-correctness improvements that the long regeneration outage had
never let land (`NonNullable<Json>` for NOT NULL jsonb columns, `never` for
generated-always columns, `Record<PropertyKey, never>` for zero-arg function
Args) — nothing attributable to this method being less faithful than the
Docker path it replaces, because it runs the identical pinned code. One
resulting gap worth knowing, not a bug in this script: a `CHECK (col IN
(...))` constraint (e.g. `class_assessments.type`) is NOT introspected into
a TypeScript literal union by this generator — only a native Postgres `CREATE
TYPE ... AS ENUM` is (see the `Enums` block). A CHECK-constrained column
types as its base SQL type (`string`) before and after any migration that
changes the CHECK's allowed values; the vocabulary itself is enforced at the
DB layer and, where the application layer needs it in TypeScript too, by a
hand-maintained constant (e.g. `lib/school/actions-core.ts`'s
`ASSESSMENT_TYPES`) — regenerating this file is not how that vocabulary
reaches TypeScript and was never going to be.

If a future `supabase` CLI upgrade moves its pinned postgres-meta version,
re-run the `strings` command in `scripts/gen-database-types.sh`'s own header
against the new CLI binary and bump `PGMETA_VERSION` to match — don't assume
"latest" tracks the CLI's pin.

### Full command reference

| Command | Fits 180s cap? | Notes |
|---|---|---|
| `npx tsc --noEmit` | yes (~10s cold) | run unpiped, check `$?` |
| `npx vitest run --shard=N/8 --reporter=dot` | yes (~60-70s each) | run all 8; sum the totals |
| `npx vitest run` (unsharded) | **no** | exceeds 180s, will be killed mid-run |
| `npx next build` | yes (~28s) | only check that sees RSC boundary violations |
| `python3 scripts/check-rsc-function-props.py` | yes (<1s) | no DB needed |
| `scripts/check-*.sh <postgres-url>` (11 scripts) | yes once DB is up | needs `source $HOME/.local/pgsql/env.sh` + a live URL |
| `./scripts/preflight.sh "<postgres-url>"` | **no**, in this shell | fine on an unconstrained machine; use the sharded runbook above instead when capped |
