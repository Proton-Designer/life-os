# Agent Guide — Life OS

Multi-tenant personal-operating-system app (Next.js 16 + React 19 + Supabase).

This repository uses **Agent-Brain**: knowledge is layered, and you navigate to it
rather than searching for it.

## Start here

1. Read `CLAUDE.md` first (routing + hard constraints).
2. Use the table below to load only what your task needs.
3. Read the domain summary before the code it describes.

**Do not grep the repository to answer a question the routing table answers.**

## Routing

| If you need… | Read |
|---|---|
| System architecture | `.brain/architecture/system-overview.md` |
| Where code lives | `REPOSITORY_MAP.md` |
| A business domain (14 total) | `.brain/domains/README.md` |
| Past decisions | `.brain/memory/decisions.md` |
| Known problems | `.brain/memory/known-issues.md` |
| Work in flight | `.brain/memory/active-work.md` |
| Commands & tooling | `.brain/tooling/registry.md` |
| Ownership | `.brain/governance/ownership.md` |
| The full incident history behind every rule below | `.brain/archive/2026-09-13.root-agents-md-v1.md` |

Machine-readable routing: `.brain/indexes/knowledge-map.json` (after `brain index`).

## Rules

- **Layers, in order.** Summary → documentation → source. Never source first.
- **Code wins.** If a summary contradicts the code, the code is correct. Fix the
  summary and record it in `.brain/memory/known-issues.md`.
- **Write down what you learn.** Decisions, traps, dead ends go in
  `.brain/memory/`.
- **Update what you invalidate.** See `.brain/governance/contribution-protocol.md`.
- **Report honestly.**

## Constraints (each cost a production incident — see archive above)

- Never pass a function prop from a Server Component to a Client Component.
- Never derive a calendar date from a raw `Date` — use `lib/date-utils.ts`.
- Commit only via `./scripts/agent-commit.sh "msg" <paths>` — never `git add -A`.
- Only the session's "Lead" runs `npx playwright test`.
- A check that examines nothing reports success — prove it fails first.
