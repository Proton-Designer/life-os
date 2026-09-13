# AI connector: a remote MCP server so Claude/ChatGPT/Gemini can read and act on Life OS

**Status:** design draft, not yet built or ruled on.
**Author:** drafted by an agent session at Garrison's request, pending Ayman's/owner's review before any migration is applied to production.

## What this is

A remote MCP (Model Context Protocol) server bolted onto the existing Next.js app so that a
user's own Claude, ChatGPT, or Gemini subscription — not a separate paid API key — can pull
real-time Life OS data into a normal chat, and make changes back: log a prayer, add a task,
edit the Business kill list, and so on. This is unrelated to the existing DeepSeek integration
(`lib/ai/*`, `user_api_keys`), which is a narrow, opt-in feature for retrieval-session feedback
and book ingestion — not a general assistant. This spec adds a second, separate surface.

Confirmed (2026-09) that all three target platforms speak standard remote MCP over Streamable
HTTP and can be pointed at a self-hosted server:
- **Claude**: Customize → Connectors → Add custom connector, on Free (1 connector)/Pro/Max/Team/
  Enterprise, across claude.ai, Desktop, Cowork, and mobile. Server must be public HTTPS.
- **ChatGPT**: a connector at a public `/mcp` endpoint (2026-07-28 Streamable HTTP spec, stateless).
- **Gemini**: via "Gemini Spark" custom apps in the consumer Gemini web/mobile app — paste an MCP
  server URL, same standard.

**One real wrinkle found during research, after the auth choice below was made:** Claude's
custom-connector UI does not have a plain "paste a bearer token" field — only an OAuth
client-id/secret pair, or no auth at all (multiple open issues against `anthropics/claude-ai-mcp`
confirm this, e.g. #112, #411). ChatGPT and Gemini both accept a manually-entered static
credential when Dynamic Client Registration isn't implemented. **Net effect:** a bare personal
access token is not enough on its own — Claude specifically needs something OAuth-shaped in
front of it. The design below keeps the personal-access-token model everywhere it can (ChatGPT,
Gemini) and adds the smallest possible OAuth 2.1 shim in front of the same tokens so Claude's UI
is satisfied, without building real multi-tenant login.

## Decisions made (2026-09-09, Garrison)

- **Auth:** personal access token, generated from a Settings page, used as a bearer credential.
- **Scope:** read AND write from day one, across every domain — no read-only phase, no
  confirm-before-write gate on individual tool calls.
- **Private reflection log:** included, same as every other domain. No carve-out.

Because "write, no per-call confirmation" was chosen, the guardrails below (audit log, rate
limit, revocation, scoped tokens) are load-bearing, not optional polish — they're the only thing
standing between a hallucinated tool call and a real write to Ayman's/the account owner's data.

## Architecture

```
Claude / ChatGPT / Gemini
        │  HTTPS, Streamable HTTP (MCP)
        ▼
app/api/mcp/route.ts            ← MCP server (mcp-handler package)
        │
        ├─ lib/mcp/auth.ts       verifies bearer token → user_id, mints a short-lived
        │                        Supabase user JWT (via admin API) so RLS applies to
        │                        every query the tool makes — same defense-in-depth
        │                        posture as the rest of the app, never a service-role
        │                        client making unfiltered queries.
        │
        ├─ lib/mcp/tools/*.ts    one file per domain; each tool is a THIN wrapper that
        │                        calls the SAME server actions the UI already calls
        │                        (lib/deen/actions.ts, lib/work/actions.ts, etc.) —
        │                        no reimplemented business logic, no second source of
        │                        truth for what a "valid" write looks like.
        │
        └─ lib/mcp/audit.ts      every call, success or failure, is one row in
                                 mcp_audit_log before the tool returns.

app/(app)/settings/connectors/  new Settings page: create/revoke tokens, see last-used,
                                 see recent audit log entries.

app/api/mcp/oauth/*             thin OAuth 2.1 shim, Claude-only in practice:
                                 /authorize   — if the browser already has a Life OS
                                                session (it will; same domain), issue an
                                                auth code immediately, no separate login
                                                screen, no consent screen with buttons
                                                for a second user who doesn't exist.
                                 /token       — exchanges the code (or refresh token) for
                                                one of the SAME access tokens the
                                                Settings page can generate manually.
                                 /register    — Dynamic Client Registration, per the MCP
                                                auth spec; both Claude and Gemini will
                                                call this automatically if present.
                                 /.well-known/oauth-authorization-server — metadata.

supabase: pg_cron + pg_net      already proven in production (dispatch-notifications
                                 fires every 15 min this way). Reused, not reinvented,
                                 for the scheduling tool below.
```

## Data model (new migration, 130+)

```sql
-- 130_mcp_access.sql

create table public.mcp_access_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  token_hash    text not null,        -- sha256 hex of the raw token; raw token is
                                       -- shown exactly once, at creation, never stored
  label         text,
  token_last4   text not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create unique index on public.mcp_access_tokens (token_hash);
alter table public.mcp_access_tokens enable row level security;
-- select/insert/update(revoke)/delete: auth.uid() = user_id, same four-policy shape as
-- user_api_keys in 104. No policy allows reading token_hash into a Client Component.

create table public.mcp_audit_log (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  token_id     uuid references public.mcp_access_tokens (id) on delete set null,
  tool_name    text not null,
  args         jsonb not null,        -- the call as received, for a real "what did it
                                       -- actually send" answer when something looks wrong
  outcome      text not null check (outcome in ('ok', 'error', 'denied')),
  result_summary text,
  created_at   timestamptz not null default now()
);
alter table public.mcp_audit_log enable row level security;
-- select: auth.uid() = user_id. No update/delete policy at all — an audit log you can
-- edit isn't one.

create table public.mcp_scheduled_actions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  token_id      uuid references public.mcp_access_tokens (id) on delete set null,
  tool_name     text not null,
  args          jsonb not null,
  cron_expression text,               -- null for a one-off
  run_at        timestamptz,          -- one-off fire time; null for recurring
  next_run_at   timestamptz not null,
  last_run_at   timestamptz,
  last_outcome  text,
  status        text not null default 'active' check (status in ('active','paused','cancelled')),
  created_at    timestamptz not null default now()
);
alter table public.mcp_scheduled_actions enable row level security;
-- own-rows-only, same four policies.
```

Follows the RLS-everywhere and cross-tenant-FK conventions `ARCHITECTURE.md` and the
`check-rls.sh` / `check-fk-tenancy.sh` instruments already enforce — every FK here is to
`auth.users` directly, never to another user-scoped row, so the 2026-09-02 cross-tenant sweep
stays true.

## Tool catalog (each wraps an existing action; not exhaustive, first pass)

| Domain | Read tools | Write tools |
|---|---|---|
| Home | `home.get_snapshot` | — (Home has no data of its own to write) |
| Deen | `deen.get_status`, `deen.get_reflections` | `deen.log_prayer`, `deen.log_reflection`, `deen.log_quran`, `deen.update_habit` |
| Work | `work.get_target_and_queue` | `work.set_target`, `work.add_task`, `work.update_task_status` |
| Business | `business.get_kill_list`, `business.get_focus_hours` | `business.set_kill_list`, `business.log_focus_session` |
| School | `school.get_assignments`, `school.get_classes` | `school.add_assignment`, `school.update_assignment` |
| Fitness | `fitness.get_today`, `fitness.get_cycle_progress` | `fitness.log_workout`, `fitness.update_body_metric` |
| Distractions | — | `distractions.capture` |
| Calendar/Insights | `calendar.get_week`, `insights.get_summary` | — |
| Scheduler | `scheduler.list` | `scheduler.create`, `scheduler.cancel` |

`scheduler.create` is how "make scheduled tasks" is satisfied without inventing a new engine:
it writes one row to `mcp_scheduled_actions`; a `pg_cron` job (same pattern as
`dispatch-notifications-every-15min`) polls due rows every few minutes and POSTs to
`app/api/mcp/scheduler/run`, which is secret-header-authenticated exactly like
`app/api/cron/ping/route.ts` already is, and simply invokes the named tool server-side with the
stored args — so a scheduled action runs through the identical code path, and the identical
audit logging, as a live call from Claude.

## Guardrails, given "write, no confirmation" was the chosen scope

- **Every tool call is audited before it returns**, not after — a crash mid-write still leaves a
  record of what was attempted.
- **Token revocation is immediate and visible**: the Settings page lists tokens with last-used
  time, so a token that's being called in a way that looks wrong can be killed in one click.
- **Rate limiting** on the MCP route (a fixed per-token ceiling, e.g. 60 calls/min) — the failure
  mode this exists to catch is a runaway loop on the model's side, not malice.
- **Timing-safe comparison** for the token hash lookup, same discipline already used in
  `app/api/cron/ping/route.ts`.
- **No tool deletes rows.** Every write tool is an insert, update, or a status change (e.g.
  `work.update_task_status` to `'archived'`, not a `DELETE`). Undo-by-editing-back stays
  possible; undo-by-restoring-a-deleted-row doesn't.

## Open questions before this gets built for real

1. Does Ayman (the app's actual owner) need to sign off on this, given it's his production
   database and his `AGENTS.md` governs how migrations land? This spec is written from
   Garrison's account's perspective; the token/RLS design means it can only ever touch the
   account that generated the token, but the migration itself is shared schema.
2. Which model actually places the tool calls matters for cost/quality but not for this design —
   any MCP client behaves identically at the protocol level.
3. `mcp-handler` (Vercel's package) is the concrete dependency assumed above; worth a short
   spike to confirm it plays cleanly with this app's Next 16 / App Router setup before
   committing to it in a migration-adjacent PR.

## Sources consulted (2026-09)

- Claude: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- Claude bearer-token limitation: https://github.com/anthropics/claude-ai-mcp/issues/112 ,
  https://github.com/anthropics/claude-ai-mcp/issues/411
- ChatGPT: https://vercel.com/kb/guide/mcp-server-chatgpt-connector
- Gemini Spark: https://support.google.com/gemini/answer/17209137
- mcp-handler: https://github.com/vercel/mcp-handler , https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel
