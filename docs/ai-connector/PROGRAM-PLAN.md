# AI Integration Program — layer plan

**Lead:** Opus session. **Engineers:** Eng1, Eng2 (Sonnet).
**Started:** 2026-09-08. **Owner:** Ayman, who has directed this build directly —
which closes the handoff doc's open item #1 ("does Ayman need to sign off").

## The brief, restated

Two independent systems from `docs/superpowers/specs/2026-09-09-ai-integration-handoff.md`:

- **System A** — a remote MCP server so Ayman's *existing* Claude / ChatGPT / Gemini
  subscriptions can read and write real Life OS data from inside those apps.
- **System B** — a low-friction link/picker inside Life OS that opens the chosen platform.

Plus the owner's own instruction: a **straightforward personal-access-token setup**
that replaces the current DeepSeek-API-key method as the way "AI" is configured here.

## Findings that have already changed the plan

The handoff doc is a design document, not a survey of this codebase. Three of its
load-bearing claims failed inspection before any code was written. Recording them here
so nobody re-derives them:

1. **"Every tool is a thin wrapper around the SAME server actions the UI already calls"
   is not implementable as written.** All 35 `"use server"` files authenticate through
   `requireUser()` (`lib/supabase/auth.ts:34`) → `createClient()` (`lib/supabase/server.ts:22`),
   which reads `cookies()`. An MCP request carries a bearer token and no session cookie.
   The *intent* — one source of truth for a valid write — survives; the mechanism must change.
   Resolution pending Eng1's spike.
2. **"Mints a short-lived Supabase user JWT via the admin API" describes an API that does
   not exist.** `@supabase/auth-js` 2.112.2 admin surface is `createUser`, `generateLink`,
   `getUserById`, `listUsers`, `signOut`, `updateUserById`. No `createSession`.
   Resolution pending Eng1's spike.
3. **"The BYO key is used for book→flashcards once a worker exists" is false, and was
   false deliberately.** *(Superseded 2026-10-25, see `.brain/domains/self-mastery.md`: the
   `SELF_MASTERY_INGESTION_URL` gate was retired; ingestion is now gated on a fresh
   `ingestion_driver_heartbeats` row written by the in-app step route that a pg_cron job polls every
   minute, AND on the user having a usable AI key (`hasUsableIngestionKey`, `lib/ai/gateway.ts`).
   The "a credential is not a consumer" reasoning still holds: the key alone never opens the gate.)*
   Original finding: ingestion was gated on `SELF_MASTERY_INGESTION_URL` alone, and
   `lib/self-mastery/ingestion-availability.ts` documented the decision never to wire the BYO key
   into the gate. The ingestion LLM calls now do go through `gatewayChat` with the owner's key.

4. **"ChatGPT and Gemini both accept a plain pasted bearer token; only Claude needs OAuth"
   is wrong, and it inverts the design.** Eng2, against current vendor docs (2026-09-08):
   - **ChatGPT: false.** OpenAI's own docs state ChatGPT "cannot present custom API keys";
     connector auth is OAuth / None / Mixed only. The doc likely confused MCP connectors
     with the older, separate **GPT Actions** product, which does take an API key.
   - **Gemini: unverified, leaning false.** No documentation found for a bearer field in
     consumer "Custom apps for Spark"; a live bug thread shows it auto-attempting full
     OAuth + DCR. Gemini Enterprise offers only None or OAuth 2.0.
   - **Claude: true today**, but Anthropic has shipped a beta `static_headers` bearer path
     gated by an org flag (which is why issue #112 now reads closed/completed). Do not
     architect as though the gap is permanent — but do not depend on a flag we don't have.
   **Net: OAuth is not a Claude-only shim. It is the only auth path any of the three
   consumer apps accept.** Layer L4 is therefore mandatory, not conditional.
5. **DCR is spec-deprecated in favour of CIMD (spec rev 2026-07-28) — but Claude still
   implements 2025-11-25 and still expects DCR.** So a `registration_endpoint` is required
   regardless. Settled: **Streamable HTTP only** (Claude is deprecating SSE; Gemini rejects
   SSE outright). **Redis is not required** — that was a 1.x SSE-resumability concern.

**Real blast radius of removing the DeepSeek feature (Eng1, verified):** exactly one
user-facing behaviour — written feedback on typed answers in a review session
(`app/(app)/personal/answer-feedback-actions.ts:42`), which already fails soft to `null` —
plus the Settings "AI features" panel itself. Nothing else reads `user_api_keys` or `lib/ai/*`.

## Ruling on "replace the DeepSeek API key method"

The connector is **inbound** (a model calls into Life OS). Answer-feedback is **outbound**
(the app calls a model). A consumer subscription cannot serve an outbound API call — that
asymmetry is the entire reason System A exists. So "replace DeepSeek with the connector"
cannot be literal for that one feature.

**Decision:** the *method* is replaced, the *capability* is not silently destroyed.
- Settings gains a `#connectors` PAT panel in **L2**. The `#ai` DeepSeek panel is left
  untouched until **L8** — Eng1 flagged that an earlier draft of this line read as though
  L2 removed it, which would have been a destructive change made on a doc's phrasing.
  Add first, remove only once the replacement is proven.
- The outbound path is **generalised** from `provider in ('deepseek')` to the three
  providers the owner actually named — Gemini, Claude, GPT — so answer-feedback keeps
  working for anyone who supplies a key, and nothing is lost (L8).
- Note for L8: Anthropic is **not** OpenAI-wire-compatible (`x-api-key`, different body),
  so it is a real code change in `lib/ai/client.ts`, not just a table entry — the comment
  in `lib/ai/providers.ts:1-12` claiming "a table entry plus a base URL" is wrong for Claude.

If the owner would rather simply retire answer-feedback, L8 shrinks to a deletion. That is
a one-line change of direction, which is why it is sequenced last.

## One risk stated once, then we build

"Write, no per-call confirmation" + "a model that reads untrusted content" is a known
attack class: content the model ingests can carry instructions, and the model holds a
write-capable tool. The chosen guardrails (audit-before-return, instant revocation, rate
ceiling, no hard deletes) contain and reverse damage; they do not prevent an injected
write. That is an accepted, owner-made tradeoff, recorded here rather than re-litigated.
It does raise the priority of one thing: **the audit log and revocation UI ship in the
same layer as the first write tool, never later** (L6).

**R4 — The auth bridge: locally-signed ES256 JWTs. Zero network round trips.**
Eng1's spike (verified against Next 16.3's own docs and the installed SDK, not from memory):
- The cookie finding is **confirmed**. `cookies()` is a request-time API with no supported
  way to inject an alternate jar. A Server Action called from a Route Handler reads the
  *route's* incoming request, so `requireUser()` throws for any MCP call. Not refutable.
- `admin.createSession` **does not exist** — full admin surface read from the installed
  `.d.ts`. The spec's proposed fix is fiction.
- Self-signing with a symmetric `SUPABASE_JWT_SECRET` is **impossible for this project**:
  it has migrated to ES256/JWKS, and Supabase documents that the private key is not
  extractable once migrated, by design.
- **The mechanism we will use**, which Supabase documents for exactly this backend-
  impersonation case: `supabase gen signing-key --algorithm ES256`, import the **public**
  half into the project's JWT Signing Keys, keep the **private** half in server secrets,
  then mint per-request JWTs locally with `{sub, role:"authenticated", exp}` via `jose`.
  Consumed by `createClient(url, anonKey, { global: { headers: { Authorization: ... } } })`,
  so RLS applies exactly as it does for the UI. **Zero Auth round trips per call** — the
  mirror image of the local ES256 *verify* that `lib/supabase/auth.ts:10-13` already does.
- Rejected `generateLink`+`verifyOtp`: 2 Auth round trips per mint, and an unverified
  rate-limit exposure. (For the record Eng1 did confirm it does *not* email the user and
  that its token is single-use with a 1h default TTL — it simply loses on cost.)

**R4a — the caveat, which is now our responsibility.** A self-signed JWT bypasses GoTrue
entirely, so GoTrue's banned/soft-deleted/disabled-user checks never run. **The PAT
verification step MUST independently confirm the target user exists and is active before
minting.** This is not optional and it is easy to forget, because everything works fine
in testing without it.

**R4b — one-time setup is Ayman's to perform**, since it changes his Supabase project's
auth configuration: generate the keypair, import the public half, place the private half
in Vercel env. Worth noting the security direction: this is a *reduction* in blast radius,
not an increase — the deployment already holds `SUPABASE_SERVICE_ROLE_KEY`, which bypasses
RLS for every user unconditionally. A per-user, short-lived, RLS-respecting token is
strictly weaker than what is already in the environment.

**R5 — Architecture (C) adopted, with a standing refactor rule.**
Each domain gets `core(supabase, userId, ...args)`; the cookie-authed Server Action and the
bearer-authed MCP tool are both thin wrappers over it. Eng1 sampled three files at
different complexity and surveyed all 33: extraction is mechanical, `redirect()` appears in
only 4 files (all auth/onboarding, none of them future MCP tools), and
`app/(app)/distractions/actions.ts` already uses this exact shape internally — in-repo
precedent, not a novel pattern.
**The rule, written down before anyone extracts rather than discovered per-file:** a `core()`
must never call `requireUser()`, `getProfile()`, or `getAuthedUser()`. It receives
`supabase`, `userId`, and any cookie-derived data (profile, timezone) as explicit
arguments. 10 of 33 files call those memoized helpers today and each needs the value
passed down instead.

## Scope expansion (owner, 2026-09-08) and the rulings it forces

The owner expanded scope substantially after L1 shipped. Two parts reverse or refine
earlier decisions, so they are recorded as rulings rather than left in a chat log.

**R6 — DeepSeek is NOT removed. It is repurposed, and this reverses my earlier ruling.**
The owner: book/PDF text "should still be done through a deepseek API key, since that will
be large amounts of text, and the objective will be to split it into batches and feed that
into AI so it can create the reflections/summarizations out of it... a summary of each
section/chapter of the book/pdf should be created, and send those to the AI through MCP
connection not the full/entire book itself."

So the division of labour is now explicit and sensible:
- **DeepSeek (metered API key)** = the bulk-text engine. Book → batches → per-chapter
  summaries. This is genuinely the right tool: it is high-volume, low-value-per-token work
  that a subscription cannot serve and that should not run through a chat context.
- **MCP connector** = exposes the *summaries and reflections*, never the raw book text.
- The Settings *connection story* is still replaced by the PAT/connector panel; the
  DeepSeek key becomes a specific ingestion setting rather than "the AI feature."

Note this resolves, rather than contradicts, Eng1's finding that ingestion was deliberately
never wired to the BYO key. `lib/self-mastery/ingestion-availability.ts:22-35` reasoned "a
credential is not a consumer" — a key lets you *call* a model, but ingestion needs a
process that claims `ingestion_jobs`. That reasoning still holds. **We now have to build
that process.** It does not exist today. New layer, sized honestly (L9).

**R7 — Custom widgets: capability delivered, mechanism deliberately changed.**
The owner asked for the AI to "write the custom code for any custom widget, place it in its
correct spot and make it work 100% accurately," deployable, per-account, without changing
the app's existing architecture. Taken literally that is *arbitrary code execution plus
production deployment, driven by a model, with no confirmation gate* — combined with the
already-accepted prompt-injection exposure, that is the single most dangerous thing in the
program. It is also the least likely to hit "100% accurately," because generated React must
typecheck, build, and not break a live app.

**Ruling: deliver the capability in tiers, defaulting to the safe one.**
- **Tier 1 — declarative widgets (default).** A widget is a *row*, not a file: type, data
  source, slot, styling. Rendered by one audited renderer. Instant (no deploy), per-account
  by RLS, and "cannot change existing app architecture" becomes structurally true rather
  than a policy we hope holds.
- **Tier 2 — custom widget code, sandboxed.** For genuinely novel widgets the agent writes
  component code that is **stored in the database and executed in a restricted client-side
  sandbox** — not written into the repo, not deployed. Still instant, still reversible by
  deleting a row.
- **Tier 3 — real repo code + build + deploy.** Only where tiers 1-2 genuinely cannot
  express it. Hard gate: must pass `tsc` and a real build **before** it can deploy, and it
  refuses on failure. Every change revertable by commit.
- **Themes** (~5 presets + custom colours) and **feature show/hide** are settings rows, not
  code. That covers "remove unwanted features / add features they don't have" safely.

Worth stating plainly: for tiers 1 and 2 **no deploy is needed at all**, which is strictly
better than what was asked for — changes appear immediately instead of after a build. A
deploy tool still ships, for the Tier-3 path and for ordinary code changes.

**R11 — Tiers 2 and 3 are CANCELLED. The declarative vocabulary is extended instead.
This closes R7, which deferred the decision rather than making it.**

R7 tiered the widget capability and defaulted to the safe tier, but left 2 and 3 as
"available if needed." I held them open for hours as "pending the owner's decision." That was
wrong twice: the owner's standing instruction for this program is to decide rather than ask,
and — more importantly — the evidence needed to decide arrived on 2026-09-10 and pointed one
way.

**What changed: Tier 1's isolation is now a proven structural property, not a policy.**
The widget security audit (`docs/ai-connector/WIDGETS-SECURITY-AUDIT.md`, Eng1, committed
as `c7ea86f`; independently re-verified by the lead with a positive control in front of the
scan — both passes recorded under its Provenance section) established that a
widget cannot read anything `read()` would refuse — *because* `lib/widgets/render.ts` calls
the real `readTool()`. Registry allowlists, `fixedFilter`, `parentFilter`, `filterableColumns`
and `truncateColumns` are re-derived from the live registry on every render. Nothing about
what was permitted at widget-creation time is cached anywhere, so there is no stale-capability
state to exploit. Verified invariants: zero entities where a `fixedFilter` column is also
filterable; `source_chunks` exposes no columns at all; no secret-shaped column anywhere in
the registry.

**Tier 2 would destroy exactly that property.** Generated component code does not go through
`readTool()`. The moment a widget executes code rather than declaring a data source, the
isolation argument stops being *"the data path cannot widen"* and becomes *"the sandbox
holds"*. Those are not comparable claims. The first is structural and re-proved on every
render; the second is a perimeter that must resist an adversary — and R7 itself already
records prompt injection as an **accepted** exposure of this program. Accepted injection
exposure combined with code execution is the dangerous product, and the owner's own hardest
requirement was that a connection may only ever reach its own account's data.

**Tier 3 additionally violates a constraint the owner set explicitly** — that this must work
"without changing the app's existing architecture." Repo code plus build plus deploy means a
model can change the application for every account, not just its own row. No `tsc`-and-build
gate makes that per-account, because the artifact is shared by construction.

**Ruling:** Tiers 2 and 3 are not built. The capability the owner actually asked for —
"full autonomy over their domains" — is delivered by widening what a *declarative* widget can
express, which keeps every widget on the one audited render path:

- more kinds (chart/sparkline, progress-against-goal, streak, small table)
- derived values over allowlisted columns (ratios, deltas against a prior period)
- more than one data source per widget
- conditional formatting and thresholds
- explicit ordering, grouping, and slot placement

Each of these is a row shape plus renderer support. None of them can widen data access,
because none of them changes who does the reading. If a future request genuinely cannot be
expressed this way, that is the moment to revisit — with the specific unmet request in hand,
not in the abstract.

**The invariant this ruling depends on, and which must be defended:** `readTool()` has
exactly two callers — the MCP route and `render.ts`. A third caller is the event that
weakens everything above, and should be treated as a design change requiring a ruling, not
a refactor.

**R12 — The 20-row page cap is a MODEL-CONTEXT constraint. It does not apply to the widget
render path, and holding it there blocks two R11 kinds for no benefit.**

`readTool`'s `PAGE_SIZE = 20` (`lib/mcp/tools/read.ts:20`) exists because of R8: every row a
tool returns is spent in a model's context window, and an unbounded read is how a connector
becomes unusable. That reasoning is sound and stays, unchanged, for the MCP route.

**It does not transfer to widgets, and the reason is structural, not a judgement call.**
Verified before ruling:

- `renderWidgets` has exactly **one** caller — `app/(app)/page.tsx:89`, the server-rendered
  Home page. Its output goes into HTML for a human's browser.
- `widget_manage` contains **no render call at all**. Its `list` action returns widget
  *definitions* (`widgetToItem`) — the JSON the model itself authored — never rendered rows.

So there is no path by which a widget's data rows reach a model's context. Raising the row
limit on the render path cannot increase what any AI client can read; it changes page weight
and query cost, which are the human's concerns, not the context window's.

**Why this is blocking rather than cosmetic.** Two of R11's five kinds are time-series by
nature: a sparkline needs ~30 daily points, a streak needs enough history to find a break.
At 20 rows both are not merely truncated, they are *wrong* — a 30-day trend drawn from 20
rows silently misrepresents the period it claims to cover, and a streak computed from a
truncated window reports a break that did not happen. `progress_against_goal` escaped this
only because it degrades honestly (`"20+ / 100"`); a chart has no equivalent honest floor.

**Ruling:** `readTool` gains an optional, explicitly-bounded row limit. Conditions, all of
which are the point:

- **The MCP route's behaviour is unchanged.** It continues to use `PAGE_SIZE = 20`, and does
  not gain the ability to request more. R8 is untouched.
- **Only `render.ts` may pass the higher limit**, and it is bounded by a named constant — not
  caller-supplied, not derived from the widget definition. A model authoring a widget must
  not be able to influence how many rows are fetched.
- **Nothing else changes.** Same columns, same `filterableColumns`, same `fixedFilter` and
  `parentFilter`, same `truncateColumns`, same RLS. This is strictly a volume parameter on an
  otherwise identical query — if the diff touches what is selected or what is filtered, it has
  left the scope of this ruling.
- **The two-caller invariant from `WIDGETS-SECURITY-AUDIT.md` now carries more weight, not
  less.** It was previously "a third caller means the audit no longer covers it"; it is now
  also "a third caller could inherit a limit chosen for a surface it isn't." Enforce it in
  the signature: the raised limit should be impossible to request accidentally.

Worth stating because it is the reusable half: **R8 was applied to the widget path by analogy
rather than by argument.** Both paths call `readTool`, so the cap came along. But a constraint
justified by a consumer only binds where that consumer is downstream — and the widget path's
consumer is a browser. A rule inherited by proximity rather than by reasoning is how a correct
constraint ends up enforced in a place it was never about.

**R8 — Token efficiency is a first-class design constraint, not a polish item.**
The owner named it himself. ~153 exported action functions is the realistic upper bound of
the surface and one-tool-per-action is unusable: every tool's schema is re-sent on every
request. Assigned to Eng2 as a design memo (`TOOL-ARCHITECTURE.md`) before any tool is
written. The specific thing the handoff spec missed: **MCP has Resources and Prompts, not
just Tools**, and Resources are the better primitive for "read literally everything."

## Layers

Each layer is independently shippable and independently provable. A layer is not done
because it was built; it is done when a check that could have failed, didn't.

| L | Goal | Depends on | Owner |
|---|---|---|---|
| **L0** | De-risk: auth bridge + platform-auth reality + transport choice | — | Eng1, Eng2 |
| **L1** | System B — platform link/picker in the shell | — | Eng2 |
| **L2** | Migration 130 + PAT create/revoke Settings UI (added *alongside* `#ai`, which is untouched until L8) | L0 | Eng1 |
| **L3** | MCP server, bearer auth, audit, rate limit, 2 read tools | L2 | Lead + Eng1 |
| **L4** | OAuth 2.1 authorization server — **mandatory, all three platforms** | L3 | Eng2 |
| **L5** | Read tools, all domains | L3 | both |
| **L6** | Write tools **with** guardrails hardening — ship together | L5 | both |
| **L7** | Scheduling: `mcp_scheduled_actions` + pg_cron poll | L6 | Eng1 |
| **L8** | Settings consolidation; DeepSeek repositioned as the ingestion engine | L2 | Eng2 |
| **L9** | Book ingestion worker: PDF → batches → per-chapter summaries (DeepSeek) | L6 | Eng1 |
| **L10** | Themes (5 presets) + feature show/hide toggles | L6 | Eng2 |
| **L11** | Custom widgets — Tier 1 declarative only, per R11 below (Tiers 2/3 cancelled; capability delivered by extending the declarative vocabulary instead) | L10 | both |
| **L12** | ~~Deploy tool + Tier 3 gated code path~~ — **CANCELLED by R11** (below), same ruling that cancelled Tier 2 | L11 | Lead |

**R9 — "unlog" gets a real `'unlogged'` status. The app keeps its DELETE. Approved.**
Eng1 found that the obvious way to express "uncheck a prayer" without a hard delete —
storing `status:'pending'` — is *actively wrong*. `effectivePrayerStatus`
(`lib/deen/prayer-status.ts`) does `if (stored) return stored`, so any stored value is
returned literally and forever, and the prayer would never fall through to the
window-based re-derivation an **absent** row gets as the clock moves. It would freeze at
"pending" permanently, and that value feeds streaks, the qada backlog, the consistency grid
and Home's priority feed. They left the action unwired with an honest "unknown action"
error rather than shipping a plausible wrong answer.

**Ruling: build the `'unlogged'` status** — a new allowed value plus
`if (stored && stored !== "unlogged") return stored`, so an `'unlogged'` row behaves
*exactly* like an absent one while preserving history. Small, scoped, and arguably better
than today's DELETE.

**And the asymmetry is deliberate, not an oversight:** the app's own `unmarkPrayer` keeps
its DELETE. A person deleting their own row in their own UI is acting on their own data
with intent. The no-hard-delete rule exists because **an MCP tool call may originate from a
model acting on content it was injected with** — the restriction is about the actor, not
the operation. Both paths converge on the same effective status, so nothing downstream can
tell them apart.

**R10 — Vercel bot protection can silently kill the connector. Found by accident; treat as a
standing operational risk.**

At ~05:55 the production alias began returning **403 "Vercel Security Checkpoint — We're
verifying your browser"** to *every* path, `/api/mcp` included. The direct deployment URL
returned 200 throughout, so the app was fine — the mitigation was applied to the alias,
almost certainly triggered by our own volume (repeated 140-test suites, MCP probes, 8
deploys in a few hours). It cleared on its own within minutes, and re-running the affected
specs gave 10 passed / exit 0. **The 11 failures were infrastructure, not code.**

The implication is not transient, and it matters more than the incident:

**An MCP client is not a browser. It cannot solve a JavaScript challenge.** If Vercel's
protection engages on the production domain while Claude/ChatGPT/Gemini is connected, the
connector does not degrade — it dies, with a 403 the model will surface as an opaque
failure. Nothing in our code can detect or work around it, because the request never
reaches us.

Actions:
1. **`/api/mcp` and `/.well-known/*` must be excluded from bot protection / Attack Challenge
   Mode** in the Vercel project's firewall config. This is a dashboard setting on Ayman's
   account, so it is his to apply — added to the handover.
2. **Moderate test volume against the production alias.** Prefer the direct deployment URL
   for protocol probes; reserve full-suite runs for real checkpoints rather than after every
   deploy.
3. **A 403 on `/api/mcp` is now a known diagnosis**, not a mystery. Anyone seeing the
   connector fail wholesale should check for the checkpoint page before debugging auth.

Recorded because it cost real investigation time and looked exactly like an 11-test code
regression. The tell was that every failure was Mobile-only — which was not a mobile bug at
all, but simply the projects that happened to run after the mitigation engaged.

### Status board (updated as layers land)

| L | state | evidence |
|---|---|---|
| **L0-L4** | **LIVE + PROVEN** | connector live; OAuth 30/30 + consent 14/14 vs production; `initialize`/`tools/list`/`list_capabilities` all working with a real MCP client |
| **L5** read fan-out | **LIVE, all domains** | 13 domains, 57 entities, re-counted directly against `REGISTRY` (not carried over from an earlier pass): deen(8), work(3), business(2), school(6), fitness(15), self_mastery(12), settings(3), checkins(2), distractions(4), review(1). calendar/home remain honest zero-entity aggregation domains; widgets(1) added for L11 |
| **L6** write | **LIVE, 9 domains** | deen, work, business, school, fitness, checkins, distractions, settings, self_mastery — 50 registered write actions total, re-counted directly against `WRITE_REGISTRY` |
| **L7** scheduling | **LIVE** | `mcp_scheduled_actions` + pg_cron poll registered (`OPERATOR-ACTIONS-PENDING.md` #2); every write action carries an explicit `idempotent` verdict (32 true / 18 false / 0 unannotated) and the scheduler gate (`lib/scheduling/scheduler-core.ts`) refuses anything not explicitly `idempotent: true` |
| **L9** book ingestion | code present, **not independently re-verified this pass** | `app/api/self-mastery/ingestion`, `lib/self-mastery/ingestion*`, migrations 074/107/109 exist — don't cite this row as proof of end-to-end correctness without checking it directly |
| **L10** themes/features | **LIVE** | 5 presets, feature show/hide, `home`+`settings` structurally un-hideable |
| **L11** widgets | **LIVE, Tier 1 only, per R11** | `metric_card`/`list` fully live (DB CHECK + validate.ts + render.ts all agree). `progress_against_goal`/`sparkline`/`streak` are built at the validation/action-core layer, but migration 141's own `kind` CHECK (`in ('metric_card','list')`) was never widened to admit them — **verify against the live schema before claiming any of the three is actually creatable.** `streak` additionally has no render.ts branch at all yet (falls through to the `list` rendering code, which reads the wrong display shape) even setting the CHECK aside. Not schedulable via `scheduler_manage` regardless (widget_manage sits outside `WRITE_REGISTRY`, `TOOL-ARCHITECTURE.md` §6) |
| **L12** | **CANCELLED by R11** | Tier 3 (deploy tool + gated repo-code path) cancelled alongside Tier 2, same ruling |

**Migrations applied tonight: 130-137**, every one hash-verified and proven red-then-green
on production. Four of them (133, 135, 136, 137) exist for the same reason: the
architecture's "`updated_at` on every entity" rule had **no schema behind it** — a
trigger-maintained `updated_at` existed on exactly 1 of 68 tables. Each was scoped by
reading real write paths, and each excluded at least one table that turned out to be
genuinely append-only.

**Known gaps in "read everything", chosen with reasons rather than missed:**
- `schedule_event_overrides`/`cancellations` — parent-owned, awaiting `parentFilter`.
  Denormalising a `domain` column onto them was considered and **rejected**: a second
  source of truth for a fact that already exists will drift.
- Night Plan tasks (`domain IS NULL`) — `fixedFilter` can only express equality. Ruled:
  it gains a null-discriminant, then `review.night_plan_task` registers on it.

**Blocked on Ayman:** (1) the ES256 public-key import — the only thing between all of this
and real data; (2) excluding `/api/mcp` + `/.well-known/*` from Vercel bot protection (R10).

### Exit criteria (the part that matters)

Carried over from the 2026-09-02 incident review, because they were paid for:

- **A check that examines nothing reports success.** Before trusting any check, seed the
  fixture to the shape of the bug and confirm the check FAILS first. A green you did not
  earn is not evidence.
- **Assert the property, not a proxy.** For auth: prove a *wrong* token is rejected, not
  only that a right one is accepted. The negative case is what makes the positive mean
  anything (same discipline as `app/api/cron/ping/route.ts`).
- **`playwright test | tail` returns tail's exit code.** Never read a suite result through
  a pipe. Only the Lead runs Playwright — the e2e environment is single-occupancy.
- Per-layer: `tsc --noEmit` unfiltered + `vitest` + a real user-POV Playwright pass, and
  for L3+ a genuine MCP protocol round-trip driven by `@modelcontextprotocol/sdk` (1.30.0,
  already in the tree) against the deployed URL.

### Verification boundary — stated now so it is not discovered late

We can prove our server is correct at the protocol level ourselves. We **cannot** prove
Claude/ChatGPT/Gemini accept it without adding a connector inside Ayman's own accounts,
which is a change to his accounts and is his to make. L3/L4 therefore end with a
ready-to-paste URL and a short instruction, not with a claim that the connector works.
Anything else would be asserting a result we never observed.

## Standing rulings

**R1 — The PAT is not the connection method for the phone apps; OAuth is.**
Since none of the three accepts a pasted token, connecting becomes: paste URL →
OAuth click-through. That is *easier* for the owner than copying a token. The PAT is
still built and still earns its place: it is the credential `/token` mints, and it is
working auth for clients that DO take bearer headers (Claude Code, Gemini CLI, scripts).
The owner's "easy personal access token setup" is satisfied — it just isn't the path
claude.ai uses.

**R2 — No third-party IdP (Clerk / WorkOS / Stytch).** Eng2 recommended delegating the
authorization-server side; that is the industry default and it is wrong here.
(a) Identity is Supabase — a second IdP creates an identity-bridging problem more complex
than the ~150 lines it avoids. (b) One user, already logged into Life OS on the same
domain: `/authorize` can check the existing session and issue a code immediately — no
login UI, no consent UI. (c) A personal app should not acquire a third-party billing
relationship and an external outage surface to serve one person.
**Status: provisional — to be red-teamed by Eng2 before L4 begins.** If it survives an
honest attempt to break it, it stands; if not, it changes.

**R2 RESOLVED (Eng2 red-team, 2026-09-08). R2 stands, but only on reason (c) — (a) does
not survive the numbers, and (b) is true but doesn't favor either side.**

- **Reason (a) is wrong on the arithmetic and is retracted, not just softened.** A
  *correct* hand-rolled implementation is not ~150 lines — enumerating what OAuth 2.1 +
  the MCP spec actually require (PKCE S256 verification, single-use codes with an atomic
  consume, exact redirect_uri matching, DCR client validation/storage, refresh-token
  rotation with reuse detection, the two `.well-known` documents) comes to roughly
  400-600 lines of security-critical code, built and landed as L4. Meanwhile, for a
  genuinely single-user app, "the identity-bridging problem" a delegated IdP would create
  is NOT a general multi-tenant mapping system — it is a JWT-signature verify plus a
  one-row (or literally an env-var) lookup, reusing R4's already-built local-JWT-mint
  step unchanged. Honest accounting: ~500 lines hand-rolled vs. ~50-70 lines delegated.
  The line-count comparison in the original ruling ran backwards.
- **Reason (b) (no login/consent UI needed) is true and was fully consumed by both
  options — it isn't a point in favor of hand-rolling specifically.** A hosted IdP also
  needs no custom login UI from us (it brings its own); this reason lowers the cost of
  *whichever* path is taken, it doesn't discriminate between them.
- **Reason (c) — avoid a third-party billing relationship and outage surface for
  infrastructure serving one person, forever — is not a security or line-count argument
  and it survives untouched.** This is the reason R2 stands on.
- **The real finding, independent of which way R2 went: the plan's "no consent screen"
  simplification is a genuine vulnerability, not a UX shortcut, and had to be added back
  regardless of the IdP question.** `/register` (DCR) is a public, unauthenticated
  endpoint by design (RFC 7591) — anyone can register their OWN client with their OWN
  redirect_uri and craft a link to `/authorize` naming it. If `/authorize` auto-approved
  any registered client for an already-logged-in session (the original plan), that link
  would complete a full authorization-code-interception attack against Ayman's account
  the instant he clicked it, with nothing to notice — the classic "confused deputy" OAuth
  attack class, and precisely the attack a hosted IdP's default consent screen would have
  blocked for free. **"Which user" was never what a consent screen answers here — "does
  this look like the app you meant to connect" is, and that question doesn't go away
  just because there's only one user.** L4 (`app/api/mcp/oauth/authorize/route.ts`) ships
  with a mandatory confirmation screen naming the requesting client and its exact
  redirect host; see `lib/mcp/authorize-page.ts`'s header for the full reasoning.
- A hosted IdP would also very plausibly get several of the subtler things right that a
  hand-rolled implementation has to remember on its own: PKCE method/downgrade rejection,
  redirect_uri exact-match edge cases, refresh-token reuse detection. None of these are
  hypothetical in this build — all are implemented in L4, but they are exactly the kind
  of detail a mature IdP has already hardened and this codebase has to get right once,
  from scratch, under time pressure.

**R2a — I was wrong, and the red-team found a real vulnerability in MY design.**
I ruled that `/authorize` should auto-approve: "no consent screen with buttons for a second
user who doesn't exist." That reasoning was about *identity* — and identity was never the
question a consent screen answers here.

`/register` is a **public endpoint by design** (RFC 7591 DCR, and Claude requires it). So
anyone on the internet can register a client with **their own redirect_uri**. Combine that
with an auto-approving `/authorize` and you have a complete authorization-code-interception
attack: register a client, craft an `/authorize` link naming it, get Ayman to click it while
he is logged in, and silently receive a valid code **at the attacker's own server**. No
prompt, no trace, full access to every domain of his data.

That is my bug. It was live in the plan and would have shipped. Eng2 found it by taking the
red-team assignment seriously instead of confirming my ruling.

**The fix, now mandatory and non-negotiable:** `/authorize` renders a real confirmation
screen naming the client and its exact redirect host, with explicit Allow/Deny. The question
it asks is not "who are you" but **"is this the app you meant to connect?"** — and DCR being
public is precisely why a stranger can now cause that question to be asked.

**R2b — R2 stands, but only on its third leg. Two of my three reasons were wrong.**
Eng2 red-teamed honestly and reported numbers that favoured the position they had originally
argued for, rather than converging on my view:
- **(a) "~150 lines" — retracted.** A correct implementation is ~400-600 lines: PKCE S256,
  atomic single-use code consumption, exact redirect_uri matching, DCR client storage,
  refresh rotation with reuse detection, two metadata documents. Delegated would be ~50-70.
  My estimate was off by 4x and it was the reason I leaned hardest on.
- **(b) "no login/consent UI needed" — symmetric, favours neither.** A hosted IdP needs no
  custom login UI from us either.
- **(c) "no third-party billing relationship or external outage surface for infrastructure
  serving exactly one person, forever" — survives untouched.** R2 now rests on (c) alone,
  plus the fact that the code is written, tested (144 tests), and its one real flaw was
  caught by adversarial review rather than by delegation.
Recorded this way deliberately: a ruling that survives for one of the three reasons it was
made is not the same ruling, and pretending otherwise would make the next estimate worse.

**R3 — Dependencies verified against this repo, not assumed.** `mcp-handler` 2.1.1 needs
Node 20+/zod ^4.2.0/Next 13+; this repo has Node 24.9.0, zod 4.4.3, Next 16.3.0. It also
needs `@modelcontextprotocol/server` v2 — note the `@modelcontextprotocol/sdk` 1.30.0
already present is a *different, older, transitive* package, not that peer.

## Coordination

Both engineers work read-only until L1. From L2 the working tree is shared, so
`./scripts/agent-commit.sh "msg" <explicit paths>` is mandatory — never `git add -A`,
never `git commit -a`. Branch: `ai-connector`, merged to main per completed layer.
