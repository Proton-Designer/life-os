---
id: domain.work-coop
title: Work / Co-op
layer: L2
type: domain
status: canonical
owner: unassigned
updated: 2026-09-13
sources:
  - lib/coop/**
  - app/(app)/work/**
  - components/co-op/**
related:
  - domain.business-lockin
  - domain.home-arbiter
  - domain.mcp-connector
  - arch.system-overview
answers:
  - "how do work targets and the task pipeline work"
  - "why do work subdomains share one pipeline"
covers: "Job/freelance work: up to 3 live Targets, a per-target task pipeline, Deep Work/Deep Study Lock-In sessions"
excludes: "Lock-In session mechanics and Signal:Noise (see domain.business-lockin, they share work_sessions); School's separate task/schedule model (see domain.school)"
tokens_est: 1207
source_hash: 0297ae8b5ebc7b8d8e1f1ae67d737fe51b1d946aca3cf72571ed472979e140af
---

# Work / Co-op

## Purpose

Runs one person's job/freelance work as a bounded queue of up to 3 live "Targets" (deadline-bearing goals) plus stretch goals, a per-target task pipeline (Backlog→In Progress→Review→Complete, plus a detached Blocked state), and Deep Work/Deep Study focus sessions. Answers "what am I driving toward and what's next," not just hours logged.

## Key concepts

| Term | Means |
|---|---|
| Target | `coop_targets`; `position <= 3` **is** the "target" label (not a stored flag), 4+ is "stretch." Completing a target cascades everything below it up by one. |
| Task pipeline | `coop_tasks` — one table serves both the "Weekly Agenda" and the "pipeline board." Stages `backlog→in_progress→review→complete`, plus `blocked` as a detached status with `blocked_from` recording origin. |
| Blocked reason/since | Migration 148; optional, never backfilled/guessed — NULL on an old row means "not recorded," not missing data. |
| Work tabs | `user_subdomains` rows under the `work` `user_domains` row: stable `key` slug, editable `label`, `position` (first = default tab), `kind` job\|business. `/work` redirects to the first tab; a tab's kind picks its screen (business → the Business screen, job → the Work screen). The **data is still not scoped per tab** (T-0002/W4): same-kind tabs share one pipeline, shown by an on-screen note (`work-shared-data-note`). W1 `51932ef`, W1b `58b45a3`/`36a2734`. |

## Where the code lives

| What | Path | Notes |
|---|---|---|
| Core logic | `lib/coop/{targets,targets-core,tasks,tasks-core}.ts` | `*Core()` functions shared by cookie actions and MCP writes |
| Actions | `app/(app)/work/{targets-actions,tasks-actions,actions,subdomain-actions}.ts` | `subdomain-actions.ts` also has `saveWorkTabs` (one atomic upsert of label/position/archived only; keep ≥1 tab), `ensureBusinessWorkTab` (idempotent; also creates a job tab "Work" when the account has no active tab) and `refreshWorkViews`. Business/Work writers revalidate through `lib/work/revalidate-screens.ts` so `/work/<tab>` refreshes too |
| Entrypoint | `app/(app)/work/page.tsx` + `work-screen.tsx` | `page.tsx` is the wrapper (`lib/shell/work-tabs.ts` `workEntryTarget`: tabs → redirect to the first; zero tabs + a Work domain → screen **with** the tab bar; legacy → plain screen). The Work screen itself is `work-screen.tsx` (shared with job tabs) |
| Tabs | `app/(app)/work/[subdomain]/{layout,page}.tsx`, `components/shell/work-tabs-bar.tsx`, `components/business/business-page-content.tsx` | Layout renders the client tab bar + "Edit tabs" dialog (rename/reorder/remove/"Add a Business tab"; optimistic, reverts on failure); `/business` redirects to the Business tab when one exists; the SYSTEM nav drops its own Business link then |
| UI | `components/co-op/{pipeline-board,target-row,targets-strip,task-card,pipeline-context}.tsx` | Backs `/work`, not a `/co-op` route (naming mismatch, don't "fix") |

## How it works

A target requires a deadline; a stretch goal doesn't. New tasks default to `backlog` (agenda and pipeline share one data model). Advancing/retreating moves a task one stage; blocking detaches it (`blocked_from` remembers origin); unblocking restores and only re-stamps timestamps on a genuine transition (idempotent for MCP retries).

## Integration points

| Direction | With | Via |
|---|---|---|
| Depended on by | Home arbiter | `get-domain-pulse.ts` computes `co_op` pulse from `coop_tasks` completion, not due-date |
| Shares with | Business/Lock-In | `work_sessions`, the active-session cache, `work_session_objectives` |
| External | MCP connector | `work` domain, 3 entities (target, task, work_session); `removeTarget`/bulk delete deliberately not exposed |

## Constraints & gotchas

- **"Share one pipeline" is real and current**, confirmed verbatim in code with a dedicated test id — not aspirational.
- `coop_targets`/`coop_tasks` are deliberately kept separate from the shared `tasks` table (used by School) — merging would leave permanently-null columns on the other domain's rows.
- `blocked_since`/`blocked_reason` NULL on a pre-148 row is a **permanent, one-directional gap** — migration 148's header explicitly forbids backfilling a guessed timestamp, citing a prior corrective-migration incident that mis-dated 54/77 rows.
- `MAX_GOAL_MINUTES` (480, shared with Business Lock-In sessions) is a soft UI cap, not a DB constraint.

## Not covered here

- Lock-In session goal/objectives mechanics and Signal:Noise → `domain.business-lockin`
- School's shared `tasks` table usage → `domain.school`

## Unverified

- None outstanding at time of writing; all claims above were verified against code directly.
