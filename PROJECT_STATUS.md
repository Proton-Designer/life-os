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

## Progress log
_(Updated as work completes — append, don't rewrite history.)_
- 2026-08-10: Repo/spec/edge-cases finalized (see docs/superpowers/specs/). Overnight build kicked off. Safety setup (env file, gitignore verified, memory, caffeinate) complete. Implementation plan in progress.
