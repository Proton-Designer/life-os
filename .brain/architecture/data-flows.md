---
id: arch.data-flows
title: Data Flows
layer: L2
type: architecture
status: canonical
owner: unassigned
updated: 2026-09-13
sources:
  - lib/mcp/**
  - lib/home/**
  - supabase/migrations/**
related:
  - arch.system-overview
  - arch.dependency-graph
  - domain.mcp-connector
  - domain.home-arbiter
answers:
  - "how does an mcp write reach the database"
  - "how does home assemble its data"
  - "how does a schema change roll out safely"
covers: "The 3 flows that matter most in this codebase: cookie-authed request→RLS, MCP bearer-token→RLS, and Home's cross-domain data assembly"
excludes: "Per-domain internal data shape (see the relevant domain.* doc)"
tokens_est: 1421
source_hash: 1b163eeac244092c3ddf8486c1d4c7b91651b14960ed36881678f099f8005380
---

# Data Flows

## Flow 1 — Cookie-authed request → response

Ingress (`proxy.ts`) → session refresh + `x-pathname` injection (`lib/supabase/middleware.ts`) → `AuthedShell` auth gate (`getAuthedUser()`, local JWKS, no network round trip) → onboarding-completion check → page Server Component fetches via an RLS-scoped client → render. A mutation: Client Component → `useOptimistic` reducer applies the change synchronously → Server Action (`<route>/actions.ts`) → `.eq("user_id", userId)` on top of RLS → `revalidatePath` for the route and `/`.

**Failure behavior**: RLS denies silently (empty result, not an error) rather than throwing — application code must not interpret "zero rows" as "definitely no data," only as "no rows this session can see."

## Flow 2 — MCP bearer-token request → response

`Authorization: Bearer` → `verifyAccessToken` (service-role, since no `userId` is known yet) → `isUserActive` (GoTrue check, fails closed) → `runMcpTool`: scope check → rate limit (30/60s per token, counted from `mcp_audit_log`) → `mintSessionJwt(userId)` (HS256, 5-min TTL) → RLS-scoped client identical in privilege to the cookie-authed path → tool adds `.eq("user_id", userId)` on top of RLS → **audit row written before the result returns, unconditionally** (a failed audit write overrides an otherwise-successful call into a reported failure) → response.

**This flow never uses the service-role client for domain data** — only for the token-verification/audit bookkeeping steps that have no user session to read yet. See `.brain/domains/mcp-connector.md` for the full security model and its known single-point-of-failure (`SUPABASE_LEGACY_JWT_SECRET`).

**Scheduled variant**: `app/api/cron/scheduled-actions/route.ts` (bearer `CRON_SECRET`) fires a due action through the **same** `write` tool a live MCP call uses, re-checking the stored token's scope **at fire time**, not at schedule time — a token revoked after scheduling but before firing is honored as revoked.

## Flow 3 — Home's cross-domain data assembly

`app/(app)/page.tsx` fires one `Promise.all` across ~9 independent data assemblers (priority items, domain snapshots, home extras, day shape, weekly goals, distraction triggers, in-progress items, self-mastery due summary, MCP widgets) — each of these in turn queries its own domain's tables directly (Home does not go through the MCP `read` tool for its own rendering; only Widgets does). `resolveAreaWeights` builds a per-area weight lookup from `user_domains`, empty for legacy accounts. `selectNextActionPerDomain` picks one item per domain, then `rankCandidates` (the arbiter comparator) orders across domains into the final "Now" selection. See `.brain/domains/home-arbiter.md` for the comparator's exact tie-break order.

**A real, documented divergence lives inside this flow**: the Home arbiter's own "is this account legacy" check (`onboarding_completed && zero rows`) and Business's Signal:Noise "is this account legacy" check (`zero rows` only) are two independently-written predicates over the same underlying fact, and they disagree during the onboarding window. Nothing in the codebase re-derives one from the other.

## Migration/deploy flow (schema evolution)

Migration number allocated (`supabase/migrations/ALLOCATIONS.md`, lead-only) → file written, reviewed → `scripts/apply-migration.sh` applies **and** records an md5 in `migration_ledger` → `database.types.ts` regenerated as part of that apply, so a type-check against the new column only means something once this step has actually run against the real database. **Deploy code before schema** — code must tolerate both the pre- and post-migration shape briefly, since a code deploy running behind a migration has been caught mid-flight against a since-dropped table before. `scripts/deploy-prod.sh` checks HEAD out into a throwaway worktree and deploys exactly that, specifically because `vercel deploy` otherwise ships the raw working directory regardless of git state.

## Where to go next

| For | Read |
|---|---|
| The MCP auth chain in full | `.brain/domains/mcp-connector.md` |
| The arbiter's exact comparator | `.brain/domains/home-arbiter.md` |
| Full deploy trap list | `context/ARCHITECTURE.md`'s Build/deploy section, `docs/DEPLOYING.md` |

## Unverified

- None outstanding beyond what's already flagged in the referenced domain docs.
