---
id: gov.tool-output-policy
title: Tool Output Policy
layer: L2
type: governance
status: canonical
owner: unassigned
updated: 2026-09-13
answers:
  - "how do I keep tool output from flooding context"
  - "what commands are safe to run"
covers: "Token-expensive commands, safe defaults, destructive-command rules, containment-tool interaction"
excludes: "Which containment tools are actually enabled here (see tool.optimization-registry)"
tokens_est: 1124
---

# Tool Output Policy

Tool output is one of the four token sinks. This repo has ~75 markdown docs, a
77-table schema, and 42+ scripts under `scripts/` — an unscoped command here
gets expensive fast.

---

## The rule

> **Scope the command before you run it. Filter at the source, not after.**

---

## Expensive commands here

| Instead of | Run | Why |
|---|---|---|
| `npm test` (full suite) | `npm test -- <path>` | this repo's Vitest suite spans dozens of `__tests__/` directories under `lib/`, `components/`, `app/` — scope to the domain you're touching |
| `npm run test:e2e` (full Playwright run) | scope to the spec you need, and see "Ask first" below | `scripts/loop-e2e-walk.sh` exists because concurrent Playwright runs have corrupted shared fixtures before — this suite is serialized for a reason |
| `git log` | `git log --oneline -20` | unbounded history |
| `git diff` | `git diff --stat` first, then scoped | whole-diff floods context |
| `ls -R` / crawling `docs/superpowers/` | `docs/REPO-MAP.md`, `REPOSITORY_MAP.md` | the map exists precisely for this |
| `grep -r <term> .` | `.brain/indexes/symbol-index.json` (after `brain index` has been run) | free and instant once generated |
| `cat supabase/migrations/*.sql` | read the specific migration by number (`supabase/migrations/ALLOCATIONS.md` names it) | 149+ migrations, most irrelevant to any one question |

---

## Destructive or expensive — ask first

| Command | Why |
|---|---|
| `scripts/deploy-prod.sh` | Deploys to production. Per this repo's own convention, only the session's "Lead" role runs this — never a filtered or partial run (see `.brain/governance/ownership.md`). |
| `scripts/apply-migration.sh` | Mutates the live Postgres schema. Migration numbers are hand-allocated in `supabase/migrations/ALLOCATIONS.md` — do not self-number. |
| `scripts/fresh-start-wipe.sh` | Destroys local data. Irreversible on the machine it runs on. |
| `npm run test:e2e` (full run) | ~loop-e2e-walk.sh territory — session-serialized, Lead-only by convention, hits a real Supabase project. |
| Anything touching `supabase/migrations/ALLOCATIONS.md` | This is the coordination ledger across concurrent agent sessions (see `.brain/governance/ownership.md`) — a collision here is a real incident, not a merge conflict. |

---

## Principles

**Prefer an index to a search.** If you are grepping for a symbol, use
`.brain/indexes/symbol-index.json` once it exists. If you are looking for a
file, use `REPOSITORY_MAP.md` or `docs/REPO-MAP.md`.

**Read ranges, not files.** When a document names `service.ts:120`, read around
line 120 — several docs in this repo (e.g. the `docs/ai-connector/SCHOOL-UPDATED-AT-NEEDED.md` family)
already cite exact function names for this reason.

**One command, one question.**

**Report output, do not paste it.** Summarize the result; quote only the lines
that carry the finding. Exception: verification evidence for a ruling like
acceptance-criterion 5 in `docs/superpowers/specs/2026-08-19-missed-lockin-hours.md`
("prove it with real numbers... green assertions alone are not enough here") —
where the actual numbers are the point.

---

## If a containment tool is enabled

Check `.brain/tooling/optimization-registry.md` first. As of this install,
**nothing is enabled** — this repo runs with no ambient containment tooling.
The rules above are current discipline, not backstopped by a tool.

<!-- If that ever changes, this section should record: parse JSON not prose
     from `brain verify --strict --json`; never `cat` a `.brain/` doc through a
     hooked shell. -->
