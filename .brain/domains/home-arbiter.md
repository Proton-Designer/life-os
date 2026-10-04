---
id: domain.home-arbiter
title: Home + Cross-Domain Arbiter
layer: L2
type: domain
status: canonical
owner: unassigned
updated: 2026-09-13
sources:
  - lib/home/**
  - app/(app)/page.tsx
related:
  - domain.deen
  - domain.fitness
  - domain.self-mastery
  - domain.business-lockin
  - domain.work-coop
  - domain.school
  - domain.widgets
  - arch.system-overview
answers:
  - "how does home decide what to show"
  - "what is the arbiter's ranking order"
  - "why does home show only one next action"
covers: "Home as the single daily entry point; the cross-domain arbiter that ranks candidates from every domain into one 'Now'"
excludes: "Per-domain data sources feeding Home (see each domain.* doc); metrics/trends (deliberately excluded from Home, see domain.insights)"
tokens_est: 1332
source_hash: 6c6c46ad1b38a66529649deda22df5f5103211af3c4da7bec0c2e1ffcaae8d47
---

# Home + Cross-Domain Arbiter

## Purpose

Home is the single daily entry point, deliberately not a dashboard: what to do right now, where am I in the day, and a doorway into domain detail. Metrics/history live in Insights, not here.

## Key concepts

| Term | Means |
|---|---|
| Candidate | The arbiter's generic ranking unit: `area`, `dueAt`, `weightTier`, `position`, `decay`, `cost`, `riskScore`/`riskConfidence`. |
| Area | `Domain \| "self_mastery"` — `Domain` itself is frozen to `deen\|business\|fitness\|school\|co_op`. |
| Comparator order (verified line-by-line) | `urgency → dueAt → weightTier → position → decay → cost → riskScore` (`lib/home/arbiter.ts:170-206`) — matches root `CLAUDE.md` and `context/PURPOSE-AND-DOMAINS.md` exactly. |

## Where the code lives

| What | Path | Notes |
|---|---|---|
| Comparator | `lib/home/arbiter.ts` | `rankCandidates` (170-207), `pickPrimaryAndAlternates` (216-225) |
| Candidate mapping | `lib/home/build-candidates.ts` | PriorityItem→Candidate; Self-Mastery due-session→Candidate |
| Weight lookup | `lib/home/resolve-area-weights.ts` | Returns `{}` unconditionally for legacy mode |
| Data assembly | `lib/home/{get-priority-items,get-domain-snapshots,get-domain-pulse,get-home-extras,get-day-shape,day-ribbon,home-kpis,get-weekly-completion,compute-domain-visibility,sector-rows}.ts` (Home "Sector progress" rows + which snapshot queries run come from `sector-rows.ts`: one row per Work tab, only areas the account set up — SECTOR-01) | |
| Entrypoint | `app/(app)/page.tsx` | Composition root |

## How it works

1. One `Promise.all`: priority items, completed-today, domain snapshots, home extras, day shape, weekly-goals row, distraction triggers, in-progress items, Self-Mastery due summary, MCP widgets.
2. `resolveAreaWeights` builds the weight lookup; `selectNextActionPerDomain` picks one item per domain, then ranks cross-domain via the arbiter.
3. Render order: InProgressBanner → (SessionEntryCard if it wins) → WeeklyGoalsHeader → Sector-progress stack → Now/Focus grid → (SessionEntryCard if it doesn't win) → Day-shape ribbon → MCP widgets panel.

## Integration points

| Direction | With | Via |
|---|---|---|
| Depends on | Every domain | Deen (prayers, windowed), Business (kill list, focus minutes, Signal:Noise), School/Work (tasks due today), Fitness (one row), Self-Mastery (due-session, gated on `hasArea(..,"learning")`) |
| Depends on | Widgets | `renderWidgets` calls the real `readTool()`, inheriting MCP's own read filters |
| Feeds | Morning Open, Evening Close | Crowned/starred tasks (`mit_rank`) read back by both |

## Constraints & gotchas

- **Legacy accounts get NO weight tier at all** — `resolveAreaWeights` returns `{}` for `mode:"legacy"`, so every legacy candidate (including the owner's own real daily account) falls to the arbiter's `"important"` floor. Verified directly, not inferred.
- **Business and co_op have no weight/position entry in any mode** — a named, escalated gap (flagged to the lead 2026-09-02).
- **Five of the arbiter's seven tiers are near-always ties today**: `decay` populated only for Self-Mastery; `cost` real only for a scheduled Fitness session; `riskScore`/`riskConfidence` always null (School's risk engine isn't wired into `PriorityItem` yet). In practice only urgency/dueAt do most of the work.
- Prayers are windowed, not instants — a closed-unlogged prayer moves to Qada backlog, not the due-today list.

## Not covered here

- Each domain's own data shape → the relevant `domain.*` doc
- Insights' metrics/trends (deliberately excluded from Home) → `domain.insights`

## Unverified

- `lib/widgets/render.ts` calling the real `readTool()` was not re-verified line-by-line in this pass (verified by a separate MCP-focused pass; treated as confirmed here by cross-reference).
- Whether Home's Focus panel (session-log-based, `work_sessions`) and Insights' Focus Map (check-in-sample-based, `checkin_allocations`) can report different "focus minutes" for the same day — observed as a plausible discrepancy, not documented elsewhere as a known gap.
