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

<!--
[ ] Under 200 lines
-->
