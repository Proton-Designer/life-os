---
id: domain.widgets
title: Widgets (AI-created Home dashboard cards)
layer: L2
type: domain
status: canonical
owner: unassigned
updated: 2026-09-13
sources:
  - lib/widgets/**
  - components/home/mcp-widgets-panel.tsx
  - app/(app)/widgets/**
related:
  - domain.mcp-connector
  - domain.home-arbiter
  - arch.system-overview
answers:
  - "how do ai-created home widgets stay safe"
  - "what widget kinds exist"
covers: "Declarative, MCP-created Home dashboard widgets — Tier 1 only, no code execution"
excludes: "The read/write tool machinery widgets reuse (see domain.mcp-connector)"
tokens_est: 1042
source_hash: a0e0e1a2e6fe0657e5f6ac9435c6e4dcca7dd3b0604c69ebfa734dab7ab7212a
---

# Widgets (AI-created Home dashboard cards)

## Purpose

Lets an MCP client create small, declarative dashboard cards on Home (`metric_card`, `list`, `progress_against_goal`, `sparkline`, `streak`) without code execution or a deploy.

## Key concepts

| Term | Means |
|---|---|
| Widget row | `mcp_widgets` — `{kind, title, data_source:{domain,entity,filter}, display, slot:"home", position, status}`. |
| Tier 1 only | Tiers 2 (sandboxed agent code) and 3 (repo code + deploy) were designed then explicitly cancelled — code execution would destroy Tier 1's provable safety. |

## Where the code lives

| What | Path | Notes |
|---|---|---|
| Validation | `lib/widgets/validate.ts` | Write-time, against the live registry |
| Render | `lib/widgets/render.ts` | Calls the real `readTool()` — verified, not a second hand-rolled query |
| CRUD | `lib/widgets/actions-core.ts` | |
| MCP tool | `lib/mcp/tools/widget-manage.ts` | |
| UI | `components/home/mcp-widgets-panel.tsx` | The renderer |
| Human remove | `app/(app)/widgets/actions.ts` | A real DELETE (unlike the MCP path's archive) |

## How it works

`render.ts` imports and calls the same `readTool()` the MCP `read` tool dispatches to — a widget inherits `fixedFilter`/`parentFilter`/column restrictions **exactly** as a live `read()` call would, re-derived on **every render**, never cached from creation time (a structural, not policy, guarantee — audited with file:line evidence and a two-caller invariant: `readTool()` has exactly two callers, `app/api/mcp/route.ts` and `render.ts`). Five kinds computed client-side over rows already returned (never a second query).

## Integration points

| Direction | With | Via |
|---|---|---|
| Depends on | MCP connector | The real `readTool()` |
| Rendered by | Home | The only caller of `renderWidgets` |
| Not schedulable | `scheduler_manage` | `widget_manage` isn't registered in `WRITE_REGISTRY` — a known, documented gap |

## Constraints & gotchas

- **`mcp_widgets.kind` CHECK-constraint drift is RESOLVED** (migration 149, confirmed applied + production-verified) — but `docs/ai-connector/PROGRAM-PLAN.md` and `docs/ai-connector/CAPABILITIES.md` still describe it as unresolved. Trust the code/migration, not those two doc sections, on this point.
- **`streak`'s render.ts branch is complete** — a prior doc snapshot said it was missing; `git log` confirms it landed after that doc was last touched.
- `WIDGET_RENDER_MAX_ROWS=100` is a named module constant, never reachable through a widget's stored config — deliberately distinct from the MCP route's `PAGE_SIZE=20` (a model-context constraint vs. a human-browser consumer).
- `aggregate:"count"` against `source_chunks` is allowed by design (empty full/summary columns means only a count, never text/embeddings) — not a hole.

## Not covered here

- MCP auth/tool machinery widgets reuse → `domain.mcp-connector`

## Unverified

- Whether an archived widget's `data_source` is re-validated on any future "restore" action (no restore action found in `widget_manage`'s action set — may be moot).
