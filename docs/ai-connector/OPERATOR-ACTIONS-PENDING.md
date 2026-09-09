# Operator actions still pending — and why each is deliberately NOT done yet

Two production actions are written, verified as far as they can be, and
**intentionally not executed.** Both are gated on the same thing.

## 1. The ES256 public-key import (R4b) — Ayman only

**Status: BLOCKING everything.** Runbook: `SETUP-signing-key.md`.

I checked whether I could do it myself rather than keep waiting: the Supabase CLI on this
machine is authenticated to an account that **cannot see this project**, and there is no
stored management token. It is a capability limit, not caution.

Until it lands, every `read` and `write` tool call reaches the final step and returns
`No suitable key or wrong key type` — Supabase does not recognise our `kid`. Everything
around it is proven on production.

## 2. The `pg_cron` poll for scheduled actions — GATED ON #1, deliberately

The registration SQL is written (in migration 142's originating draft). It is **not run**,
and the reason is worth stating rather than leaving as an omission:

**A scheduled action cannot succeed until the signing key is imported.** It fires through
the identical `runMcpTool` path a live call uses, so it hits the identical wall. Registering
the poll now would produce a **failed attempt every five minutes, indefinitely** — filling
the audit log with noise that looks like a broken scheduler rather than an unfinished
setup step, and burning the retry budget (5 consecutive failures → pause) on rows that
would have worked fine later.

So the order is: **import the key → verify a tool call returns real data → then register the
poll.** Not before.

Verified already, so this is the only step left when the time comes:
```
POST /api/cron/scheduled-actions   (no auth)      -> 401
POST /api/cron/scheduled-actions   (wrong secret) -> 401
```
`CRON_SECRET` exists in Vercel production (set 7 days ago, before this program). The route
is live and refusing correctly in both negative cases.

## 3. Exclude `/api/mcp` and `/.well-known/*` from Vercel bot protection (R10)

Not blocking, but real. Twice tonight the production alias returned
**403 "Vercel Security Checkpoint"** to every path, `/api/mcp` included — automatic
mitigation triggered by our own test volume. It cleared on its own both times.

**An MCP client is not a browser and cannot solve a JavaScript challenge.** If this engages
while a connector is live it does not degrade, it dies, and no code of ours can detect it
because the request never arrives. A dashboard setting on Ayman's account.
