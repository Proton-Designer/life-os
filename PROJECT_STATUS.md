# Life OS — Build Status & Context

**Read this first if context was compacted or this is a fresh session.** No secrets live in this file — see `.env.local` (gitignored) for those.

## Mission
Full build of "Life OS" (spec: `docs/superpowers/specs/2026-08-09-life-os-design.md`) — desktop web + mobile-optimized responsive PWA, wired to a real Supabase backend (DB + Auth + Edge Functions where applicable), deployed live to Vercel. Kicked off overnight 2026-08-10 while the user (Ayman) is asleep and unreachable — **no clarifying questions can be asked during this run; judgment calls are made and documented here instead.**

## Team structure
- **This session ("Opus Lead"):** architect/orchestrator. Does not write application code directly — writes the implementation plan, breaks it into task assignments, delegates all coding/research/exploration to the peer engineer, reviews/verifies their work, and owns deployment + final Playwright verification.
- **Peer session ("Sonnet Engineer"):** does all actual implementation, code exploration, and deeper research. Reachable via claude-peers messaging (peer id `u4c32t5m` as of session start).
- **Subagent limits (both sessions):** at most 2 concurrent Haiku subagents, or 1 concurrent Sonnet subagent. Never use forked subagents. Up to 3 Haiku subagents permitted specifically for mass/parallel review passes. Use subagents only for work that genuinely benefits from it, not by default.

## Credentials
Real values are in `~/Desktop/tracking-app/.env.local` (gitignored, never committed, never pasted into chat/peer messages again). That file documents which vars are client-safe (`NEXT_PUBLIC_*`) vs. server-only (service role key, DB password, Vercel token). Supabase project ref: `kjaveyumtrtcvraqdlbe`. Supabase MCP is already connected to this project — prefer MCP tools (`apply_migration`, `execute_sql`, etc.) over raw DB password access where possible.

## Process/environment notes
- `caffeinate -i -d -u` is running in the background (PID logged via `ps` at launch) to keep the machine awake for the overnight run. **Must be killed as the very last step**, only after the app is fully built, tested, and verified via Playwright.
- Git repo was initialized fresh for this project on 2026-08-09; `docs/superpowers/specs/` holds the approved design spec.

## Tech stack decisions (locked in for this build — see spec's "Technical Notes" section for original reasoning)
- Next.js App Router, deployed on Vercel, installable PWA with service worker + Web Push for notifications.
- Supabase for Postgres DB, Auth (single real user, not multi-tenant — but still real auth, since the app will be live on a public URL), and Edge Functions where server-side logic benefits (e.g., scheduled push notification dispatch, prayer-time recalculation).
- RLS enabled on all tables scoped to the single user's auth uid, as a defense-in-depth measure even though it's single-user.

## Coordination mechanism
Implementation plan: `docs/superpowers/plans/2026-08-10-life-os-implementation.md` (26 tasks, Phase 0–16). **The TaskCreate/TaskList tool is scoped per-session and is NOT shared between the Opus lead and Sonnet engineer sessions** (confirmed 2026-08-10 — engineer's TaskList showed nothing despite 26 tasks existing on the lead's side). Do not rely on it for cross-session coordination. Actual coordination is: the engineer works the plan doc in phase/ID order, commits after every task (per the plan's own instructions), and appends a line to this file's Progress log after each phase completes. The lead tracks progress by reading `git log` and this file, not a shared task list.

## Progress log
_(Updated as work completes — append, don't rewrite history.)_
- 2026-08-10 00:51 CDT: Repo/spec/edge-cases finalized (see docs/superpowers/specs/). Overnight build kicked off. Safety setup (env file, gitignore verified, memory, caffeinate) complete.
- 2026-08-10 00:51 CDT: Implementation plan written and committed (26 tasks).
- 2026-08-10 01:02 CDT: Discovered TaskCreate/TaskList is per-session, not shared — switched coordination to plan-doc-order + git log + this progress log. Engineer starting Task 0.1.
- 2026-08-10 01:10 CDT: **Task 0.1 done** (commit `b0d74aa`) — Next.js app scaffolded, shadcn/ui initialized, dark theme tokens wired, `npm run dev` verified (built CSS confirmed to contain `--background:#0a0a0c`, `--accent-deen:#e0a030`, and the oxblood radial-gradient layer). Judgment calls made (plan predates current tool versions, no user available to confirm):
  - `create-next-app` refused to scaffold in-place due to existing files (`.env.local`, `docs/`, etc.) — scaffolded in a scratch dir and merged in via `rsync`, excluding `.git`. This clobbered our custom `.gitignore` (source and dest both had one); restored the lost `.superpowers/` exclusion and added `.claude/` (local runtime lock file, not project source) on top of Next's default `.gitignore`.
  - Latest `create-next-app` installed **Next.js 16.3.0** (plan specified "Next.js 15") and **Tailwind v4**, which uses CSS-first config (`@theme` in `app/globals.css`) — there is no `tailwind.config.ts` file for v4, superseding that line item in Task 0.1's file list. Going with latest since nothing in the spec depends on a specific Next major version, and Vercel's current guidance defaults to latest.
  - `shadcn@latest init` CLI has changed since the plan was written (no more "neutral base color" prompt) — selected **Radix UI** as the component base (most third-party shadcn recipes assume Radix) and the **Nova** preset (Lucide icons / Geist font, closest to a neutral default to be restyled).
  - Renamed `package.json`'s name from `nextapp` → `life-os`; updated root metadata title/description from the create-next-app default to "Life OS"; replaced the default landing page with a minimal placeholder (real Home screen lands in Phase 4/Task 4.2).
  - Fixed a font-variable name mismatch in the generated template (`app/layout.tsx` defined `--font-geist-sans` but `app/globals.css`'s `@theme` block referenced `--font-sans`) so the Geist sans font actually applies instead of silently falling back to a system font.
  Starting Task 0.2 (Supabase client setup) next.
