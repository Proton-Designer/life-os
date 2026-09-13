---
id: meta.indexes-readme
title: Indexes
layer: L2
type: meta
status: canonical
owner: unassigned
updated: 2026-09-13
answers:
  - "what are the indexes for"
  - "where is symbol X defined"
  - "can I edit the index files"
covers: "What each generated index file is for, how to regenerate, why not to hand-edit"
excludes: "How to write the .brain documents the indexes are built from (see gov.documentation-standards)"
tokens_est: 779
---

# `.brain/indexes/`

**Generated. Never hand-edit.**

These are how *navigation over search* becomes operational: they turn "find the
code" from a repository scan into a lookup.

---

## The files

| Index | Answers |
|---|---|
| `knowledge-map.json` | "Which document covers X?" — nodes, edges, compiled routes, reachability |
| `service-index.json` | "Where is the orders service, and who owns it?" |
| `symbol-index.json` | "Where is `createInvoice` defined?" → `file:line` |
| `dependency-index.json` | "What breaks if I change this?" — plus cycles and boundary violations |
| `doc-index.json` | "What knowledge exists?" — every `.brain` doc with layer, budget, drift status |

Schemas: the Agent-Brain project's index specification (not installed in this repo — the table above is what applies here).

---

## Regenerating

```bash
node agent-brain-tool/bin/brain index .
```

Run after any `.brain` change and in CI. An index that lags the code sends agents
to the wrong place *with full confidence* — worse than sending them nowhere.

---

## Why you must not hand-edit these

A hand-edited index becomes a **second source of truth** that silently disagrees
with the documents it was derived from. Nothing will flag the divergence, and the
index looks authoritative, so the wrong value wins.

If an index is wrong, the fix is in the source it came from — the document's
frontmatter, or the code — and then regenerate.

---

## Known limitations

`symbol-index.json` and `dependency-index.json` are **regex-derived**. They miss
dynamically defined, re-exported, and metaprogrammed symbols, and dynamic imports.
Each file carries a `limitations` field stating this.

**Absence from an index is not evidence that something does not exist.** An agent
that treats a regex index as exhaustive will conclude a symbol is missing when it
simply was not matched — a confident wrong answer, which costs more than no
answer at all.

When an index and the code disagree, the code is right.

---

## Use before searching

| Instead of | Use |
|---|---|
| `grep -r "createInvoice"` | `symbol-index.json` |
| `find . -name "*service*"` | `service-index.json` |
| `ls -R` | `REPOSITORY_MAP.md` |

Reaching for `grep` in this repository usually means the routing table is missing
an entry. That is a bug in the knowledge base — fix the table, don't normalize
the search.
