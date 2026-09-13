---
id: meta.agents-readme
title: Agents (Reserved)
layer: L2
type: meta
status: canonical
owner: unassigned
updated: 2026-09-13
covers: "Why agent role definitions aren't installed, what's preserved from existing agent configs"
excludes: "Who owns which area of the codebase (see gov.ownership)"
tokens_est: 617
---

# `.brain/agents/` — Reserved

**This directory is intentionally empty.**

Agent-Brain does not install agent role definitions. No planner, coding, review,
security, or infrastructure agent templates ship with this release.

## Why

How a team divides work between agents depends on its workflow, its review
culture, and its risk posture. Those are not derivable from a repository scan,
and a scaffold that guesses at them produces files that:

- nobody asked for,
- drift immediately because nothing enforces them,
- and must first be understood in order to be deleted.

**Empty structure is cheaper to adopt than wrong structure.** The directory exists
so the layout is stable when specialization lands, and so anything you put here
is already routable.

## What is preserved

If your repository already had agent definitions — .claude/agents/, a
.cursorrules file, custom subagent configs — the install **discovered and
preserved them where they were**. Agent-Brain did not reshape them into roles it
invented. If anything was moved as part of the install, it is recorded in the
migration log along with why.

## Using this directory now

You are free to define your own agents here. If you do:

- One file per agent, following this repo's frontmatter conventions (see
  `.brain/governance/documentation-standards.md`) with `type: agent`.
- Give each agent a **narrow knowledge scope** — which `.brain` documents it
  loads, and which it should not. That scoping is the entire point of
  specialization; an agent that loads everything is not specialized, it is just
  expensive.
- Add a routing entry so `brain verify` does not flag the file as an orphan.

## Coming later

Agent specialization is a planned Agent-Brain phase: role definitions, per-role
knowledge scoping, handoff protocols, and multi-agent collaboration patterns.
Until then this directory stays reserved rather than pre-filled.
