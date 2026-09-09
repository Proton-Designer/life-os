# One-time setup: the MCP signing key (needs Ayman)

This is the only step in the whole program that cannot be done from the repo, because it
changes the Supabase project's **auth configuration**, not the app.

## Why it exists

An MCP request arrives with a bearer token and **no session cookie**, so `requireUser()`
cannot authenticate it (verified — see R4 in PROGRAM-PLAN.md). To make RLS apply to MCP
tool calls exactly as it does to the UI, the server mints a short-lived user JWT and
attaches it as `Authorization: Bearer <jwt>` on a fresh Supabase client.

This project signs with **ES256 against a published JWKS** — confirmed live against
`/auth/v1/.well-known/jwks.json`, which returns exactly one `kty=EC, alg=ES256` key. That
means the legacy symmetric `SUPABASE_JWT_SECRET` path is gone and, per Supabase's docs, the
existing private key is deliberately **not extractable**. The supported route is to bring
our own key: import a public key, keep the private half server-side, sign locally.

## Security note, stated plainly

The private half of this key can mint a token for any user in the project. That sounds
alarming, so the comparison matters: **the deployment already holds
`SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS for every user unconditionally and forever.**
A per-user, short-lived, RLS-respecting token is strictly *weaker* than what the environment
already contains. This is a reduction in blast radius, not an increase.

The private key lives only in Vercel's encrypted env. It is **never** committed — the
generated file sits in the session scratchpad, `chmod 600`, outside the repo.

## Step 1 — import the public key (Ayman, Supabase dashboard)

Supabase Dashboard → your project → **Authentication → JWT Keys** (a.k.a. Signing Keys) →
**Add / Import key** → paste this JWK, which is the **public half only** (no `d` component,
so it can verify and cannot sign):

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

Leave the **existing** key as the active signing key. Ours only needs to be *published in
the JWKS so tokens signed by it verify* — it must not become the key Supabase itself signs
user sessions with.

## Step 2 — verify the import actually took (do not skip)

```bash
curl -s "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/.well-known/jwks.json" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" | python3 -m json.tool | grep kid
```

Before: **one** kid. After: **two**, one of them `ff83fd87-4fbf-4ff4-9aae-f609538947e8`.
If the count did not change, the import did not happen — a green screen in a dashboard is
not evidence.

## Step 3 — private key into Vercel env (lead, once step 1 is confirmed)

`MCP_SIGNING_KEY_JWK` = the full private JWK, as one line, Production + Preview.
Nothing reads it before L3, so this can wait until the import is confirmed.

## Step 4 — prove it end to end, before writing any tool

Mint a token for a known user, use it, and confirm RLS applies:

- sign `{sub: <user uuid>, role: "authenticated", exp: now+300}` with `kid` above
- `createClient(url, anonKey, { global: { headers: { Authorization: "Bearer <jwt>" } } })`
- read a user-scoped table → must return **that user's rows only**
- **then prove the negative**: a JWT signed with the *wrong* key, and one with an expired
  `exp`, must both be **rejected**. A positive-only check here proves nothing — it would
  pass identically against a misconfigured project that ignored the token entirely.

## Rollback

Delete the imported key in the dashboard. The app's own auth is untouched throughout:
the existing key keeps signing real user sessions the whole time, so a failed import or a
removed key breaks MCP only, never login.
