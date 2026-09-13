---
id: arch.dependency-graph
title: Dependency Graph
layer: L2
type: architecture
status: canonical
owner: unassigned
updated: 2026-09-13
sources:
  - lib/**
  - supabase/migrations/**
related:
  - arch.system-overview
  - arch.service-map
answers:
  - "what breaks if i change this"
  - "how does tenancy get enforced at the database layer"
  - "what depends on what across domains"
covers: "Internal lib/ dependency shape, the tenancy/RLS mechanism, and the migration discipline that keeps schema and code from silently disagreeing"
excludes: "Column-by-column schema (out of scope at this layer); full routing/stack detail (see context/ARCHITECTURE.md)"
tokens_est: 1719
source_hash: e43a452f8efb112d922b849a36493da10349fa52166cf6f8648f74daef2fd464
---

# Dependency Graph

## Internal coupling shape

`lib/` is domain-split (30 directories) and mostly **hub-and-spoke into `lib/home/`**: every domain exposes a small read function that `lib/home/get-priority-items.ts`/`get-domain-snapshots.ts`/`build-candidates.ts` calls, but domains do not generally import each other directly. Named exceptions, all direction-verified:

| Depends on | Depended on by | Why |
|---|---|---|
| `lib/prayer-times/windows.ts` | `lib/deen/`, `lib/home/get-priority-items.ts`, `lib/home/get-day-shape.ts`, `lib/checkins/schedule.ts` | The one safe prayer-window entry point |
| `lib/business/{domain-classification,domain-weights}.ts` | `lib/insights/` (via `app/(app)/insights/page.tsx`), `lib/home/get-domain-snapshots.ts` | Signal:Noise is computed once, read twice |
| `work_sessions` (shared table, not a lib import) | `lib/coop/`, `lib/business/active-session.ts` | Work and Business/Lock-In share the session/objectives model |
| `lib/mcp/tools/read.ts`'s `readTool()` | `lib/widgets/render.ts` | Widgets inherit MCP's read filters by direct function reuse, not policy |
| `lib/domains/get-user-domains.ts` | Every nav-gated route, `lib/home/resolve-area-weights.ts`, `lib/shell/*` | The legacy/domains mode switch |
| `lib/self-mastery/fsrs-scheduler.ts` | Session build (client) + `submit_review` RPC (server) | "Exactly one scheduler" invariant — both sides must import from here |

**Coupling direction that matters most**: `lib/home/*` depends on nearly every other domain's read functions; almost nothing depends on `lib/home/*` back. Changing a domain's read function's return shape is a Home-breaking change far more often than the reverse.

## External dependency direction

- App code → Supabase (Postgres/Auth/Storage) via one of four typed client constructors (`lib/supabase/{server,client,middleware,service-role}.ts`) — see `context/ARCHITECTURE.md` for the full client-selection rules.
- MCP tool code → Supabase, but **only** through a per-request minted, RLS-scoped JWT client — never the service-role client for domain data.
- App code → Vercel is a deploy-time dependency, not a runtime one (no Vercel SDK calls in request paths found).
- App code → DeepSeek (`lib/ai/providers.ts`) for self-mastery answer-feedback and (per a recorded, not-yet-shipped decision) book-ingestion summarization.

## Tenancy & RLS — three independent enforcement layers

1. **RLS on every table** — 77 public tables (as of 2026-09-10, moving with each migration), `user_id = (select auth.uid())` policies, convention name `<table>_own_row`.
2. **Composite tenancy foreign keys** — `(user_id, child_id) → parent(user_id, id)`, making a cross-account-pointing row **unrepresentable**, not merely forbidden. `scripts/check-fk-tenancy.sh` exists because a *single-column* FK bypasses RLS (FK checks run as table owner) — proven exploitable three times in this schema's history (migrations 058, 086, 100), including a cross-tenant denial-of-service shape.
3. **Belt-and-braces explicit `.eq("user_id", userId)`** in application code on top of RLS wherever a query is built dynamically (e.g. `lib/mcp/tools/read.ts`).

A live Postgres event trigger (`ensure_rls`) auto-enables RLS on new tables in *production* but requires superuser — Supabase's `postgres` role isn't superuser, so any restricted rebuild (CI, scratch, staging) is structurally **more** dangerous than production on this exact dimension. `scripts/check-rls.sh` exists to stand in where the trigger cannot.

## Migration discipline (what keeps schema and code from silently disagreeing)

- **124 migration files** on disk, numbered 000→149 with gaps (withdrawn/renumbered). `supabase/migrations/_withdrawn/` holds 3 files that must never be applied — each carries a documented reason.
- **`supabase/migrations/ALLOCATIONS.md`** is the append-only ledger: migration numbers allocated by a designated lead only, before a file lands, to prevent collisions in a shared working tree (a 132/133 collision already happened once).
- **`scripts/apply-migration.sh`** is the only sanctioned apply path — records each file's md5 in `migration_ledger` at apply time, refuses to re-run a file edited after it was applied. Never bare `psql` (autocommits outside an explicit transaction, so a failing multi-statement migration can partially land).
- **`scripts/check-enum-drift.sh`** exists because a Postgres `text + CHECK` column has no structural link to the TypeScript union that claims to mirror it — exactly the class of bug that produced the `mcp_widgets.kind` incident (resolved by migration 149). Recently rewritten to enumerate from the live database rather than a hand-maintained list.
- A documented near-miss: migration 129's FK cascade mutated a sibling `updated_at` column *inside Postgres* with no app code and no trigger involved — proof that "verified against the app's write paths" is necessary but not sufficient for freshness columns; migration 140 was the sweep this forced.

## Where to go next

| For | Read |
|---|---|
| Full client-selection rules, RLS policy examples | `context/ARCHITECTURE.md` |
| Per-service purpose/entrypoint | `.brain/architecture/service-map.md` |
| The MCP auth chain specifically | `.brain/domains/mcp-connector.md` |

## Unverified

- Whether the live public-table count has moved past 77 since 2026-09-10 (no database access from this install pass; migrations continued landing after that count).
