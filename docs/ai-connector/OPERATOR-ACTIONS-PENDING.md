# Operator actions still pending — and why each is deliberately NOT done yet

Two production actions are written, verified as far as they can be, and
**intentionally not executed.** Both are gated on the same thing.

## 1. The ES256 public-key import (R4b) — RESOLVED, mechanism changed, not by this route

**Status: unblocked.** The import path this item describes turned out not to exist —
Supabase's real dashboard offers no way to import a public key at all. The owner instead
supplied the secret for a previous "Legacy HS256 (Shared Secret)" key still valid on the
project; the lead tested it directly against production (HS256 JWT accepted by PostgREST,
RLS scoped correctly) before anyone built on it. `SUPABASE_LEGACY_JWT_SECRET` is already set
in Vercel (Production + Preview) and in `.env.local` — no operator action was actually
needed here beyond supplying that one secret, which already happened.

`lib/mcp/session.ts` now signs HS256 with that secret as the live path (ES256/
`MCP_SIGNING_KEY_JWK` kept, inert, in case real key import ever becomes possible). Full
story, including the fragility of relying on a key Supabase's own dashboard calls
"previous" and revocable: `SETUP-signing-key.md`, rewritten in place rather than left
describing a plan that was never actually available.

Every `read`/`write` tool call should now mint successfully rather than hitting
`No suitable key or wrong key type` — the lead is doing the real end-to-end proof (a
genuine MCP client against production) once this lands; not asserted here as already
verified.

## 2. The `pg_cron` poll for scheduled actions — GATED ON #1, deliberately

The registration SQL is written (in migration 142's originating draft). It is **not run**,
and the reason is worth stating rather than leaving as an omission:

**A scheduled action cannot succeed until session minting actually works end to end.** It
fires through the identical `runMcpTool` path a live call uses, so it hits the identical
wall if that path is broken. Registering the poll before that's confirmed would produce a
**failed attempt every five minutes, indefinitely** — filling the audit log with noise that
looks like a broken scheduler rather than an unfinished setup step, and burning the retry
budget (5 consecutive failures → pause) on rows that would have worked fine later.

So the order is: **confirm minting works end to end (item #1, now code-complete — the lead's
real end-to-end proof against production is the remaining step) → verify a tool call returns
real data → then register the poll.** Not before. (Originally phrased as "import the key" —
that specific mechanism didn't happen; the underlying requirement, a working signed
session, is what actually gates this.)

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
