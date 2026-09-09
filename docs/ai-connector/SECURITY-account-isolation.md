# Account isolation — how it is enforced, and the proof

**Question asked:** can a connector/token/AI platform reach *anyone else's* account?
**Answer: no — and this is the evidence, not an assertion.**

## Five independent layers

A cross-account read or write has to defeat **all five**. Each is sufficient alone.

**1. The token names the user; the caller never does.**
`verifyAccessToken` returns `{ userId: row.user_id }` — read from the token's own database
row (`lib/mcp/tokens.ts:250`). Nothing a caller sends influences it. There is no header,
argument or claim that selects an identity.

**2. The minted session JWT's `sub` is that value, and only that value.**
`session.ts` does `.setSubject(userId)` with the value from layer 1. A caller cannot reach
`sub`.

**3. RLS on all 68 tables.** Every table has `rowsecurity = true`; policies are
`auth.uid() = user_id`. The connector uses the *same* RLS-scoped client the web UI uses —
it does not have, and cannot obtain, a privileged one for domain data.

**4. Explicit `.eq("user_id", userId)` on top of RLS.** `read.ts` applies it to every
query (lines 156, 179, 218) — belt-and-braces, matching this codebase's own convention.
A tool that forgot it would *still* be safe; one that has it is safe twice.

**5. `user_id` is structurally not caller-controllable.**
- **0 of 59** `filterableColumns` declarations include `user_id` — it can never appear in a
  caller's filter.
- No write patch accepts it (the only mention near an insert/update is a comment).
- It is *readable* (you can see your own id) and that is all.

Plus, beneath all of it: **composite tenancy FKs** — `(user_id, child_id) → parent(user_id, id)` —
make a row that points at another account's data **unrepresentable**, not merely forbidden.

## The proof: an adversarial test, run against production

Signed a real HS256 session JWT as the **SEED test account**, then attempted to reach
**`ayman.0704m@gmail.com`** (the real daily account):

```
BLOCKED  read prayers                        (victim rows: 0)
BLOCKED  read tasks                          (victim rows: 0)
BLOCKED  read profiles                       (victim rows: 0)
BLOCKED  read work_sessions                  (victim rows: 0 of 50 returned)
BLOCKED  read kill_list_items                (victim rows: 0)
BLOCKED  read books                          (victim rows: 0)
BLOCKED  read mcp_access_tokens              (victim rows: 0 of 9 returned)
BLOCKED  read prayers WHERE user_id=victim   (rows: 0)
BLOCKED  UPDATE victim's task by id          (rows affected: 0)
BLOCKED  victim's task unchanged             (title still "Quiz 1", not "PWNED")
BLOCKED  INSERT row owned by victim          (42501 — RLS violation)
BLOCKED  read victim's MCP tokens            (0 visible)
```

Note test 9-10 specifically: knowing a victim row's **exact primary key** still does not
permit mutating it. Guessing an id is not an attack path.

## Where RLS is deliberately bypassed — audited, all scoped

Service-role (RLS-bypassing) clients exist in exactly four places, none of which read user
data unscoped:

| where | why it must | scoping |
|---|---|---|
| `route.ts` — `verifyAccessToken` | must find the token *before* the user is known | looks up by token hash only |
| `route.ts` — `isUserActive` | R4a: self-signed JWTs bypass GoTrue's own checks | `.eq(id, verified.userId)` |
| `oauth/*` routes | client registration/codes are not user-scoped data | no user data touched |
| `send-push.ts` | the Vault secrets RPC is `service_role`-only | `.eq("user_id", userId)` from the action's owner |

## Scope, on top of identity

Identity answers *whose data*. Scope answers *what may be done*: a token carries
`read`/`write`, enforced before dispatch and audited as `denied` on refusal. A read-only
token cannot write **its own** account either.

## The honest residual risks

1. **The legacy HS256 secret can mint a token for any user.** So can
   `SUPABASE_SERVICE_ROLE_KEY`, which the deployment already held. Treat both as
   equivalent to full access; both live only in Vercel's encrypted env and
   `.credentials.local.md` (gitignored, mode 600).
2. **Prompt injection remains the accepted risk** — a model reading hostile content could
   be induced to call a write tool **on the owner's own account**. Isolation does not
   address this; the mitigations are the audit log, instant revocation, the rate ceiling,
   read-only tokens, and no-hard-deletes.
3. This all protects *between accounts*. Anyone holding a valid token has that account's
   access — which is what a token is for.
