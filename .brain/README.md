---
id: meta.brain-readme
title: The .brain Directory
layer: L2
type: meta
status: canonical
owner: unassigned
updated: 2026-09-13
answers:
  - "what is the .brain directory"
  - "where does knowledge live"
covers: "Index of the whole knowledge base, how to use it, rules for keeping it true"
excludes: "The content of any single domain or architecture document (see that document itself)"
tokens_est: 1861
---

# `.brain/`

The agent knowledge base for this repository, installed by
Agent-Brain.

**Entry point is `/CLAUDE.md`, not this file.** Root `/CLAUDE.md` carries the
routing table; everything here is one hop down from it.

---

## Index

<!-- This file is the routing hub for everything root CLAUDE.md does not list
     directly. Keeping L1 at 150 lines depends on this file reaching the rest,
     so every .brain document must appear here or in a directory README linked
     from here. `brain verify` fails on anything unreachable within 3 hops. -->

**Architecture** — how the system is built
- [`architecture/system-overview.md`](architecture/system-overview.md) — components, boundaries, request lifecycle
- [`architecture/dependency-graph.md`](architecture/dependency-graph.md) — what depends on what; boundary rules
- [`architecture/service-map.md`](architecture/service-map.md) — service catalogue, ownership, data ownership
- [`architecture/data-flows.md`](architecture/data-flows.md) — sources of truth, key flows, retention

**Domains** — how each business capability works
- [`domains/README.md`](domains/README.md) — the domain index
- [`domains/home-arbiter.md`](domains/home-arbiter.md), [`domains/deen.md`](domains/deen.md), [`domains/fitness.md`](domains/fitness.md), [`domains/self-mastery.md`](domains/self-mastery.md), [`domains/work-coop.md`](domains/work-coop.md), [`domains/business-lockin.md`](domains/business-lockin.md), [`domains/school.md`](domains/school.md), [`domains/evening-close.md`](domains/evening-close.md), [`domains/distractions-checkins.md`](domains/distractions-checkins.md), [`domains/calendar.md`](domains/calendar.md), [`domains/insights.md`](domains/insights.md), [`domains/mcp-connector.md`](domains/mcp-connector.md), [`domains/widgets.md`](domains/widgets.md), [`domains/settings-onboarding.md`](domains/settings-onboarding.md)

**Memory** — what we know that the code does not show
- [`memory/decisions.md`](memory/decisions.md) — why things are the way they are
- [`memory/known-issues.md`](memory/known-issues.md) — traps, and constraints that look like bugs
- [`memory/lessons.md`](memory/lessons.md) — what was tried and failed
- [`memory/active-work.md`](memory/active-work.md) — what is in flight

**Governance** — the rules that keep this true
- [`governance/contribution-protocol.md`](governance/contribution-protocol.md) — **what to update when you change code**
- [`governance/documentation-standards.md`](governance/documentation-standards.md) — how to write a `.brain` doc
- [`governance/knowledge-lifecycle.md`](governance/knowledge-lifecycle.md) — review cadence, drift, archiving
- [`governance/ownership.md`](governance/ownership.md) — who owns what
- [`governance/tool-output-policy.md`](governance/tool-output-policy.md) — keeping tool output out of context

**Tooling** — what this repo connects to
- [`tooling/registry.md`](tooling/registry.md) — build, test, deploy commands
- [`tooling/integrations.md`](tooling/integrations.md) — CI, observability, external services
- [`tooling/mcp-registry.md`](tooling/mcp-registry.md) — MCP servers, and when not to use them
- [`tooling/optimization-registry.md`](tooling/optimization-registry.md) — token tooling: enabled/disabled

**Structural**
- [`indexes/README.md`](indexes/README.md) — generated indexes; never hand-edit
- [`archive/README.md`](archive/README.md) — L5 superseded knowledge, with provenance
- [`agents/README.md`](agents/README.md) — reserved; specialization is a later phase
- `.scan/` — scanner output. Gitignored, regenerable, not knowledge.

---

## Interactive knowledge graph

**Not the same thing as `architecture/dependency-graph.md`** (prose, what depends
on what) **or `indexes/knowledge-map.json`** (machine-readable, not visual). This
is the one with nodes, colors, and clusters you look at in a browser.

```bash
node agent-brain-tool/bin/brain graph .    # writes .brain/graph.html
```

Then open the resulting graph.html directly — no server, no build step. Nodes are
`.brain` documents, colored by type and clustered by hop-distance from this
routing table; click one for its frontmatter. It reads `indexes/knowledge-map.json`,
so re-run `node agent-brain-tool/bin/brain index .` first if the graph looks stale.

Gitignored, like `.scan/` — regenerate it whenever you want to look, don't expect
it to already be there after a fresh clone.

---

## How to use it

Load in layers: **summary → documentation → source.** Never source first.

1. `/CLAUDE.md` — what this repo is, and where everything lives
2. The one `.brain` document the routing table points at
3. The L3 docs or L4 code that document names

If you find yourself grepping the repository, the routing table is missing an
entry. That is a bug in this knowledge base — fix the table.

---

## Rules

- **Facts live once.** Duplication is a defect, not redundancy.
- **Frontmatter is mandatory** — it is what makes this a graph. See
  `governance/documentation-standards.md`.
- **Budgets are enforced** by `brain verify`.
- **Nothing is deleted, only archived**, with provenance.
- **Indexes are generated.** Hand-editing them creates a second source of truth
  that silently disagrees with the documents it came from.
- **Commit this directory.** Everything under `.brain/` except `.scan/` and the
  `brain graph` visualization (see `.brain/.gitignore`) is reviewable markdown
  meant to be checked into version control and shared across the team — the
  same as any other documentation. Do not add `.brain/` itself to your repo's
  root `.gitignore`; that would silently turn a shared knowledge base into a
  local-only one no teammate or CI run ever sees.

---

## Keeping it true

```bash
node agent-brain-tool/bin/brain verify . --strict    # CI gate
node agent-brain-tool/bin/brain index .              # regenerate indexes
```

Change code that a document names in `sources:` → update that document in the
same change. See `governance/contribution-protocol.md`.

This system does not fail at installation. It fails at month four, when the code
has moved and the summaries have not. A CI gate on `brain verify --strict` is what
prevents that — check `governance/contribution-protocol.md`'s CI gate section for
whether one is actually wired in this repo yet, not assumed.
