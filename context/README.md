# Context — start here

This folder exists so that an agent or agent-team joining this project can get
oriented in one sitting, without excavating `PROJECT_STATUS.md` (333K of
append-only build log) or reverse-engineering intent from the code.

**Read in this order.**

| # | Document | What it answers | Read it when |
|---|---|---|---|
| 1 | `PURPOSE-AND-DOMAINS.md` | What Life OS is for, who it serves, what each domain is trying to change, what the app treats as success | Always. Read this before touching anything. |
| 2 | `ARCHITECTURE.md` | Stack, directory map, routing, the data layer, and the conventions that aren't optional | Before writing code. |
| 3 | `RECENT-CHANGES.md` | Where the code stands today, what changed recently and why, what's known-broken, what's dead | Before picking up work, and before believing anything is still true. |
| 4 | `Life OS — Complete Feature Guide.docx` | Every screen and feature in plain language, no technical detail | When you need to know how a feature actually behaves for the user. |

If you read only one thing, read #1. The most expensive mistakes made in this
repo have not been bad code — they have been locally-reasonable changes that
were wrong for the product.

## Also read, outside this folder

- **`AGENTS.md`** (repo root) — the hard rules, deliberately not summarized away
  here. Every rule in it was written after the same mistake was made twice.
- **`docs/superpowers/specs/`** — dated design intent. Read chronologically it
  is a decision log, not a feature list; later specs revise earlier ones.
- **`docs/DEPLOYING.md`** — the deploy procedure. `vercel deploy` ships the
  working directory, not the commit. That document explains what to do instead.

## What these documents are not

They are not generated, and they are not authoritative over the code. They were
written by reading the repo, and each carries the date it was written. Where a
document and the code disagree, **the code is right** — and the document is a
bug worth fixing.

Two habits, if you work here:

- **Verify before you rely.** A directory listing describes the repo, not the
  app. Of the modules sitting in `components/home/`, fewer than half render.
  Anything here that names a file, an action, or a bug is a claim with a date on
  it — check it still holds before you build on it.
- **Update `RECENT-CHANGES.md`.** It is the one document written to be appended
  to: dated sections, newest first, with an "as of" line at the top. The other
  three change slowly. That one goes stale in weeks, and a stale handoff doc is
  worse than none, because it gets trusted.
