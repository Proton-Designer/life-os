---
id: tool.integrations
title: Integrations
layer: L2
type: tooling
status: canonical
owner: unassigned
updated: 2026-09-13
answers:
  - "what external systems does this connect to"
  - "where does CI run"
  - "where do I look at logs and errors"
covers: "CI/CD, environments, external services, credential locations"
excludes: "MCP-exposed tools (see tool.mcp-registry), build/test/dev commands (see tool.registry)"
tokens_est: 781
---

# Integrations

## Source control & CI

| System | Where | Notes |
|---|---|---|
| Git | this repo, single package (`life-os`) | 850+ commits, 1 confirmed human contributor (Ayman) plus session-scoped agent roles — see `.brain/governance/ownership.md` |
| CI | **none configured** | no GitHub Actions workflows directory; `brain verify --strict` is not gated anywhere yet |

## Environments

| Environment | Deploys via | Who can deploy |
|---|---|---|
| Production | Vercel, via `scripts/deploy-prod.sh` | session "Lead" role only, per convention — never a partial/filtered run |
| Local dev | `npm run dev` | anyone |

## External services

| Service | Used for | Env config | Failure behavior |
|---|---|---|---|
| Supabase (Postgres + Auth) | primary datastore, RLS-enforced multi-tenancy (77 tables) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | hard fail — no local fallback |
| Supabase legacy HS256 JWT signing | signs MCP connector session tokens (chosen after the ES256-import path turned out not to exist — see `.brain/memory/known-issues.md`) | `SUPABASE_LEGACY_JWT_SECRET` | connector breaks with no fallback if this key is ever revoked |
| Vercel | hosting, deploys, cron/bot-protection settings | project-level, not env vars | — |
| DeepSeek (via `lib/ai/providers.ts`) | AI provider for Self-Mastery/ULM features | provider key, encrypted at rest via `API_KEY_ENCRYPTION_SECRET` | see `.brain/memory/active-work.md` — multi-provider support (Gemini/Claude/GPT) was planned but not shipped; DeepSeek-only today |
| Web Push (VAPID) | push notifications | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | best-effort, no retry documented |
| `pg_cron` (`mcp-scheduled-actions-every-5min`) | polls MCP scheduled actions | Supabase Vault-stored URL/secret | registered 2026-09-09; reversible via `select cron.unschedule(...)` |

## Observability

No dedicated logging/error-tracking service (e.g. Sentry, Datadog) was found
configured in this repo. Debugging relies on Vercel's own deploy logs and the
`scripts/check-*.sh` drift-detection scripts run manually or via
`agent-commit.sh`.

## Credentials

**No secret values in this file or anywhere in `.brain/`.** All of the above
come from `.env.local` (gitignored) locally, and from Vercel's project
environment variables in production. Ask the session's "Lead" role or Ayman.
