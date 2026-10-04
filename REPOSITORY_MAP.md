---
id: map.repository
title: Repository Map
layer: L2
type: map
status: canonical
owner: unassigned
updated: 2026-10-04
answers:
  - "where does the code for X live"
  - "what is in this directory"
  - "which service handles Y"
covers: "Top-level layout, where each domain's code lives, where to make common changes"
excludes: "Per-domain implementation detail (see .brain/domains/), dependency edges (see arch.dependency-graph)"
tokens_est: 1143
---

# Repository Map

Single-package Next.js 16 App Router app (`life-os`), not a monorepo. Routes live
under `app/(app)/<domain>/`, most business logic under `lib/<domain>/`.

**Primary language:** TypeScript · **Layout:** single service

---

## Top level

| Path | Contains | Knowledge |
|---|---|---|
| `app/` | Next.js App Router routes, incl. `app/(app)/<domain>/` per-domain pages + Server Actions, `app/api/mcp/**` | `.brain/domains/`, `.brain/architecture/system-overview.md` |
| `lib/` | Business logic per domain (`lib/deen/`, `lib/business/`, `lib/coop/`, `lib/school/`, `lib/self-mastery/`, `lib/mcp/`, `lib/widgets/`, `lib/home/`, `lib/evening-close/`, `lib/night-plan/`, `lib/domains/`, `lib/prayer-times/`, `lib/date-utils.ts`, `lib/supabase/`) | `.brain/domains/` |
| `components/` | React components, one subdirectory per domain/area (mirrors `lib/`) | `.brain/domains/` |
| `context/` | Orientation docs (`context/ARCHITECTURE.md`, `context/PURPOSE-AND-DOMAINS.md`, `context/RECENT-CHANGES.md`) | `context/README.md` |
| `docs/` | `docs/REPO-MAP.md` (doc-trust map), `docs/ai-connector/` (current MCP program record), `docs/superpowers/` (dated historical decision log — see `docs/REPO-MAP.md` §7), `docs/audits/` | `docs/REPO-MAP.md` |
| `supabase/migrations/` | 149+ numbered SQL migrations, `supabase/migrations/ALLOCATIONS.md` (authoritative ledger), `supabase/migrations/_withdrawn/` | `.brain/tooling/registry.md` |
| `scripts/` | Deploy, migration, and drift-check scripts (`agent-commit.sh`, `deploy-prod.sh`, `apply-migration.sh`, `check-*.sh`) | `.brain/tooling/registry.md` |
| `e2e/` | Playwright specs — session-serialized, Lead-role-only to run | `.brain/governance/tool-output-policy.md` |
| `.brain/` | This knowledge base (L2) | `CLAUDE.md` |
| `agent-brain-tool/` | Git-free copy of the Agent-Brain CLI used to build/verify `.brain/` (gitignored) | `.brain/tooling/registry.md` |

Noise suppressed from this map: `node_modules/`, `.next/`, `playwright-report/`,
`test-results/`, `test-stubs/`.

---

## Where each domain's code lives

See `.brain/domains/README.md` for the full table (domain → covers → primary
code → owner). Every domain follows the same shape: `app/(app)/<domain>/` for
routes and Server Actions, `lib/<domain>/` for business logic, `components/
<domain>/` for UI — with named exceptions documented in each domain's own file
(e.g. Self-Mastery's real entrypoint is `app/(app)/personal/[subdomain]/`, not
a standalone route).

---

## Where to make common changes

| To change… | Go to |
|---|---|
| Home's day rhythm (Morning / Today / Close the day / Done) | `lib/home/rhythm-state.ts` (pure state + `isAfterWindDown`), `lib/home/rhythm-data.ts`, `components/home/rhythm/` — see `.brain/domains/home-arbiter.md` |
| Which calendar day the close/plan belongs to | `effectiveDayString` in `lib/date-utils.ts` (4 AM rollover) — see `.brain/memory/decisions.md` |
| Work tabs (`/work/<key>`, Business tab, tab editor) | `lib/shell/work-tabs.ts`, `app/(app)/work/{page,work-screen,subdomain-actions}`, `components/shell/work-tabs-bar.tsx` — see `.brain/domains/work-coop.md` |
| Home "Sector progress" rows | `lib/home/sector-rows.ts`, `components/home/domain-status-stack.tsx` |
| The weekly reset / Insights Week tab | `app/(app)/week/page.tsx`, `lib/week/`, `components/week/`; old `/weekly-review` `/goals` `/habits` `/worries` are redirects |
| Capture areas + Inbox triage | `lib/capture/areas.ts`, `lib/inbox/`, `components/capture/` |
| Launch sequence / Wind-down | `lib/rhythm/`, `lib/morning-routine/`, `components/home/launch-sequence-card.tsx`, `components/settings/wind-down-plan-settings.tsx`, `app/api/cron/sleep-reminder` |
| A domain's business logic | `lib/<domain>/` — check that domain's `.brain/domains/<domain>.md` first |
| A route or Server Action | `app/(app)/<domain>/` |
| The cross-domain Home ranking | `lib/home/arbiter.ts` — see `.brain/domains/home-arbiter.md` |
| Database schema | new numbered file in `supabase/migrations/`, allocated via `supabase/migrations/ALLOCATIONS.md` — never self-numbered |
| An MCP tool or registered entity | `lib/mcp/registry.ts`, `lib/mcp/tools/` — see `.brain/domains/mcp-connector.md` |
| Legacy-vs-domains navigation | `lib/domains/get-user-domains.ts`, `lib/shell/build-primary-nav-items.ts` — see `.brain/domains/settings-onboarding.md` |
| Deploy | `scripts/deploy-prod.sh` — Lead-role-only, see `.brain/governance/ownership.md` |

---

## Not covered here

- Per-domain internals (data model, integration points, gotchas) → `.brain/domains/<domain>.md`
- Dependency edges between domains → `.brain/architecture/dependency-graph.md`
- Historical/superseded documentation → `docs/REPO-MAP.md` (this repo's own doc-trust map, which this file defers to for anything about `docs/`)
