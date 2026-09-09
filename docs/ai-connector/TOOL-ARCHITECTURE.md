# MCP Tool Architecture — design memo

**Author:** Eng2. **Status:** design only, no code in this pass, per assignment.
**Reads first:** `docs/ai-connector/PROGRAM-PLAN.md` (R4, R5), `docs/ai-connector/DATA-INVENTORY.md`
(the Lead's production pull — 68 tables, RLS on all of them — folded into §5 below rather than
this memo's original rougher domain sketch), `docs/superpowers/specs/2026-09-09-ai-integration-handoff.md`
§3, the owner's expanded-scope message (quoted in full at the bottom of PROGRAM-PLAN's originating
thread, restated in the task that produced this memo).

**Revision note:** this version supersedes the first pass's domain/table grounding with the
Lead's real production inventory (68 tables, exact row/column counts), corrects the self-mastery
read surface against what the database actually contains (source chunks and embeddings exist;
book-section summaries do not), and adds §5 below as a **named** part of the design rather than a
footnote, per the Lead's explicit request.

---

## Recommendation, stated plainly

**Do not expose MCP Resources as the primary read interface, and do not expose the ~150
`core()` functions as ~150 (or even ~60) individual MCP Tools.** Both fail the owner's own
stated constraint — token-efficient, on-demand, no compromise on performance — for reasons
verified below, not assumed.

**Build seven tools**, each generic and parameterized over a `domain`/`entity`/`action` matrix,
plus one discovery tool that lets the model learn the matrix's shape on demand instead of us
shipping it as upfront schema:

| # | Tool | Purpose |
|---|---|---|
| 1 | `list_capabilities` | Discovery: what domains/entities/actions/fields exist, fetched on demand, not preloaded |
| 2 | `read` | Every read across every domain: goals, metrics, logs, reminders, settings, ULM summaries, calendar, insights |
| 3 | `search` | Free-text search, single-string query — also satisfies ChatGPT's deep-research `search` tool-shape convention |
| 4 | `fetch` | Single-ID lookup — pairs with `search`, also satisfies ChatGPT's deep-research `fetch` convention |
| 5 | `write` | Every write across every domain: create/update/set/log/check-off/toggle/reorder/archive |
| 6 | `scheduler_manage` | Create/list/cancel rows in `mcp_scheduled_actions` — shape is genuinely different from a domain write |
| 7 | `widget_manage` | Create/update/delete a **declarative widget config** — explicitly NOT arbitrary code execution; see §6 |

Every one of the ~150-160 existing `core()` functions still gets called — nothing about this
collapses functionality. What collapses is the number of **top-level tool schemas** shipped into
every conversation, from "one per operation" (150+, an automatic disqualification by every
source consulted below) down to 7, with the domain/entity/action vocabulary itself pushed behind
`list_capabilities` rather than baked into 150 separate JSON Schemas.

The Lead's production data pull (`docs/ai-connector/DATA-INVENTORY.md`) settles the read side of
this by arithmetic before the token-cost argument even needs to run: **68 tables, RLS enabled on
every one.** One read tool per table is 68 tools before a single write tool exists, which is
already past every "too many tools" threshold in §2 on its own. The flat-tool design is dead on
arrival independent of the token-cost evidence below — that evidence explains *why* it's dead,
this number is *proof* it's dead.

The rest of this memo answers the five questions in order, with the evidence, then gives the
concrete taxonomy and the two things flagged rather than resolved.

---

## 1. MCP Resources vs Tools — Resources are not viable as the primary interface

**Verified, not assumed, for all three platforms:**

- **ChatGPT: Resources are not model-readable at all**, confirmed by OpenAI staff on OpenAI's own
  developer forum (2026-06-25): *"Does ChatGPT Apps currently support reading standard MCP
  resources for agent guidance and shared knowledge? No, I would recommend using server
  instructions for this for now."* (community.openai.com/t/does-chatgpt-apps-support-reading-standard-mcp-resources/1384027,
  answered by an OpenAI community team member `casey-chow`). A follow-up reply in the same thread
  independently recommends the same workaround we're landing on: *"I'd keep the tool descriptions
  tiny but add an explicit tool like `get_workflow_guidance(scope)`."* This alone rules out
  Resources as the primary channel — one of our three target platforms cannot use them at all.
- **Claude: Resources are supported for reading, but the interaction model is host/user-driven,
  not model-driven** — a structural mismatch with our need, not just a platform gap. The MCP
  spec itself is explicit that Resources are "application-driven": *"host applications determine
  how to incorporate context... applications could expose resources through UI elements for
  explicit selection... implementations are free to expose resources through any interface
  pattern"* (modelcontextprotocol.info/docs/concepts/resources). The same page separately notes
  *"Claude Desktop currently requires users to explicitly select resources before they can be
  used."* Claude's own connector docs (`claude.com/docs/connectors/building`, checked 2026-09-08)
  list resources under "Supported," but list "Resource subscriptions" under "Not yet supported."
  Even where resources work, the pattern is "the user manually attaches a document," the same as
  attaching a file to a chat — not "the model notices mid-conversation it needs today's Deen
  status and fetches it." Tools are model-invoked on demand; Resources are host/user-invoked
  context. We need the former.
- **Gemini: unverified.** No documentation found describing resources/list + resources/read
  support in the consumer "Custom apps for Spark" surface either way. Not asserting either
  direction — marking unverified rather than guessing, per this program's own standing rule.

**Ruling:** Tools are the only channel confirmed to work as "the model decides what it needs and
fetches it" across the platforms we're actually targeting. Resources are rejected as the primary
interface. (A future, separate consideration — out of scope here — is exposing a couple of truly
static, rarely-changing documents, e.g. an app glossary, as Resources for the two platforms that
do support them, as a pure bonus with no dependency. Not pursued in this design because it can't
be the load-bearing mechanism and shouldn't complicate the tool-first design.)

---

## 2. Tool-list token cost — quantified, and why we can't rely on host-side compression

**The cost is real and well-documented, not a hypothetical:**

- GitHub's own official MCP server exposes 94 tools at ~17,600 tokens, no compression
  (atlassian.com/blog/development/mcp-compression-preventing-tool-bloat-in-ai-agents, 2026-04-20,
  Atlassian Labs' own measurement of a third party's server they built a compressor against).
  Atlassian's own Jira+Confluence server costs ~10k tokens.
- Independent measurement (`bump.sh/blog/4-rules-to-build-an-efficient-mcp-server`, 2026-06-23):
  *"A Claude user measured that just seven MCP servers consumed more than 67,000 tokens of tool
  definitions before the first prompt was even entered."*
- A GitHub Issue against the MCP spec itself (`modelcontextprotocol/modelcontextprotocol#2808`,
  2026-05-28) measured 11 production tools and found schema-heavy tools running **~1,000 tokens
  each**, versus ~100 tokens for a trivial tool — the delta is almost entirely JSON Schema
  size (parameter descriptions, nested object shapes), not the tool name or a one-line
  description.
- Rough, convergent rule of thumb across four independent sources: **150–1,000 tokens per tool**,
  scaling with schema complexity, not tool count alone. At 150-160 flat tools mirroring every
  `core()` function 1:1, even at the *low* end (150 tok/tool) that's ~22,500–24,000 tokens of pure
  schema before a single message — paid on **every turn** per the spec issue's finding, not just
  once, because the tool list is resent whenever the client (re)negotiates or on any host that
  doesn't aggressively prompt-cache the prefix.

**Is there a spec-level discovery method we can lean on?** No — checked, and it does not exist
yet. `modelcontextprotocol/modelcontextprotocol` Discussion #1923 proposes exactly this
(`tools/list_summary` returning name+title only, `tools/get` returning full schema on demand,
claimed 90% reduction) — but it is an open **Discussion**, not a merged spec change. The current
2026-07-28 spec's own "Client Best Practices" doc names *"Progressive Tool Discovery"* as a
pattern, but describes it as something a **host** may choose to implement client-side (e.g.
Claude Code's tool-search-and-lazy-load, confirmed shipped since January 2026 per
`bump.sh`'s piece) — not a protocol method our server can invoke. Two consequences:

1. We cannot assume the wire protocol will save us — there is no standard "send names only,
   details later" `tools/list` variant to use.
2. We cannot assume the **host** will save us either, for our actual target surfaces. Claude
   Code's lazy tool-search is a documented behavior of the Claude Code CLI/IDE product
   specifically; there is no equivalent documented for the claude.ai/ChatGPT/Gemini **consumer
   connector** surfaces this program targets, and assuming parity would be exactly the kind of
   unverified guess this program has repeatedly paid for elsewhere (see PROGRAM-PLAN's own
   findings log).

**Ruling — do the progressive disclosure ourselves, one layer down:** since neither the wire
protocol nor the host is guaranteed to compress the tool list for us, our server does it at the
**application** level: 7 tiny, generic top-level tool schemas (domain/entity/action are plain
strings in the schema, not closed enums enumerating every value — the enumeration itself lives
behind `list_capabilities`, called once early in a session or on a validation error, and
answerable per-domain so it's never the whole app's shape in one response). This is the same
idea GitHub's own production MCP server ships as a **first-party pattern**
(`mcpcat.io/blog/mcp-server-best-practices`, citing GitHub's `ListAvailableToolsets` /
`GetToolsetTools` / `EnableToolset`), just implemented as an explicit tool call instead of a
dynamic `tools/list_changed` notification — because whether claude.ai/ChatGPT/Gemini's connector
brokers honor `notifications/tools/list_changed` for a remote custom connector is *also*
unverified, and our design should not depend on it working identically across three consumer
UIs we don't control. A static, always-the-same 7-tool schema needs no notification support at
all — it is correct by construction, on every client, forever.

Independent confirmation this is the right shape, not just our own reasoning:
- Workato's MCP design guide (`docs.workato.com/en/mcp/mcp-server-design`): *"Don't map 1:1 APIs
  to tools... Use tool count as a signal... 20+ tools in one server"* is explicitly listed as
  the "not recommended" case; recommends grouping around workflows.
- `mcpbundles.com`'s "Six-Tool Pattern": *"Most servers can go from 12-18 tools down to 6-8
  through this consolidation"* — landing almost exactly on our 7.
- AWS's own `awslabs/mcp` design guidelines and `awesome-mcp-best-practices`
  (`lirantal/awesome-mcp-best-practices`) both state the same principle under different names:
  "abstract server capabilities," "don't map 1:1 APIs to tools."

---

## 3. Field selection & response shaping — the uniform convention, and an explicit visibility registry

**Two different questions get answered by two different mechanisms, and this design keeps them
separate on purpose:** *whose row is this* (row-level tenancy) is answered by RLS, inherited,
free, and out of this design's hands to get wrong. *Should this table or column ever reach a
model at all* (is it internal/operational, or does it contain a secret even for its own owner) is
a question RLS was never built to answer and does not answer — it has to be a decision this
design makes explicitly, table by table and, in at least one confirmed case, column by column.

**RLS is inherited protection for the first question, and the data inventory confirms it holds.**
All 68 tables have `rowsecurity = true`. Two carry no policies at all
(`migration_ledger`, `migration_115_orphaned_group_weight_log`) — RLS-on-with-no-policy is
deny-all to a normal authenticated role, so those two are already invisible to any MCP tool built
on the R4 minted-JWT bridge, with zero code from us. This is the right shape for R4 to lean on:
we are not adding tenancy protection at the tool layer, we're inheriting protection the database
already enforces, so a tool that forgets to filter by `user_id` still cannot cross accounts. This
property must survive implementation unchanged — every `read`/`write` dispatch goes through the
same RLS-respecting client every UI Server Action already uses (per R5's `core(supabase, userId,
...)` shape), never a service-role client, no exceptions, for exactly this reason.

**But RLS answers "whose row," not "should the model see this," and the inventory surfaces two
real cases where those answers diverge — this is why the registry has to be explicit, not
assumed:**

1. **A third operational table, `pending_storage_deletions`, is not one of the two RLS-deny-all
   tables** — meaning it may well have a normal user-scoped policy that would let a query through
   RLS just fine, and it still must not be exposed (it's deletion-queue bookkeeping, not
   something a conversation should ever surface). RLS passing a query is not the same fact as
   "this belongs in `list_capabilities`." **Table-level exclusion is therefore an explicit
   allowlist of domains/entities `list_capabilities` will name, not "everything RLS lets through,
   minus a denylist"** — an allowlist fails closed on a table nobody remembered to exclude; a
   denylist fails open on exactly that table. Given the owner's own accepted "write, no
   confirmation" risk tradeoff, failing closed on new/forgotten tables is the correct default.
2. **`user_api_keys` is user-scoped, so it legitimately qualifies for "read everything including
   settings," and it still stores a secret** — an encrypted DeepSeek API key, not something that
   should reach a model's context even for the account's own owner (a model that can read a key
   is a model that can be manipulated into repeating it back, or into using it somewhere it
   shouldn't). The app has already solved exactly this problem once:
   `app/(app)/settings/api-key-actions.ts`'s `getApiKeyStatuses()` selects
   `"provider, key_last4, label, created_at"` explicitly — never `encrypted_key` — off the same
   table. **The MCP `settings`/`user_api_keys` entity copies that exact projection, not the whole
   row.** This is the concrete, named instance of a **field-level** exclusion: the entity is
   readable, most of its columns are not, and the cut is per-column, decided once, centrally, not
   left to a `fields` parameter the model could otherwise widen to `["*"]`.

**The mechanism, generalized:** every entity in the internal dispatch table (§5) carries its own
column allowlist — the literal `.select("...")` projection its handler is permitted to run —
independent of and narrower than "every column RLS would return." `detail`/`fields` (below)
operate *within* that allowlist; they can narrow what's returned, never widen it past what the
entity's registered projection permits. A `fields` request for `encrypted_key` is rejected the
same way an unknown `action` string is rejected in §5 — a clear error, not a silent 200 with the
value in it. This also gives `source_chunks` (self-mastery domain) its own worked case: the table
holds the actual book text and embeddings the owner was explicit should stay on the DeepSeek path,
never MCP (see §5's self-mastery entry) — its allowlist for the MCP `read` entity is empty; the
table is registered as excluded the same way the two deny-all operational tables are, just
decided by us instead of by Postgres.

### Uniform response shaping

Applied identically to every tool that returns data (`read`, `search`, `fetch`,
`list_capabilities`), because per Workato's own explicit warning, inconsistency here is what
makes a large surface unusable, not the tool count itself:

- **`detail: "ids" | "summary" | "full"`** (default `"summary"`). `"ids"` returns only
  `{id, updated_at}` per row — the cheapest possible "did anything change" scan, see §4.
  `"summary"` returns the fields a human would see on the relevant card/list view in the app
  itself (no re-derivation of what "summary" means per entity — it's the same projection the UI
  already renders, so there's exactly one definition of "the short view" per entity, not two).
  `"full"` returns every column, for when the model is about to edit something and needs the
  complete row to construct a correct patch.
- **`fields?: string[]`** — an explicit override list, for the rare case the model wants exactly
  two fields from a `"full"` row without paying for the rest. Additive on top of `detail`, not a
  replacement for it — most calls won't need it.
- **Pagination, identical shape everywhere lists appear:**
  `{ items: [...], has_more: boolean, cursor: string | null }`. Matches the explicit
  recommendation in `docs.workato.com/en/mcp/mcp-server-design` ("Explicitly define pagination...
  Silent truncation" shown as the anti-pattern) and is the same shape independently recommended
  in `apexnova-dev/opencode`'s best-practices compilation. Default page size kept small (20,
  matching the "20-50 items is typical" convergence in that same source) — the model can always
  ask for another page; it can't un-spend tokens on a page it didn't need.
- **Stable IDs on every entity, at every detail level, no exceptions** — already true throughout
  (Supabase `uuid` primary keys per the existing schema), just made a **hard rule for the MCP
  layer specifically**: a lower detail level may drop every other field, never the id.

---

## 4. Reuse / caching — pull-based, because push is unverified

The owner's ask — "reuse information it probably already has" — has an obvious push-based
answer (MCP resource subscriptions, `notifications/resources/updated`) and it does not survive
contact with actual client support:

- MCP's own community forum states it plainly: *"Most clients just don't support this, even
  Claude I think"* (`github.com/orgs/modelcontextprotocol/discussions/301`, on `resources/subscribe`).
  Nothing found contradicts this for any of Claude/ChatGPT/Gemini's consumer connector surfaces.
  Genuinely unverified whether any of the three honors either the 2025-era
  `resources/subscribe` or the 2026-07-28 `subscriptions/listen` stream for a remote connector —
  and Resources are already rejected as the primary channel per §1 regardless.

**Ruling: pull-based freshness, not push.** This needs no client capability beyond calling a
tool, which is the one thing all three definitely do:
- Every entity carries `updated_at` (or an equivalent version marker) at **every** detail level
  per §3's hard rule — cheap (one ISO timestamp), and it's the thing a model can literally quote
  back from earlier in the same conversation to reason "have I already seen the current version
  of this."
- `read(detail:"ids")` is the deliberate mechanism for "reuse, don't re-fetch": scanning an
  entire list at `{id, updated_at}` costs roughly 10-20 tokens per row (per the token-cost
  sources in §2, an ID + timestamp is near the floor of what a JSON row can cost), letting the
  model check "did anything in this list change since I last read it" before paying for a
  `"full"` re-fetch of rows that didn't move. This is the practical shape of "token-efficient,
  doesn't compromise on performance" the owner asked for — not a caching layer we build and
  maintain, just a cheap enough read path that asking "what changed" is never the expensive
  option.
- No behavior in this design depends on a client acting on a notification it might silently
  drop. Every safety property (audit-before-return, rate ceiling, etc.) already committed to in
  PROGRAM-PLAN survives untouched, since none of them assumed push delivery either.

---

## 5. The namespace — concrete tool list and domain/entity matrix

**Top-level tools (7 + discovery = the whole surface, restated with shapes):**

```
list_capabilities(domain?: string) -> { domains: [...] } | { entities, actions, fields }
read(domain, entity, id?, filter?, detail?, fields?, cursor?) -> item | { items, has_more, cursor }
search(query: string, domain?: string) -> { items: [{id, snippet}], has_more, cursor }
fetch(id: string, domain: string, entity: string) -> item   (full detail; pairs with search)
write(domain, entity, action, id?, patch?) -> { id, updated_at }
scheduler_manage(action: "list"|"create"|"cancel", ...) -> ...
widget_manage(action: "list"|"create"|"update"|"delete", ...) -> ...  (see §6 — gated)
```

`search`/`fetch` are thin aliases over the same internal dispatch `read` uses — not a second
implementation — added specifically because OpenAI's Responses/Apps surface has a documented
"deep research" mode that requires exactly a `search(query)` + `fetch(id)` tool pair
(`mcpbundles.com/blog/mcp-tool-design-pattern`: *"These are your fetch and search tools. They
follow OpenAI's MCP requirements — single-string parameters that work with ChatGPT's deep
research mode."*). Free to satisfy at near-zero marginal cost given `read` already exists; not
adding logic, just a second name for it.

**`domain` values**, one string enum, mirrored from the Lead's real production inventory
(`docs/ai-connector/DATA-INVENTORY.md` — 68 tables, pulled from production, not from the schema
files) rather than the handoff doc's five-domain sketch or this memo's own first-pass guess:

| domain | tables (count) | grounds it |
|---|---|---|
| `home` | — | cross-cutting per PURPOSE-AND-DOMAINS.md; aggregation across other domains, no tables/writes of its own |
| `deen` | `prayers`, `sunnah_logs`, `adhkar_logs`, `quran_sessions`, `deen_habits`, `deen_habit_logs`, `deen_weekly_focus`, `reflection_entries` (8) | matches `app/(app)/deen/{actions,salah-calendar-actions}.ts` — 20 action functions |
| `work` / `business` | `tasks`, `work_sessions`, `weekly_goals`, `kill_list_items`, `coop_targets`, `coop_tasks` (6) | matches `app/(app)/work/*` (27 functions) + `app/(app)/business/*` (8) |
| `school` | `classes`, `class_assessments`, `schedule_events`, `schedule_event_overrides`, `schedule_event_cancellations` (5) | matches `app/(app)/school/*` — 20 functions |
| `fitness` | `workout_plans`, `workouts`, `workout_sessions`, `workout_schedule`, `workout_exercises`, `plan_sessions`, `plan_session_exercises`, `plan_micro_exercises`, `exercises`, `session_sets`, `body_metrics`, `fitness_benchmarks`, `fitness_cycle_anchor`, `active_workout_plans`, `rep_goals` (**15** — the single largest domain) | matches `app/(app)/fitness/{actions,workouts/*}.ts` — 23 functions |
| `self_mastery` | `books`, `book_sections`, `sources`, `source_chunks`, `lessons`, `cards`, `card_states`, `reviews`, `questions`, `self_explanations`, `lesson_promotions`, `lesson_verdicts`, `ingestion_jobs`, `ingestion_job_stage_attempts` (**14** — second largest) | matches `app/(app)/personal/*` — 15 functions; **read entity is `book_sections.summary`, once L9 adds it, never `source_chunks.text`/`.embedding`** — see the correction below |
| `distractions` | `distraction_triggers`, `distraction_events`, `trigger_action_plans`, `trigger_plan_outcomes` (4) | matches `app/(app)/distractions/actions.ts`, `lib/capture/actions.ts` |
| `checkins` | `checkins`, `checkin_allocations` (2) | matches `app/(app)/checkin/*` — 8 functions |
| `calendar` / `review` | `schedule_events` (shared with school, above) | matches `app/(app)/calendar/actions.ts`, `app/(app)/review/actions.ts`, `app/(app)/close/*` |
| `settings` | `profiles`, `user_settings`, `user_stats`, `user_domains`, `user_subdomains`, `custom_habits`, `habit_logs`, `notification_log`, `notification_reads`, `push_subscriptions`, `user_api_keys` (11) | matches `app/(app)/settings/*` — 12 functions; the new theme-preset and feature-visibility asks (§6) fold in here as more entities, not new tools; **`user_api_keys` is field-restricted per §3**, never a bare table exposure |
| `scheduler` | new — `mcp_scheduled_actions` | owned by `scheduler_manage` only |
| `widgets` | new — gated, §6 | |
| — excluded, no domain, not in `list_capabilities` at all — | `migration_ledger`, `migration_115_orphaned_group_weight_log` (RLS deny-all, inherited), `pending_storage_deletions` (RLS may permit it; excluded by this design's own allowlist regardless, per §3) | |

Fitness (15 tables) and self-mastery (14 tables) are deliberately the two domains carried in
detail here rather than abbreviated: they are where a flat, one-tool-per-table design would be
worst (29 of the 68 tables between just these two) and consequently where the generic
`domain`/`entity`/`action` matrix pays for itself the most — the top-level schema cost for
`fitness`/`self_mastery` is identical to `checkins`' two tables, which is exactly the point.

**Correction to this memo's original self-mastery description, per the Lead's production pull:**
the first pass of this memo assumed a book pipeline that still needed building. It doesn't —
`source_chunks` holds **286 real rows** with `text`, `page_start/end`, `token_count`, and
`embedding`; PDF→chunks-with-embeddings already runs in production. What's genuinely missing is
narrower: `book_sections` (the chapter/section structure table) has **0 rows and no summary
column at all**. So R6 ("a summary of each section/chapter... sent over MCP, never the whole
book") is a smaller, well-defined addition — populate section structure, add a summary column
plus provenance, batch chunks→summaries through DeepSeek — not a pipeline built from scratch.
This changes what `self_mastery`'s `read` entity targets: **`book_sections` (once L9 adds the
summary column) is the exposed entity; `source_chunks` is registered with an empty column
allowlist per §3**, the same mechanism that keeps `encrypted_key` out of the `settings` domain —
the owner was explicit that the source text itself stays off MCP, and the visibility registry is
where that's enforced, not left to a `detail` parameter the model could otherwise turn up to
`"full"`.

`entity` and `action` values are **not** enumerated in any top-level schema — they're strings,
validated server-side against the real dispatch table, discoverable via
`list_capabilities(domain)`. A representative sample, to show the mapping is real rather than
asserted (drawn directly from the actual exported functions, e.g. `app/(app)/work/tasks-actions.ts`
and `app/(app)/deen/actions.ts`):

- `write(domain:"work", entity:"task", action:"advance", id)` → dispatches to the existing
  `advanceTask(id, currentStatus)` — same for `"retreat"→retreatTask`, `"block"→blockTask`,
  `"unblock"→unblockTask`. Four narrow verbs the app already has, collapsed into one `action`
  enum on one entity, not four tools.
- `write(domain:"deen", entity:"prayer", action:"log"|"unlog", patch:{prayer, date})` →
  `markPrayer`/`unmarkPrayer`.
- `write(domain:"business", entity:"kill_list_item", action:"set"|"toggle", ...)` →
  `setKillListItem`/`toggleKillListItem` — this is also where "optional custom ordering" for
  kill-list/weekly-goal items lives: an `order_index` field on `patch`, nothing new needed.
- `write(domain:"school", entity:"assignment"|"class_event", action:"create"|"update"|"remove")`
  → the `addTask`/`updateTask`/`removeTask` and `addClassEvent`/`updateClassEvent`/
  `removeClassEvent` families.

This is the concrete tradeoff being made, stated honestly: **the top-level schema is generic
(cheap, uniform, doesn't grow as the app grows), at the cost of pushing real validation and the
"what does entity X's patch shape look like" question into `list_capabilities`'s response and
into server-side runtime validation, rather than the client being able to see a fully-typed
per-operation schema before it ever calls anything.** A model can, in principle, guess wrong on
an `action` or `entity` string; the mitigation is (a) `list_capabilities` being cheap and
expected to be called whenever the model is unsure, and (b) every `write` call already goes
through the audit-before-return log PROGRAM-PLAN committed to, so a wrong guess is caught,
logged, and rejected with a clear error rather than silently doing nothing or doing the wrong
thing — errors from an invalid `(domain, entity, action)` triple should read like "unknown action
'x' for entity 'y'; call list_capabilities('domain') for the valid set," turning a wrong guess
into a one-hop self-correction rather than a dead end.

---

## Rejected alternatives, named explicitly

- **One MCP tool per `core()` function (~150-160 tools).** The literal reading of the handoff
  spec's tool catalog. Rejected on token cost alone (§2) — every source consulted independently
  flags "20+ tools" or "one tool per endpoint" as the primary anti-pattern, and our own count is
  ~8-10x past that line.
- **~60 hand-grouped tools (one per entity, e.g. `deen.log_prayer`, `school.add_assignment`).**
  The "naive reading" the owner himself flagged. Better than 150, still costs an estimated
  9,000-15,000+ tokens by the per-tool averages in §2 (60 tools × 150-250 tok/tool), still grows
  every time a new entity is added, and still doesn't solve "the agent shouldn't need to pull
  information it doesn't need" — 60 fully-specified schemas are still all present on every turn.
- **MCP Resources as the primary read channel.** Rejected in §1 — not viable given ChatGPT's
  confirmed non-support and Claude's host/user-driven (not model-driven) interaction model.
- **Relying on protocol-level or host-level progressive tool disclosure**
  (`tools/list_summary`/`tools/get`, or assuming Claude Code-style lazy tool-search applies to
  the consumer connector surfaces). Rejected in §2 — neither is confirmed to exist/apply where
  we need it; the design must not depend on either.
- **Push-based cache invalidation via resource subscriptions.** Rejected in §4 — unverified
  client support, and Resources are already rejected as the primary channel.
- **Literal agent-authored source code, deployed to production, for custom widgets.** Rejected
  in §6, with the alternative recommended there.

---

## 6. Flagged, not resolved — two items that are not "tool architecture" questions

Two items from the owner's expanded scope need an explicit decision before they're built, and
are named here rather than silently resolved one way or the other.

**Custom widgets — "the user's AI agent writes custom code... makes it work... with a deploy
tool" is a different threat model from a parameterized query, and this memo does not resolve
it.** What's proposed above (`widget_manage`, domain `widgets`) is deliberately **not** literal
code generation: a fixed, human-built set of widget *kinds* (e.g. metric card, list, small chart,
progress ring, calendar strip), each taking a declarative config — a data-source reference into
the existing `read` dispatch, plus display options — stored per-user and rendered by the
existing, already-reviewed component tree. This satisfies "the agent writes the widget and places
it, scoped to their account, without changing the app's existing architecture" in spirit: the
account owner effectively gets a new metric card without an engineer, and the *architecture*
genuinely doesn't change, because a config row for the existing renderer is the only thing added.
**What it explicitly rejects** is a code-execution or dynamic-bundle-deploy path (the AI emitting
literal JS/TSX that then runs against the account's RLS-scoped data), because that is a new
execution surface with a fundamentally different threat model than everything else in this
design — PROGRAM-PLAN already accepted "write, no confirmation" as a real, owner-made risk for
parameterized data mutation; stacking arbitrary code execution on top of that is not the same
risk multiplied, it's a different risk category, and this memo is not the place to wave it
through. **This needs the owner's explicit sign-off, the same way PROGRAM-PLAN already flags the
schema migration itself as needing it** — recommend surfacing this as its own open item to the
Lead before `widget_manage` moves past the config-DSL version proposed here.

**"Add features they don't have yet" is ambiguous, and this memo assumes the narrower reading.**
Read literally, this could mean (a) toggling on an already-built-but-currently-hidden feature for
this account (config-driven, fits neatly into `write(domain:"settings", entity:"feature_flags",
...)`, no new architecture), or (b) the model generating genuinely new application functionality
on demand, which is not a tool-call-shaped problem at all — it's arbitrary software engineering,
and no MCP tool design makes that safe or well-defined. This memo assumes (a) throughout §5's
`settings` domain. Flagging (b) explicitly rather than silently picking an interpretation, per
this program's own stated discipline for open items.

---

## Sources consulted (2026-09-08/09)

- Production data inventory (68 tables, RLS status, row counts, the book-pipeline correction):
  `docs/ai-connector/DATA-INVENTORY.md` (Lead, commit dbbcc26)
- ChatGPT Resources unsupported: https://community.openai.com/t/does-chatgpt-apps-support-reading-standard-mcp-resources/1384027
- Claude connector supported/unsupported feature list: https://claude.com/docs/connectors/building
- MCP resource interaction model ("application-driven", Claude Desktop explicit-selection note): https://modelcontextprotocol.info/docs/concepts/resources
- Resource subscriptions largely unsupported by clients: https://github.com/orgs/modelcontextprotocol/discussions/301
- MCP subscriptions/listen spec (2026-07-28): https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions
- Tool-list token cost, GitHub 94 tools/17.6k tokens, compression tiers: https://archestra.ai/blog/mcp-context-window-blowup , https://www.atlassian.com/blog/development/mcp-compression-preventing-tool-bloat-in-ai-agents
- Per-server token measurements, "seven servers, 67k tokens": https://bump.sh/blog/4-rules-to-build-an-efficient-mcp-server
- Per-tool token overhead measurement (~1000 tok/heavy tool): https://github.com/modelcontextprotocol/modelcontextprotocol/issues/2808
- Progressive tool discovery proposal (unmerged): https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/1923
- Claude Code lazy tool-search (host-side, CLI-specific): referenced within bump.sh piece above
- Six-Tool Pattern / fewer-parameterized-tools guidance: https://www.mcpbundles.com/blog/mcp-tool-design-pattern
- "Don't map 1:1 APIs to tools," 5-8 tools/server guidance: https://docs.workato.com/en/mcp/mcp-server-design , https://docs.workato.com/mcp/mcp-server-tool-design.html
- Toolset namespacing / GitHub's dynamic ListAvailableToolsets pattern: https://mcpcat.io/blog/mcp-server-best-practices
- Pagination/response-shape conventions: https://github.com/apexnova-dev/opencode/blob/main/opencode/skills/mcp-builder/reference/mcp_best_practices.md
- OpenAI deep-research search/fetch tool-shape requirement: https://www.mcpbundles.com/blog/mcp-tool-design-pattern
