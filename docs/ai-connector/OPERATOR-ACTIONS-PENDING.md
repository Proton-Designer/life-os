# Operator actions — status

**Items 1 and 2 are DONE.** Only item 3 remains, and it is not blocking.

Two production actions are written, verified as far as they can be, and
**intentionally not executed.** Both are gated on the same thing.

## 1. ~~The ES256 public-key import~~ — RESOLVED, and it was never possible

The Supabase dashboard offers **"Create Standby Key" only — there is no import option**, so
this plan could never have worked. The owner's screenshot ended a multi-hour wait on a
door that does not exist.

**What actually solved it:** the project's *legacy HS256 shared secret* (a "previous key",
still used to verify unexpired tokens). Signing session JWTs with it is accepted by
PostgREST and RLS scopes correctly — verified before anything was built on it.
`SUPABASE_LEGACY_JWT_SECRET` is set in Vercel and `lib/mcp/session.ts` uses it.

**Fragility, stated in the code too:** Supabase labels that key "revoke once all tokens have
expired." **Revoking it breaks the connector, with no fallback.**

## 2. ~~The `pg_cron` poll~~ — REGISTERED 2026-09-09

`mcp-scheduled-actions-every-5min`, reading URL and secret from Vault exactly as
`dispatch-notifications-every-15min` does. Verified: fires on schedule, `status=succeeded`,
and writes **zero audit rows** against an empty queue.

Reverse with `select cron.unschedule('mcp-scheduled-actions-every-5min');`

## 3. Exclude `/api/mcp` and `/.well-known/*` from Vercel bot protection (R10)

Not blocking, but real. Twice tonight the production alias returned
**403 "Vercel Security Checkpoint"** to every path, `/api/mcp` included — automatic
mitigation triggered by our own test volume. It cleared on its own both times.

**An MCP client is not a browser and cannot solve a JavaScript challenge.** If this engages
while a connector is live it does not degrade, it dies, and no code of ours can detect it
because the request never arrives. A dashboard setting on Ayman's account.
