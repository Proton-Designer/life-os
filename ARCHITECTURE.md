# Architecture

> **This file is a pointer, not a copy.**
>
> The canonical architecture lives in
> **[`.brain/architecture/system-overview.md`](.brain/architecture/system-overview.md)**.

<!--
AGENT-BRAIN TEMPLATE — root ARCHITECTURE.md

WHY THIS FILE IS ALMOST EMPTY:

`ARCHITECTURE.md` at the repo root is where humans, GitHub, and many tools look
by convention. So it must exist. But duplicating the architecture into it creates
two sources of truth for the most-read technical content in the repository, and
they will disagree within a quarter — a direct violation of Principle 3.

So: this file points. It does not explain.

IF THE REPO ALREADY HAD A GOOD ARCHITECTURE.md:
Phase 02 will have classified it Canonical. In that case do NOT replace it with
this stub — keep it, add frontmatter, and have .brain/architecture/system-overview.md
reference IT. Direction of reference matters far less than there being exactly one
source.

Delete this comment block before shipping.
-->

| Topic | Document |
|---|---|
| System overview, components, boundaries | `.brain/architecture/system-overview.md` |
| Component and service dependencies | `.brain/architecture/dependency-graph.md` |
| Service catalogue | `.brain/architecture/service-map.md` |
| Data flows | `.brain/architecture/data-flows.md` |
| Where code lives | `REPOSITORY_MAP.md` |
| Why the architecture is this way | `.brain/memory/decisions.md` |
