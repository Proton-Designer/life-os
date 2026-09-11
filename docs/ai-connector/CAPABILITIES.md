# What the AI connector can actually do — verified against the live registry, 2026-09-10

This is the answer to "what can the AI actually do with my account." Every claim below was
checked directly against `lib/mcp/registry.ts`, `lib/mcp/write-registry.ts`,
`lib/scheduling/scheduler-core.ts`, and `lib/widgets/*` at the time this was written — not
against an earlier version of this document, not against a commit message, not against any
other doc in this folder. Where a doc elsewhere in `docs/ai-connector/` says something
different, **the code is what's true**; see the "known gaps" section at the bottom for the
specific places that's currently the case.

**How to keep this page honest as the registry grows:** re-derive the counts, don't copy them
forward. A count in this file is a snapshot, not a promise — treat any specific number here as
current as of 2026-09-10 and re-verify before repeating it in a future conversation.

## How a connection works

Claude, ChatGPT, and Gemini connect the same way: paste the connector URL, click through an
OAuth consent screen naming the app and asking "is this the app you meant to connect?" — there
is no separate login step, since the account is already signed in to Life OS. A personal access
token exists too, for bearer-header clients that don't do an OAuth click-through (Claude Code,
scripts). Either way, **every call is scoped to this one account** — there is no path by which a
connection reaches anyone else's data, and no path by which it reaches more of this account's
own data than the rules below describe.

Five tools exist, all generic: `list_capabilities` (discovery), `read`, `write`,
`scheduler_manage`, `widget_manage`. There is no per-table tool — the model asks
`list_capabilities` what exists, then calls `read`/`write` with a `domain`/`entity`/`action`
triple. This is a property of the design, not a count to re-verify each time: whatever entities
the registry gains, they arrive through these same five tools, never a sixth.

## Read — what the AI can see

Every read is a live, filtered query, not a data dump: the registry defines exactly which
columns each entity exposes (an allowlist, not a blocklist — a field the registry doesn't name
cannot be requested, full stop), and every read is capped at 20 rows per call, paginated via a
cursor. Credential-shaped columns (API key material, PIN hashes) are excluded from the
allowlist entirely, at the same layer as every other field — there's no separate secrecy
mechanism to trust, and no separate mechanism to audit.

As of this writing, verified directly against `REGISTRY`: **13 domains, 57 entities.**

| Domain | Entities | Covers |
|---|---|---|
| `deen` | 8 | Prayers, sunnah log, adhkar, Quran sessions, reflections, habits |
| `work` | 3 | Co-op targets, pipeline tasks, work sessions |
| `business` | 2 | Daily Kill List, weekly goals |
| `school` | 6 | Classes, assessments, schedule events + overrides/cancellations, tasks |
| `fitness` | 15 | Plans, workouts, sessions, body metrics, benchmarks, exercises, schedule |
| `self_mastery` | 12 | Books, lessons, cards, spaced-repetition reviews, self-explanations, lesson promotions/verdicts |
| `settings` | 3 | Profile, per-user settings, API key metadata (never key material) |
| `checkins` | 2 | Check-in prompts/answers, per-window domain-minute allocations |
| `distractions` | 4 | Triggers, events, action plans, plan outcomes |
| `review` | 1 | Night Plan items (the evening-close ceremony's dumped/ranked list) |
| `calendar` | 0 | Aggregation only — reads through the domains above, no table of its own |
| `home` | 0 | Aggregation only — same as `calendar` |
| `widgets` | 1 | The account's own Home widget configs (see Widgets, below) |

## Write — what the AI can change

Every write is one action against one entity — never a hard delete (a "remove" always means an
archived/soft-deleted state a person can still recover from their own UI, never gone), never
un-scoped (every write is checked against this account's own rows only), and every write is
logged to an audit trail regardless of outcome.

As of this writing, verified directly against `WRITE_REGISTRY`: **9 domains, 50 registered write
actions**, covering deen, work, business, school, fitness, checkins, distractions, settings, and
self_mastery. (`calendar`, `home`, `review`, and `widgets`-as-a-domain have no write surface of
their own — `review`'s Night Plan items are written through `work`/`distractions`' own actions,
and widgets are written through the separate `widget_manage` tool, not `write`.)

self_mastery's write surface is new this pass: grading a spaced-repetition review, recording a
lesson-promotion verdict (adopted/abandoned/still_testing), and logging a self-explanation
reflection. All three are real, live write actions today.

## Scheduling — what the AI can set up to run unattended

Scheduled actions are real: a `write` or a `notify` call can be set to fire once at a given time
or on a recurring cron expression, polled and executed automatically, with the exact same audit
trail and scope enforcement as a live call — scheduling is not a separate, less-checked path.

**Not everything that can be called can be scheduled, and that's deliberate, not a limitation to
route around.** A scheduled action can fire more than once for the same intended occurrence (a
retry after a crash, a missed poll caught on the next one) — "at-least-once," not "exactly-once."
The property that matters: **the scheduler will only accept a write action whose registry entry
explicitly says it tolerates being run twice** — refusal is the default, verification is what
unlocks scheduling, and that check is re-read from the live registry on every schedule attempt,
never cached from an earlier pass. As of this writing: **32 of the 50 write actions are
schedulable; 18 are not**, because running them twice would do something a person didn't ask
for the second time — drift a timestamp forward, double-count an entry, or otherwise leave a
different result than intended. Grading a review, logging a self-explanation, and recording a
lesson-promotion verdict are all in the 18 — a repeat grade doesn't mean "the same grade again,"
it's a second real grading event, so none of self_mastery's writes are schedulable yet. Toggles
(sunnah/adhkar/task-completion in a couple of domains) and plain appends (adding a task, logging
a distraction event) are the other recurring shape in the 18 — see "known gaps" for what would
change that, since a couple of them are a genuine small fix away rather than a redesign.

Reminders/notifications are a real delivery mechanism, not just a scheduled write that fires
into the void — a scheduled `notify` action reaches the account's registered push subscription,
using the same idempotency discipline as everything above (a retry does not send the same
reminder twice).

## Widgets — what the AI can add to Home

A widget is a config row, not code the AI writes and deploys — it names a `kind` (a fixed,
human-built renderer), a data source (a domain/entity/filter this same registry already
allows), and display options, rendered by one audited component on the Home page. This is a
deliberate, considered choice, not the safe half of an unfinished plan: building the AI-authored
code-execution version this could have become was evaluated and explicitly ruled out, because
Tier-1's core safety property — a widget can never see anything a live `read()` call couldn't —
is provable exactly because nothing about a widget executes; extending what a config row can
express was judged the better way to grow this capability than opening a code-execution surface.

**Widget kinds, and their real current status — verified directly against the applied schema,
not just the application code:**

| Kind | Status |
|---|---|
| `metric_card` | Live — a count or a single field value |
| `list` | Live — a short list of titled rows |
| `progress_against_goal` | **Built in the app (validated, rendered), but the database's own constraint on this table has not been widened to allow it yet — creating one fails at the database, not gracefully.** |
| `sparkline` | Same gap as `progress_against_goal` — built, not yet creatable |
| `streak` | Same database gap, **and** has no rendering logic built yet either — further from usable than the other two |

Only `home` is a renderable placement today. Widget actions (create/update/archive) are **not**
schedulable at all, regardless of how the table above changes — `widget_manage` is a separate
tool from `write`, and the scheduler only ever looks at `write`/`notify` actions.

## What is explicitly not available

- **No hard deletes**, anywhere, ever, on any write path this connector exposes. Removal always
  means an archived/reversible state.
- **No arbitrary code execution or deployment** — the widget capability is deliberately
  config-only; see Widgets above.
- **No raw database access, no table named directly** — every read/write goes through the
  domain/entity vocabulary the registry defines.
- Two tools sometimes mentioned in earlier design notes, `search` and `fetch`, were never built.
  Only the five tools named above exist.

## Known gaps, stated plainly rather than left to be rediscovered

- **Three widget kinds are built but not creatable** (the table above) — the database
  constraint governing this table was never widened to match the application code. This is a
  genuine, verified inconsistency between what the code supports and what the schema allows,
  found while writing this document, reported rather than fixed here (touches a migration and a
  file another engineer has in flight — not this document's place to resolve).
- **18 of 50 write actions cannot be scheduled today.** Most of those need a real redesign
  (toggles inherently invert, not set; plain appends have no natural retry key) — but a couple
  are a small, identified fix away (a "has this already happened" guard on the specific column
  that drifts), flagged for whoever picks that up next rather than built speculatively.
- **This document itself will go stale the moment any of the counts above change.** Re-derive,
  don't copy forward — see the note at the top.
