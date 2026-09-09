# The MCP signing key — RESOLVED, mechanism changed (2026-09-09)

**This file previously described a plan (import a public ES256 key into Supabase's JWT
Keys page, self-sign locally with the private half) that turned out to be impossible on
this project.** Kept, corrected in place rather than deleted, because a wrong runbook left
standing is worse than no runbook — the next reader following the old steps below would
have hit a dashboard with no import button and no way to know whether *they* were doing it
wrong or the doc was.

## What actually happened

The owner checked Supabase's real JWT Keys dashboard and sent a screenshot. It shows:

1. **"Create Standby Key" only — there is no import-your-own-key option.** The entire
   premise of Steps 1-2 below (import a public JWK) was never available on this project.
   `MCP_SIGNING_KEY_JWK` (Step 3) is real code, kept inert in `lib/mcp/session.ts` for the
   day this ever changes, but nothing should assume it will.
2. **A previous key is still listed: "Legacy HS256 (Shared Secret)"** — Supabase's own
   label, "used to verify tokens that have not expired," i.e. kept around for exactly this
   kind of migration, not a permanent credential.

The owner supplied that secret. The lead tested it directly against production **before**
anyone built on it:

```
signed HS256 JWT (sub=<real user>, role=authenticated, aud=authenticated, 5m exp)
-> PostgREST: ACCEPTED
-> RLS scoped correctly: YES (only that user's own rows)
```

So the mechanism is: sign a symmetric HS256 JWT with the legacy shared secret. RLS applies
exactly as it does for a cookie session — the same end-to-end guarantee the ES256 plan was
after, just via a different (and already-available) key.

## Where things stand now

- **Env var:** `SUPABASE_LEGACY_JWT_SECRET` — already set in Vercel (Production + Preview)
  and in `.env.local`. No further operator action needed for this specific step.
- **Code:** `lib/mcp/session.ts`'s `mintSessionJwt` signs HS256 with this secret,
  unconditionally preferred over the (kept, inert) ES256 path. No `kid` — a symmetric key
  isn't published in a JWKS and has nothing for a `kid` to select between.
- **⚠️ The fragility, restated here because it matters operationally, not just in code:**
  Supabase's dashboard describes this key as *previous* and revocable once old tokens
  expire. **Revoking it breaks every read and write tool this connector has** — there is no
  fallback path today (ES256 self-signing genuinely isn't available). If this connector
  starts failing auth with no code change, check the JWT Keys dashboard for a revocation
  before assuming a bug.

## Verifying it end to end

Same shape as the original Step 4, retargeted:

- sign `{sub: <user uuid>, role: "authenticated", aud: "authenticated", exp: now+300}`
  with **HS256** and the legacy secret, **no `kid`**
- `createClient(url, anonKey, { global: { headers: { Authorization: "Bearer <jwt>" } } })`
- read a user-scoped table → must return **that user's rows only**
- **prove the negative too**: a JWT signed with the *wrong* secret, and one with an expired
  `exp`, must both be **rejected** — a positive-only check proves nothing.

## Rollback

There is no "delete an imported key" step this time — nothing was imported. Rollback here
means reverting `lib/mcp/session.ts` to a state that refuses to mint (as it did before this
fix), which takes the connector's write/read tools down but leaves the app's own login
untouched — the legacy key was never the key Supabase itself signs new sessions with.

---

## Original plan (kept below for the record — steps 1-3 never happened; do not follow them)

Supabase Dashboard → your project → **Authentication → JWT Keys** (a.k.a. Signing Keys) →
"Add / Import key" was believed to exist. It does not — the dashboard offers "Create
Standby Key" only. The public JWK below was never imported, and the `curl .../jwks.json`
verification in the original Step 2 was never run against a changed JWKS, because nothing
changed it.

```json
{
  "kty": "EC",
  "kid": "ff83fd87-4fbf-4ff4-9aae-f609538947e8",
  "use": "sig",
  "alg": "ES256",
  "crv": "P-256",
  "x": "l-fqp3Jp7LfaE0SRAyqH8BwESCZgW_ZjphJO8cSOgzo",
  "y": "DClMLvWhxl1NpFWwbkfWJwPivCMtrl5fRhdjtTbXSmg",
  "key_ops": ["verify"]
}
```
