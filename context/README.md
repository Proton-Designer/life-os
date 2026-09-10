# Context — orientation docs

**Updated 2026-09-10.**

This folder exists so an agent joining this project gets oriented in one sitting,
without excavating `PROJECT_STATUS.md` (333K of frozen build log) or reverse-engineering
intent from the code.

**Start at `CLAUDE.md` in the repo root, not here.** It is the entry point: what the
project is now, who uses it, and the one structural fact (legacy vs domains mode) that
explains most of the codebase. Then `docs/REPO-MAP.md` for where things live. This
folder is the layer beneath both.

**Read in this order.**

| # | Document | What it answers | Read it when |
|---|---|---|---|
| 1 | `PURPOSE-AND-DOMAINS.md` | What Life OS is for, who it serves, what each area is trying to change, what the app treats as success | Always. Read this before touching anything. |
| 2 | `ARCHITECTURE.md` | Stack, directory map, routing, the data layer, and the conventions that aren't optional | Before writing code. |
| 3 | `RECENT-CHANGES.md` | Where the code stands today, what changed recently and why, what's known-broken | Before picking up work, and before believing anything is still true. |

If you read only one thing, read #1. The most expensive mistakes made in this repo have
not been bad code — they have been locally-reasonable changes that were wrong for the
product, or changes built on a confident, stale description of it.

## A specific warning about this folder's own history

The 2026-08-31 version of `PURPOSE-AND-DOMAINS.md` stated that Life OS was single-user
by decision and that "what if someone else logs in?" was *the wrong question*. It was
true when written and false within a day. Because it was stated forcefully, every agent
that read it formed a wrong model of the project — for over a week. That is the failure
mode this folder is most prone to: **a confident description outliving what it
describes.** Every claim here now carries a date; treat the date as an expiry stamp, and
verify against the schema and the code before building on it.

## Also read, outside this folder

- **`CLAUDE.md`** (repo root) — the entry point. Read first.
- **`AGENTS.md`** (repo root) — the hard rules, deliberately not summarized away here.
  Every rule in it was written after the same mistake was made twice.
- **`docs/REPO-MAP.md`** — routes, `lib/` responsibilities, scripts, and a status
  verdict on every documentation file in the repo.
- **`docs/ai-connector/`** — the MCP/AI-connector program's own record. Current and
  accurate; it is the newest and largest subsystem.
- **`supabase/migrations/ALLOCATIONS.md`** — the authoritative migration ledger, and
  the reasoning behind individual schema decisions. Append-only.
- **`docs/superpowers/specs/`** — dated design intent. Read chronologically it is a
  decision log, not a feature list; later specs revise earlier ones. **Its August files
  describe a nine-screen single-user shell that no longer exists.**
- **`docs/DEPLOYING.md`** — the deploy procedure and its traps. `vercel deploy` ships
  the working directory, not the commit; `scripts/deploy-prod.sh` now automates the
  correct method.

## Documents in this folder that are stale, and stay only as history

- **`Life OS — Complete Feature Guide.docx`** (2026-08-29). A screen-by-screen
  behavioural guide, written before the 2026-09-01 convergence added onboarding, the
  four-tab domains nav, `/personal/*`, `/work/[subdomain]`, `/close` and `/open`. It is
  accurate for the **legacy shell** — which the owner's own account still uses — and
  silent on everything after. It was previously listed here as "the behavioural ground
  truth for what the app currently does." It is not, and that line has been removed.

## What these documents are not

They are not generated, and they are not authoritative over the code. They were written
by reading the repo, and each carries the date it was written. Where a document and the
code disagree, **the code is right** — and the document is a bug worth fixing.

Two habits, if you work here:

- **Verify before you rely.** A directory listing describes the repo, not the app. Both
  `lib/` and `components/` carry dead files from superseded designs; a route existing is
  not evidence a user can reach it (`/open` has no link anywhere). Anything here that
  names a file, an action, or a bug is a claim with a date on it.
- **Update `RECENT-CHANGES.md`.** It is the one document written to be appended to:
  dated sections, newest first, with an "as of" line at the top. The other two change
  slowly. That one goes stale in weeks, and a stale handoff doc is worse than none,
  because it gets trusted.
