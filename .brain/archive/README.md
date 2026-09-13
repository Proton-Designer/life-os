---
id: meta.archive-readme
title: Archive
layer: L2
type: meta
status: canonical
owner: unassigned
updated: 2026-09-13
answers:
  - "where did the old documentation go"
  - "what did this used to look like"
covers: "Why documents get archived, the rules for L5 content, what's currently archived"
excludes: "Whether a specific document should be archived now (see gov.knowledge-lifecycle)"
tokens_est: 678
---

# `.brain/archive/` — L5 Historical

Superseded knowledge. Preserved, not deleted.

## Why this exists

Aggressive consolidation is only safe if it is reversible. Without an archive,
every merge is a one-way bet — so the rational response is to consolidate
nothing, and the corpus rots instead.

With an archive, consolidation is reversible, and the archive answers "why did we
change this?" months later, when the reasoning is no longer in anyone's head.

## Rules

**Every file carries a provenance header.** No exceptions:

```yaml
---
id: archive.YYYY-MM-DD.slug
layer: L5
type: archive
status: archived
archived_on: YYYY-MM-DD
origin_path: docs/old/thing.md
archived_reason: "Why it was superseded"
superseded_by: arch.system-overview
retained_because: "Why a future reader would want this"
---
```

`retained_because` is what separates an archive from a junk drawer. If no credible
sentence can be written for it, the file should have been classified `Delete` and
taken back to the operator — not quietly parked here.

**Archived content is never cited as current.** These documents describe a past
state. They are exempt from drift detection because drifting from current code is
exactly what they are supposed to do.

**Never edit an archived file.** It is a snapshot. Editing it destroys the only
thing it was kept for.

## Contents

| Archived | Document | Origin | Superseded by |
|---|---|---|---|
| 2026-09-13 | [Root CLAUDE.md (pre-Agent-Brain version)](2026-09-13.root-claude-md-v1.md) | `CLAUDE.md` | arch.system-overview |
| 2026-09-13 | [Root AGENTS.md (pre-Agent-Brain version)](2026-09-13.root-agents-md-v1.md) | `AGENTS.md` | gov.tool-output-policy |
| 2026-09-13 | [Life OS — Complete Feature Guide.docx](context/life-os-complete-feature-guide.docx.PROVENANCE.md) | `context/Life OS — Complete Feature Guide.docx` | domain.settings-onboarding |

<!-- Regenerate this table when archiving. It is the index that makes L5
     reachable — an archive nothing points at is indistinguishable from deleted. -->
