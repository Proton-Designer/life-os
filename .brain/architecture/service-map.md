---
id: arch.service-map
title: Service Map
layer: L2
type: architecture
status: canonical
owner: unassigned
updated: 2026-09-13
sources:
  - app/api/**
  - app/.well-known/**
  - app/(app)/**
related:
  - arch.system-overview
  - arch.dependency-graph
answers:
  - "what api surfaces does this app expose"
  - "where does each api route live"
covers: "Every distinct API/route surface this single-process app exposes, treated as a 'service' for navigation purposes"
excludes: "The main cookie-authed page tree itself (see REPOSITORY_MAP.md for the full route table)"
tokens_est: 1080
source_hash: f72c3d91b34e3fb049587f652cbfbf69caeaa47d2f3ae43b3487cc4a0505a02a
---

# Service Map

This is a single Next.js process, not a services architecture — "service" here means a distinct API surface with its own auth model and purpose, per `context/ARCHITECTURE.md`'s "app/api/ is no longer one route" finding.

| Surface | Purpose | Entrypoint | Auth model | Primary dependencies |
|---|---|---|---|---|
| Main app (pages) | Cookie-authed UI across every life domain | `app/(app)/layout.tsx` | Supabase cookie session, RLS | All of `lib/**`, Supabase (server client) |
| MCP server | 5 generic tools (list_capabilities, read, write, widget_manage, scheduler_manage) for external AI clients | `app/api/mcp/route.ts` | Bearer PAT/OAuth token → minted session JWT → RLS | `lib/mcp/**` |
| MCP OAuth AS | Authorization-code+PKCE flow, DCR, refresh rotation | `app/api/mcp/oauth/{authorize,token,register}/route.ts` | Public (DCR), consent-gated | `lib/mcp/oauth.ts` |
| OAuth metadata | RFC 8414/9728 discovery documents | `app/.well-known/oauth-{authorization-server,protected-resource}/route.ts` | Public | — |
| Scheduled actions poller | Fires due scheduled MCP writes/notifications | `app/api/cron/scheduled-actions/route.ts` | Bearer `CRON_SECRET`, fails closed (503 if unset) | `lib/mcp/tools/write.ts` (same path as a live call) |
| Cron ping | Liveness check for the cron poller | `app/api/cron/ping/route.ts` | Bearer `CRON_SECRET` | — |
| Push subscribe | Web Push subscription registration | `app/api/push/subscribe/route.ts` | Cookie session | `web-push` |
| Self-mastery ingestion step | Runs one book-ingestion pipeline stage per call | `app/api/self-mastery/ingestion/step/route.ts` | Service-role (no user session) | `lib/self-mastery/ingestion/**` |
| Settings export | JSON export of ~21 user-scoped tables | `app/(app)/settings/export/route.ts` | Cookie session, RLS | — |
| E2E test endpoints | Reset/seed fixtures for Playwright | `app/api/test/**` | Cookie session **and** `E2E_TEST_SECRET` | Not product surface — do not treat as a real API |
| Notification dispatch | Sends prayer-reminder web push | `supabase/functions/dispatch-notifications` (Supabase Edge Function, not a Next route) | Invoked by pg_cron+pg_net | `lib/prayer-times/**`-shaped logic (own copy — see Unverified) |

## Notes on ownership and ownership gaps

No formal per-service ownership mapping exists (see `.brain/governance/ownership.md`). All services above are maintained by whichever of "Lead"/"Engineer N" session happens to be working in that area at the time — there is no dedicated on-call or service owner beyond the product owner's overall authority.

## Where to go next

| For | Read |
|---|---|
| The MCP surfaces' internal design | `.brain/domains/mcp-connector.md` |
| The main app's full route table | `REPOSITORY_MAP.md` |
| Deploy mechanics for this whole process | `.brain/tooling/registry.md`, `context/ARCHITECTURE.md`'s Build/deploy section |

## Unverified

- Whether `supabase/functions/dispatch-notifications`'s own prayer-time calculation shares `lib/prayer-times/windows.ts`'s local-day-anchor safeguard, or is an independently-drifting fourth copy of that logic — flagged as a real, unverified risk given this exact bug class has shipped three times across other layers.
