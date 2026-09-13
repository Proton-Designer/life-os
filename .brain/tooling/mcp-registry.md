---
id: tool.mcp-registry
title: MCP Registry
layer: L2
type: tooling
status: canonical
owner: unassigned
updated: 2026-09-13
answers:
  - "what MCP servers are available to agents working in this repo"
  - "is this repo an MCP server or an MCP client"
covers: "MCP servers available to agents developing this repo; how that differs from the product's own MCP feature"
excludes: "The product's own MCP connector as a feature (see domain.mcp-connector), external services (see tool.integrations)"
tokens_est: 507
---

# MCP Registry

**Configured for agent tooling in this repo: none.** No `.mcp.json` or
harness-level MCP server config was found for developing this codebase.

## Do not confuse this with the product's own MCP server

This repository **implements** an MCP server as a product feature — it is not a
*consumer* of one for development. `app/api/mcp/route.ts`, `lib/mcp/*`
(registry, tools, OAuth, rate-limiting, scheduler) expose LifeOS data and
actions to external MCP clients (e.g. Claude). That is documented as a domain
in `.brain/domains/mcp-connector.md` — read that, not this file, for how it
works.

This file is about the reverse direction: MCP servers an *agent* editing this
repo could call. There are none configured.

## Rules for agents

- **Check this file before assuming an MCP server is available for your own
  use while working in this repo.** None is.
- **Prefer the free path.** `REPOSITORY_MAP.md`, `context/ARCHITECTURE.md`, and
  `.brain/indexes/` (once generated) answer most navigation questions without
  any server.
- If you are testing or debugging the product's *own* MCP server, use
  `scripts/mcp-protocol-check.ts`, `scripts/mcp-oauth-flow-check.ts`,
  `scripts/mcp-write-loop-check.ts`, `scripts/verify-mcp-widgets-kind-check.ts`
  — see `.brain/domains/mcp-connector.md`.
