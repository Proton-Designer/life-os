---
id: mem.lessons
title: Lessons
layer: L2
type: memory
status: canonical
owner: unassigned
updated: 2026-09-13
answers:
  - "has this been tried before"
  - "what went wrong last time"
  - "how reliable is automated dead-code detection here"
covers: "Approaches tried and abandoned, anti-patterns for this codebase"
excludes: "Why the current approach was chosen instead (see mem.decisions), current bugs (see mem.known-issues)"
tokens_est: 901
---

# Lessons

---

## 2026-08-18 — Automated dead-code detection produced both false negatives and a false positive; only hand-verification caught it

**Goal:** produce a trustworthy inventory of orphaned (unimported) components
before recommending any deletions.
**Approach:** an automated pass grepped for importers across the codebase.
**Outcome:** wrong in three distinct, non-overlapping ways, documented in
`docs/superpowers/notes/2026-08-18-orphaned-code.md`:
- **False negative, class 1:** the pass missed `export async function` as an
  export form entirely, and reported four genuinely live functions
  (`getHomeExtras`, `getWeeklyCompletion`, `getInsightsKpis`,
  `getCheckinOptions`) as dead.
- **False negative, class 2:** `lib/supabase/middleware.ts` was flagged dead
  because its only importer is `proxy.ts` at the repo root — outside the
  directories the pass searched. It is in fact the auth check on every
  request.
- **False positive:** `components/home/priority-list.tsx` was *missed* by the
  automated pass — three other files reference it only in comments, which
  looked like real imports to the tool but aren't. It is genuinely orphaned.
**Root cause:** grep-based import detection doesn't understand every export
syntax, doesn't follow imports from files outside its search scope, and can't
distinguish a comment mentioning a filename from a real import.
**Lesson:** a dead-code sweep in this codebase cannot be trusted to an
automated pass alone — every candidate must be hand-verified before being
proposed for deletion. This is exactly the discipline `install/playbooks/
deletion-protocol.md` (Agent-Brain project) already requires generically; this
is the concrete, repo-specific evidence for why it matters here.
**Would work if:** the tool were extended to cover every export form, search
the whole repo (not a directory subset), and ignore comment-only mentions — none
of which existed at the time of this finding. Re-verify by hand regardless.

---

## 2026-09-13 — check-fk-tenancy.sh (and every other psql-dependent check) was never runnable on this machine; the docs claimed it was enforcing

**Goal:** get `psql` working in the agent environment so the database-side
safety net (`check-rls.sh`, `check-fk-tenancy.sh`, `check-enum-drift.sh`,
`check-migrations-applied.sh`, `apply-migration.sh`) could run at all — it
had been blocked, silently, since these scripts were first written.
**Approach:** installed a real, official `psql 14` for aarch64 with no root,
by `apt-get download`ing the Ubuntu jammy `.deb`s for `postgresql-client-14`
and `libpq5` and extracting them with `dpkg-deb -x` into a userspace prefix
(`$HOME/.local/pgsql`) — every other runtime dependency (`libssl`, `libsasl2`,
`libldap`, `libkrb5*`) was already present on the base image. Then ran the
real scripts against live production for the first time.
**Outcome:** `check-fk-tenancy.sh` immediately reported 4 real, live,
unmitigated single-column FKs to user-scoped parents in the MCP tables
(`mcp_audit_log.token_id`, `mcp_oauth_refresh_tokens.access_token_id`,
`mcp_scheduled_actions.token_id`, `mcp_notification_dispatch_log.scheduled_action_id`)
— the exact cross-tenant-lockout exploit shape 058/086/100/101 exist to
close. `.brain/architecture/system-overview.md` asserted "zero single-column
FKs to user-scoped parents, enforced by `scripts/check-fk-tenancy.sh`" as of
2026-09-10. That sentence had been false since the MCP tables shipped
(migrations 130/132/142/145), and nobody could have known from running the
check, because the check could not run. Closed in migration 150, proven via
rollback-transaction before applying, applied, and `check-fk-tenancy.sh` now
reports 0 for the whole schema.
**Root cause:** the enforcement script existed, was correct, and was cited
in prose as an active guarantee — but its one dependency, `psql`, was never
installed on the machine actually running it, and a missing binary fails
with a shell error rather than a wrong answer, so nobody saw even that. A
tool that cannot run and a tool that has never been run both look identical
from the outside: silence. Nothing in CI or in the docs distinguished "this
invariant is checked and holds" from "this invariant is asserted and
unchecked."
**Lesson:** an enforcement mechanism that cannot run enforces nothing, and
looks identical to one that does. A hard-constraint doc claim of the form
"invariant X is enforced by script Y" is only as true as Y's last
successful, examined run on the environment that matters (here: production)
— recording that the check *exists* is not recording that it *ran*.
Whether a checking tool is actually executable, on the machine meant to
execute it, right now, is a fact worth checking on its own, separate from
whether the check's internal logic is sound (this incident found the logic
was fine — it caught real gaps the very first time it ran).
**Would work if:** `preflight.sh`, or the onboarding for a new agent
environment, verified `psql --version` succeeds before trusting any doc
claim gated on a DB check, the way it already verifies `tsc`/`vitest` exit
codes rather than trusting a piped `head`. The runbook for making `psql`
available on this environment now lives at `$HOME/.local/pgsql/env.sh` (see
`.brain/tooling/registry.md`); `source` it, don't reinvent it.

---

## 2026-09-19 — Fixing "write reports success on zero rows" the obvious way would have traded a truthfulness bug for an id-enumeration leak

P4-34: 16 MCP write actions ran `.update(patch).eq("id", id).eq("user_id",
userId)` and returned a cheerful `{id, updated_at}` whether or not any row
matched. A stale id, a typo, or **another tenant's id** all got "done."
Worse, it poisoned `mcp_audit_log`: the same id in the same account logged
`error / "No class found"` for a read and `ok / "edited class"` for an edit
— the audit record contradicted itself, so the log could not be used as an
oracle for what actually happened.

The obvious fix — read the row first, then update — is the wrong one. A
separate existence check is a *second* query, and unless it repeats the
tenancy scope exactly it can answer "that row exists, just not yours,"
which is an **id-enumeration oracle**. That is strictly worse than the bug
being fixed: false success wastes an agent's turn, enumeration leaks other
tenants' ids.
**What works:** chain `.select("id")` onto the update the action already
ran (`lib/mcp/require-row-updated.ts`), and throw `ToolNotFoundError` on
zero rows. The existence check *is* the scoped write, so "belongs to
someone else" and "does not exist" fail the identical query and return
byte-identical errors. No second question, nothing to leak.
**Two shapes this helper cannot fix**, and hand-rolling them is correct:
an INSERT (`confirmPlanSessionCore`) needs its check *before* the insert,
not wrapped around it; a DELETE whose zero-row result is ambiguous
(`retractHabitVoteCore` — "no such habit" vs "nothing to retract today")
needs a real existence read against the *other* table.
**Verifying it:** diff the two error messages byte-for-byte; do not
eyeball them. And prove the positive control first — a harness that errors
on everything is indistinguishable from a correct fix if you only ever
test bad ids.

---

## Patterns that do not work in this codebase

- **Treating a stated "practiced" claim from an external source as equally
  reliable as what that same person has demonstrably, repeatedly done.** The
  2026-08-18 business-brainstorm synthesis (see `mem.decisions`) found several
  widely-repeated productivity claims (Musk's "5-minute blocking," Hormozi's
  "backward calendar scheduling," "21 days to a habit") were folklore rather
  than the attributed person's own verified behavior. When sourcing product
  reasoning from outside research, verify the claim traces to the person's own
  repeated, demonstrated behavior — not a viral restatement.
- **Deciding "is this dead code?" from directory-scoped or comment-blind
  tooling alone in this repo.** See the lesson above.
- **Adding a standalone existence check in front of a tenancy-scoped
  write.** Chain `.select()` onto the write instead — see the 2026-09-19
  lesson above for why the standalone read is an enumeration oracle.
- **Reading an MCP call's HTTP status to decide whether a control fired.**
  `lib/mcp/tool-wrapper.ts` returns denials as `isError` inside a normal
  200, so status is structurally incapable of telling throttled/refused
  apart from allowed. Parse the payload, or test the underlying RPC. REST
  (`/api/v1`) does use real status codes; MCP does not.

<!--
[ ] Under 200 lines
-->
