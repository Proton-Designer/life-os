---
id: ctx.product
title: Product Context
layer: L2
type: map
status: canonical
owner: unassigned
updated: 2026-09-13
answers:
  - "what does this product do"
  - "who uses this"
  - "what are we optimizing for"
covers: "What the product does, who uses it, business constraints, domain vocabulary"
excludes: "Engineering conventions (see gov.ownership, root AGENTS.md), technical architecture (see arch.system-overview)"
tokens_est: 1306
---

# Product Context

## What it is

Life OS is a multi-tenant personal-operating-system app: it helps a person run
their day across the life areas they choose — faith, work, school, fitness,
learning, business. Its stated thesis, per this repo's own docs: most tracking
tools **record well and decide poorly**, so most of the product is built to
answer *what should I do right now*, not *what happened*. It is a commercial
product formed by merging three previously separate codebases into one:
the original single-user "Life OS," **CollegeOS** (a school/study-manager
vision), and **ULM** ("Universal Learning Machine" — book ingestion + spaced
repetition), now shipped as the "Self-Mastery" feature.

## Who uses it

| User type | What they use it for | Evidence |
|---|---|---|
| The product owner (Ayman) | Real daily personal use, legacy navigation mode | `.brain/governance/ownership.md` |
| Open signups | Anyone — signup is open, no allowlist | `app/signup/actions.ts`; `.brain/architecture/system-overview.md` |
| External AI clients (Claude/ChatGPT/Gemini) | Read/write real account data via the MCP connector | `.brain/domains/mcp-connector.md` |

As of the most recent evidence gathered, this is still an early-stage product —
real production accounts exist and multi-tenancy is real and enforced, but the
scale is small (per `.brain/architecture/system-overview.md`) and there is no
formal customer base described in any document reviewed during this install.

## What we optimize for

- **Deciding over recording** — nearly every domain (Home, Business/Lock-In,
  Evening Close) is built to surface one next action, not a dashboard of history.
  Analytics/history is deliberately isolated to the Insights domain instead.
- **Subtraction over volume**, in Business/Lock-In specifically — a deliberate
  product ruling (`.brain/memory/decisions.md`, 2026-08-18) rejected "more hours"
  as the lever in favor of a hard 3-item daily Kill List cap, on the evidence
  that the operators studied all *practiced* subtraction even when they
  preached the opposite.
- **Multi-tenant correctness by construction** — RLS on every table plus
  composite tenancy foreign keys, not just app-layer checks (see
  `.brain/architecture/system-overview.md`).

## What we deliberately do not do

- **No automated fiqh/prayer-shortening logic** — left to manual judgment;
  considered too easy to get subtly and invisibly wrong by automating
  (`context/PURPOSE-AND-DOMAINS.md`).
- **No social or sharing features** — absence, not a ruling; multi-user
  *account* isolation is real, but there is no cross-account sharing feature.
- **CollegeOS's full vision is not being built wholesale** — per the
  2026-09-13 three-app audit (`docs/audits/2026-09-13-three-app-feature-audit.md`),
  only the grade engine, risk engine, and a capture parser have actually been
  ported; the Hour/Night-Plan ritual, Habits, Question Bank, Canvas and Lecture
  Capture remain unbuilt or vision-only.

## Domain vocabulary

| Term | Means |
|---|---|
| **Legacy mode** vs. **domains mode** | The two separately-maintained navigation paths — see `.brain/domains/settings-onboarding.md`. Not a version number; both are live simultaneously today. |
| **Signal:Noise** | The Business/Lock-In ratio classifying check-ins as productive signal vs. distraction noise. |
| **Kill List** | The 3-item daily task cap in Business/Lock-In — a deliberate constraint, not a UI limitation. |
| **Lock-In session** | A deep-work or deep-study timed session (`deep_work` \| `deep_study` \| `learn`). |
| **Domain** (in this codebase's own sense) | A business capability with a `.brain/domains/*.md` summary — not to be confused with `user_domains` (the onboarding vocabulary table) or a network domain. |

## Constraints from the business

- **Migration numbers are hand-allocated**, never self-numbered — see
  `supabase/migrations/ALLOCATIONS.md` and `.brain/tooling/registry.md`.
- **Production deploys and the full Playwright suite are session-"Lead"-role-only**,
  a standing operational rule, not a suggestion — see `.brain/governance/ownership.md`.
- **No CI exists yet** — verification (`brain verify`, `tsc`, `vitest`,
  `preflight.sh`) is currently a manual discipline, not an enforced gate.
