---
id: tool.optimization-registry
title: Token Optimization Registry
layer: L2
type: tooling
status: canonical
owner: unassigned
updated: 2026-09-13
answers:
  - "what token optimization tools are enabled"
  - "should I use a containment tool here"
covers: "Which containment/optimization tools are enabled in this repo"
excludes: "MCP servers (see tool.mcp-registry), general tool-output safety rules (see gov.tool-output-policy)"
tokens_est: 701
---

# Token Optimization Registry

**Status of this repo: no optimization tooling enabled.** No evidence of Omni,
Context Mode, CodeBurn, or any comparable containment/observability tool was
found anywhere in this codebase, its config, or its dependencies.

Agent-Brain's own optimizations — layering, routing, budgets, `.brain/indexes/`
— are always on and require nothing here. This registry covers optional
third-party tooling layered on top, and this repo has none.

---

## Enabled here

| Tool | Category | Status |
|---|---|---|
| — | — | none enabled |

Status values: `enabled` · `disabled` · `evaluating` · `rejected`. Every
category below defaults to `disabled` because nothing has been installed or
evaluated — not because anything was rejected.

---

## Available categories (not yet evaluated in this repo)

| # | Category | What it does | Status here |
|---|---|---|---|
| 1 | Knowledge routing | Navigate instead of search | `disabled` for third-party tools — **Agent-Brain itself is this**, and is installed |
| 2a | Ambient containment | Filters shell output automatically | `disabled` — nothing evaluated |
| 2b | Deliberate workspace | Separate execution path + indexed search | `disabled` — nothing evaluated |
| 3 | Observability | Measures where tokens go | `disabled` — nothing evaluated |

This repo's own drift-detection scripts (`scripts/check-*.sh`,
`scripts/agent-commit.sh`) are a form of correctness containment specific to
this codebase's schema and migrations. They are not general-purpose
token-optimization tooling and are tracked in `.brain/tooling/registry.md`
instead of here.

---

## Rules for agents

- **Do not enable or install optimization tooling on your own initiative.**
  This is an operator decision.
- **This table being empty is a healthy, valid state.** The knowledge base
  works exactly as designed with nothing enabled.
- If you evaluate one of these categories for this repo, record the outcome
  here — `enabled`, `disabled`, or `rejected` with a reason — so it isn't
  re-evaluated from scratch every few months.
