---
id: arch.system-overview
title: System Overview
layer: L2
type: architecture
status: canonical
owner: unassigned
updated: 2026-09-13
sources:
  - app/**
  - lib/**
  - context/ARCHITECTURE.md
  - context/PURPOSE-AND-DOMAINS.md
related:
  - arch.dependency-graph
  - arch.data-flows
  - arch.service-map
  - map.repository
answers:
  - "what is the architecture"
  - "how does this system work"
  - "what are the components"
covers: "Components, boundaries, request lifecycle, external dependencies at a glance"
excludes: "Per-service detail (see arch.service-map), dependency edges (see arch.dependency-graph), data flows (see arch.data-flows), full technical convention detail (see context/ARCHITECTURE.md — the canonical, still-accurate L3 source this file compresses and points at)"
tokens_est: 1725
source_hash: 7886f4693d5664e4701a835a565529f4dd1692632604f59a0157ad5c502c8d53
---

# System Overview

**This is a compressed pointer, not a copy.** `context/ARCHITECTURE.md` (323 lines) is this repository's own canonical, actively-maintained technical architecture doc, verified against code as recently as 2026-09-10 and re-confirmed accurate by this install's research pass. Read it for full detail on routing, the Supabase client layers, RLS/tenancy, Server Actions, the RSC boundary rule, the timezone rule, testing, and deploy. This file exists only to give an agent a same-page L2 summary and a fast route in.

## What this system is

A multi-tenant "personal operating system" web app — Next.js 16 (App Router) + React 19 + Supabase Postgres, deployed to Vercel as `tracking-app`. It runs a person's day across the life areas they choose (faith, work, school, fitness, learning, business), on the founding thesis that most tools "record well and decide poorly" — nearly every screen answers *what should I do now* rather than *what happened*. It is genuinely multi-tenant with open signup (see `.brain/domains/settings-onboarding.md` and `CLAUDE.md`'s evidence list), not the single-user app its own oldest docs describe.

**Style:** modular monolith (single Next.js app, domain-split `lib/`/`components/`, no service boundaries at the process level). **Runtime:** Node (+ one Python script). **Deployed to:** Vercel, database on Supabase.

## Components

| Component | Responsibility | Path | Entrypoint |
|---|---|---|---|
| Web app (pages + Server Actions) | Cookie-authed UI across all life domains | `app/(app)/**` | `app/(app)/layout.tsx` |
| MCP AI-connector | Bearer-token API surface for external AI clients | `lib/mcp/`, `app/api/mcp/**` | `app/api/mcp/route.ts` |
| Widgets | Declarative AI-created Home dashboard cards | `lib/widgets/` | Rendered from `app/(app)/page.tsx` |
| Scheduled/cron jobs | pg_cron-polled scheduled MCP writes + notification dispatch | `app/api/cron/**`, `supabase/functions/dispatch-notifications` | — |
| Domain logic (`lib/`) | 30 domain-split, framework-free calculation/derivation modules | `lib/**` | (no single entrypoint — see `arch.service-map`) |

## Boundaries

- **`lib/` is framework-free** — pure calculation/derivation, no React, no Next APIs. This is what makes it unit-testable with `vitest` and is not accidental (`lib/shell/`'s own header states this explicitly for nav rules).
- **RLS is the tenancy mechanism, not defense-in-depth** — every public table (77 as of 2026-09-10, moving) has RLS enabled; enforced further by `scripts/check-rls.sh`/`check-fk-tenancy.sh`, both of which require `psql` with a live production URL to actually run (no `psql` install existed on any agent machine before 2026-09-13 — see `.brain/tooling/registry.md`'s "Database checks" section for the current, no-root install and `source $HOME/.local/pgsql/env.sh` runbook, and `.brain/memory/lessons.md`'s 2026-09-13 entry for what ran unnoticed in the meantime: 4 real single-column FKs to user-scoped parents in the MCP tables, closed in migration `150` the first time the check ever executed). Citing these scripts as enforcement is only true for the invariants they have actually been RUN against, not the ones they merely know how to check.
- **The MCP connector never gets a privileged client for user data** — even service-role-authenticated routes mint a per-request, RLS-scoped JWT for the actual domain query. See `.brain/domains/mcp-connector.md`.
- **No hard deletes on the MCP write path** — enforced by convention per write-registry entry.

## Request lifecycle (representative: a cookie-authed page load)

1. `proxy.ts` (Next 16's `middleware.ts` rename) → `lib/supabase/middleware.ts`'s `updateSession` — refreshes the session, injects `x-pathname`.
2. `app/(app)/layout.tsx`'s `AuthedShell` → `getAuthedUser()` (local JWKS verification, no network round trip) → redirect to `/login` or `/onboarding` if unauthenticated/not onboarded.
3. Page's Server Component fetches its own data via one of the three cookie-scoped Supabase clients (`lib/supabase/server.ts`), RLS-scoped to `auth.uid()`.
4. A mutation goes through a Server Action in a `<route>/actions.ts` file, calling a `*-core.ts` function shared with MCP where one exists, then `revalidatePath` for its own route and `/`.

**The MCP request lifecycle is a separate, parallel path** — bearer token, not cookie; see `.brain/domains/mcp-connector.md` and `arch.data-flows.md`.

## External dependencies

| Service | Used for | Failure behavior |
|---|---|---|
| Supabase (Postgres+Auth+Storage) | Primary datastore, auth, file storage | Hard fail (no offline-first mode) |
| Supabase Edge Functions / pg_cron+pg_net | Notification dispatch, scheduled MCP actions | Polled every 5-15 min; a missed poll delays, doesn't lose, the action |
| Vercel | Deploy target | Bot-protection/firewall can silently 403 the MCP surface — a known operational risk, see `.brain/domains/mcp-connector.md` |
| DeepSeek | BYO-key LLM for answer-feedback / book-ingestion summarization | Feature degrades to unavailable, not a hard app failure |
| Web Push (VAPID) | Prayer-reminder notifications | Best-effort, no retry queue beyond the cron's own re-poll |

## Where to go next

| For | Read |
|---|---|
| Full technical conventions (routing, RSC rule, timezone rule, deploy, multi-agent git discipline) | `context/ARCHITECTURE.md` |
| Product intent and design philosophy | `context/PURPOSE-AND-DOMAINS.md` |
| Dependency detail | `.brain/architecture/dependency-graph.md` |
| Data movement | `.brain/architecture/data-flows.md` |
| Per-service detail | `.brain/architecture/service-map.md` |
| A specific domain | `.brain/domains/` |
| Where code lives | `REPOSITORY_MAP.md` |
| Why it is this way | `.brain/memory/decisions.md` |

## Unverified

- None — this file's claims are either directly re-verified this install or explicitly deferred to `context/ARCHITECTURE.md`, itself independently spot-checked and confirmed accurate.
