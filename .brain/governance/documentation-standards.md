---
id: gov.documentation-standards
title: Documentation Standards
layer: L2
type: governance
status: canonical
owner: unassigned
updated: 2026-09-13
answers:
  - "how do I write a .brain document"
  - "where does this piece of knowledge belong"
  - "what frontmatter is required"
covers: "Where knowledge belongs by layer, frontmatter schema, writing and review rules — for this repository specifically"
excludes: "When to update a doc after a code change (see gov.contribution-protocol); when a doc retires (see gov.knowledge-lifecycle)"
tokens_est: 1160
---

# Documentation Standards

## Where knowledge belongs in THIS repo

| Knowledge | Goes in |
|---|---|
| What this repo is; where to find things | root `CLAUDE.md` (L1) |
| Full technical conventions (routing, RSC boundary rule, timezone rule, RLS patterns, deploy) | `context/ARCHITECTURE.md` — this repo's own canonical L3 doc, kept as the detail layer rather than duplicated into `.brain/architecture/` |
| Product intent / design philosophy | `context/PURPOSE-AND-DOMAINS.md` |
| System structure at a glance | `.brain/architecture/` (compressed, points at `context/ARCHITECTURE.md` for detail) |
| How a business capability works | `.brain/domains/` |
| Why something was decided | `.brain/memory/decisions.md` |
| What is broken or trap-laden | `.brain/memory/known-issues.md` |
| What failed and was abandoned | `.brain/memory/lessons.md` |
| What is in flight | `.brain/memory/active-work.md` |
| Commands, services, integrations | `.brain/tooling/` |
| Design rationale for a shipped feature, dated | `docs/superpowers/{specs,plans,research,notes,briefs}/` (L3, mostly Historical — see `.brain/archive/README.md` for classification) |
| The AI-connector program's own working record | `docs/ai-connector/` — deliberately left as its own subsystem-owner's L3 doc set, not folded into `.brain/domains/mcp-connector.md`, which points at it |
| Superseded knowledge | `.brain/archive/` (L5) |

**This repo already has a strong L3 layer** (`context/`, `docs/ai-connector/`, `docs/REPO-MAP.md`). `.brain/` was built to add the **L2 layer this repo lacked** — compressed, cross-referenced domain/architecture summaries — not to replace or duplicate what already existed. Where a `.brain` document and an existing repo doc could both claim a fact, the `.brain` document routes to the existing one rather than restating it.

## Frontmatter

Mandatory on every `.brain` document: `id`, `title`, `layer`, `type`, `status`, `owner`, `updated`. Expected on L2: `sources`, `related`, `answers`. Required on domain docs: `covers`, `excludes`. Machine-owned, never hand-edit: `source_hash`, `tokens_est`. Full spec: the Agent-Brain project's frontmatter specification, gitignored copy at agent-brain-tool/standards/frontmatter-spec.md in this repo (not tracked — see `.brain/tooling/registry.md`).

## Writing rules

- Budgets are hard, enforced by `brain verify`: domains 150 lines, architecture/root-CLAUDE.md-adjacent files 250 lines, governance/tooling files 150-200 lines, root `CLAUDE.md` 150 lines, `AGENTS.md` 80 lines.
- Every domain doc states its `excludes` boundary explicitly.
- Anything inferred from structure rather than confirmed in code is labeled inline ("inferred, unverified") — several documents in this install carry an explicit **Unverified** section for exactly this reason; check it before trusting a borderline claim.
- Real paths only — every path referenced must exist (`brain verify` checks this).
- Numbers carry their method: a token or row-count figure is either a direct read (state as such) or an estimate (±15%, state as such). Several documents in this repo (e.g. table counts, migration counts) are known to drift within days — treat any bare number as a claim with a date on it, per `context/ARCHITECTURE.md`'s own stated practice.

## Reviewing

Reviewing means verifying against reality, then updating `updated:`. A bumped date without a re-read launders staleness as freshness.

## Checks

```bash
node <path-to-your-agent-brain-clone>/bin/brain verify . --strict
```

See `.brain/tooling/registry.md` for how to resolve `<path-to-your-agent-brain-clone>` in this environment.
