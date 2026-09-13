---
id: gov.ownership
title: Ownership
layer: L2
type: governance
status: canonical
owner: unassigned
updated: 2026-09-13
answers:
  - "who owns this service"
  - "who do I ask about a domain"
  - "what does 'Lead' mean in this repo's docs"
covers: "Ownership by area, what's genuinely unknown, the escalation path for unowned things"
excludes: "Engineering conventions (see COMPANY_CONTEXT.md); per-domain code paths (see .brain/domains/)"
tokens_est: 961
---

# Ownership

**Recorded from this install's research pass, not guessed from git blame.** Ownership in this repository is informal — there is no CODEOWNERS file, no per-agent role config, and no per-domain team assignment anywhere in the codebase. What follows is what could actually be determined; gaps are marked `unassigned` deliberately, not filled with a plausible guess.

## People (confirmed)

| Person | Role | Evidence |
|---|---|---|
| Ayman (`ayman.0704m@gmail.com`) | Product owner, sole real daily user (legacy-mode account), source of nearly every product requirement quoted verbatim across `docs/superpowers/` | CLAUDE.md, most specs are addressed to or quote him directly |
| Kareem Badawi (`kareem.badawi24@gmail.com`) | A second real human account, legacy mode, zero data rows | CLAUDE.md; role beyond this is undocumented |
| Garrison (`garrisonmcilveen@scout-ai.co`) | Commissioned the AI-connector/MCP program specifically | `docs/superpowers/specs/2026-09-09-ai-integration-handoff.md`: "written... at Garrison's request... not yet reviewed or ruled on by Ayman" |

## Session-scoped agent roles (informal, not accounts)

The codebase's own docs describe work happening through named, session-scoped agent roles rather than persistent team members: **"Opus Lead"** (architecture/orchestration, owns deploys, the *only* one who runs the full Playwright suite), **"Sonnet Engineer" / "Engineer 1/2/3"** (implementation), and PID-tagged identifiers in `supabase/migrations/ALLOCATIONS.md` (e.g. "LifeOS Eng 1 (54590)", "ULM lead (42335)", "CollegeOS / B1"). These are **not** config — no file defines them; they exist only as prose in commit messages, status boards, and the allocation ledger, used because multiple concurrent agents share one working tree and need *some* way to distinguish themselves.

**Genuinely unknown — do not guess:**
- Whether these role labels map to distinct human-supervised sessions, distinct model tiers, or something else.
- What "CollegeOS / B1" is (a separate codebase/product referenced in the migration ledger — see `.brain/memory/known-issues.md`).
- Whether Kareem Badawi or Garrison have any ongoing authority over this repo's direction versus a one-time role.

## By area

| Area | Owner |
|---|---|
| Every domain in `.brain/domains/` | `unassigned` — no team/person mapping exists |
| Migration-number allocation | Whoever holds the "Lead" role for a given session (see `supabase/migrations/ALLOCATIONS.md`) |
| Production deploys | The session's "Lead" role only (never a filtered/partial run) |
| The full Playwright e2e suite | The session's "Lead" role only — a hard rule, not a preference (concurrent runs have corrupted shared fixtures twice) |

## Escalation

There is no formal escalation path recorded. In practice, per the specs read during this install, product decisions route to Ayman; the AI-connector program's decisions route through whoever is acting as "Lead" for that session, with final product sign-off from Ayman.
