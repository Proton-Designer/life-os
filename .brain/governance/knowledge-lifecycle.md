---
id: gov.knowledge-lifecycle
title: Knowledge Lifecycle
layer: L2
type: governance
status: canonical
owner: unassigned
updated: 2026-09-13
answers:
  - "when should a document be archived"
  - "how often is knowledge reviewed"
  - "what do I do about a drifted document"
covers: "Review cadence, drift handling, archiving and deletion rules"
excludes: "What to update on a code change (see gov.contribution-protocol), authoring/frontmatter rules (see gov.documentation-standards)"
tokens_est: 1416
---

# Knowledge Lifecycle

```
created → canonical → (drift detected) → verified or updated
                    → superseded → archived (L5)
```

Nothing is deleted. Superseded knowledge is archived with provenance, because an
archive is what makes consolidation reversible — and this repo already practices
that instinct outside `.brain`: the standing rule in `docs/superpowers/` is to
leave orphaned code in place and flag it rather than delete it on suspicion (see
`.brain/memory/known-issues.md`). This file applies the same discipline to
documentation.

---

## Creating

New knowledge needs a home before it is written (`documentation-standards.md`),
valid frontmatter, and a routing entry. A document nothing routes to is
maintenance cost with no return.

This repo's own convention for dated research (`docs/superpowers/{specs,notes,
plans}/YYYY-MM-DD-*.md`) stays where it is — `.brain/` does not absorb it. See
"What .brain does not replace" below.

## Reviewing

| Document | Cadence |
|---|---|
| `.brain/memory/active-work.md` | Weekly — fastest-rotting file in the system |
| Domain summaries (`.brain/domains/`) | On drift, or quarterly |
| Architecture (`.brain/architecture/`) | Quarterly, or on structural change (new domain, new nav mode, schema shift) |
| `.brain/memory/known-issues.md` | Monthly — prune what is resolved |
| `.brain/memory/decisions.md` | Never rewritten; append-only |

Review = verify against reality, then update `updated:`. A date bumped without
re-reading is worse than a stale date — this repo's own `docs/ai-connector/
PROGRAM-PLAN.md` shows the failure mode: it asserted the `mcp_widgets.kind`
CHECK constraint only admitted two kinds, which stayed true right up until
migration 149 widened it — after which the claim quietly went stale and nobody
had a mechanism to notice.

## Drift

**There is no `brain verify --strict` CI gate in this repo** — there is no CI at
all (no `.github/`). Drift detection here is currently a manual discipline: run
`node agent-brain-tool/bin/brain verify . --strict` yourself before trusting a
`.brain/` document, especially in a domain you know has moved recently.

On a drift flag or a suspected-stale document:
1. Read the document and the changed code (or migration) it names in `sources:`.
2. Still accurate → bump `updated:`.
3. Partially wrong → fix the wrong parts.
4. Fundamentally wrong → rewrite, and archive the old version if it described a
   design worth remembering.

Never suppress a drift flag without doing step 1.

## Archiving

Archive when a document is superseded, or describes something that no longer
exists but is worth remembering. Requires a full provenance header
(`origin_path`, `archived_reason`, `superseded_by`, `retained_because`) — see
`.brain/archive/README.md`.

`retained_because` is the test. If no credible sentence can be written for it,
it is a `Delete` candidate and belongs in front of a human — currently that
means Ayman (see `.brain/governance/ownership.md`) — not quietly parked in the
archive.

## What `.brain` does not replace

This repo has an existing, deliberate documentation layer that predates this
install and stays exactly where it is:

- `docs/superpowers/{specs,notes,plans}/` — dated research and design records.
  Several are cross-referenced **by filename** from live code comments and
  migration headers (e.g. `supabase/migrations/149_mcp_widgets_kind_widen.sql`
  cites the reasoning behind it in prose). Moving or renaming these breaks a
  reference a human would have to re-find by hand. `.brain/memory/decisions.md`
  points *into* this layer; it does not duplicate it.
- `context/ARCHITECTURE.md`, `docs/REPO-MAP.md` — this repo's own canonical
  architecture and file-map documents. `.brain/architecture/*.md` are written as
  compressed pointers into these, never as a second version of the same content.

## Deleting

Rare, and it requires: no unique content, a retained copy or recoverable git
history, and a recorded reason. When torn between delete and archive, archive —
the costs are wildly asymmetric.

## Ownership of the lifecycle

Per `.brain/governance/ownership.md`, this repo has no formal doc-ownership
structure. Until that changes:

| Role | Responsibility |
|---|---|
| Whoever is acting as session "Lead" | Reviews on cadence; responds to drift flags during their session |
| Anyone changing code | Updates the summary in the same change (see `gov.contribution-protocol`) |
| Ayman | Final call on anything genuinely ambiguous or destructive |
| Agents (any session) | Record decisions, traps, and dead ends as they work |
