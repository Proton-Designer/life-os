# Widget layer security audit — can a widget read what `read()` would refuse?

**Question asked (team-lead, before Tiers 2/3 of R7/L11 are ever considered):**
is there any path by which a widget definition can cause data to be read that
the MCP `read()` tool would refuse? This is the argument the lead would have
to stand behind if the owner ever asks whether a widget can see something the
connector wouldn't otherwise hand over.

**Answer: no hole found.** Verified by reading the code (not by running it,
not by trusting the comments), independently re-checked by the lead
(including a positive-control pass on the registry scan below), as of the
commit this file lands in. The structural reason this holds, and the one
invariant that must keep holding, are both stated explicitly at the end —
read that section even if you skip the rest.

## The three questions, each answered with file:line evidence

### 1. Can `data_source` name a domain/entity/column outside the allowlists, or reach `source_chunks` content?

No, checked twice, independently, at two different times:

- **Write time** — `validateDataSource` (`lib/widgets/validate.ts:54-92`)
  resolves `domain`/`entity` via `getDomain`/`getEntity`
  (`lib/mcp/registry.ts`) — the exact same functions `read()` itself calls
  to resolve a call. An unknown domain/entity throws before anything is
  stored. `validateDisplay` (`validate.ts:95-131`) requires
  `display.field`/`titleField`/`subtitleField` to be a member of the
  entity's own `fullColumns` — never optional, checked for every kind.
  Proven directly in `lib/widgets/__tests__/validate.test.ts:45-52` against
  `self_mastery.source_chunks` itself (`field: "text"` and
  `titleField: "embedding"` both throw `"not a column on this widget's
  data source"`), and in the same file (lines 56-64) against
  `settings.api_key.encrypted_key` and `settings.profile.pin_hash`.
- **Render time, independently** — `lib/widgets/render.ts:55-60` calls the
  real `readTool()`, which calls `resolveEntity` (`lib/mcp/tools/read.ts:32-46`).
  An unknown domain/entity throws there too — caught by `render.ts`'s own
  per-widget `try/catch` (`render.ts:53,86-88`) as that one widget's error
  state, never a page crash and never a silent pass-through.
- **`source_chunks` specifically** — `lib/mcp/registry.ts:1101-1113`:
  `summaryColumns: []`, `fullColumns: []`, `filterableColumns: []`. A
  `"list"` widget or a `"field"`-aggregate `metric_card` can never name any
  column against it, because `fullColumns.includes(anything)` is always
  false when `fullColumns` is `[]`.

**Nuance, accepted as a deliberate decision, not a hole — see its own
section below:** `aggregate: "count"` has no field check at all
(`validate.ts:100`) and so IS creatable against `source_chunks`.

### 2. Does validation happen at write time, render time, or both? Is there a stale-capability hole?

**Both — and render time is the one that actually matters**, because it is
re-derived from the live registry on every call, never cached from
creation time:

- `resolveColumns`/`selectClause` (`lib/mcp/tools/read.ts:49-68`) compute
  the SQL `select` list from the CURRENT `fullColumns` on every render. A
  widget's stored `display.field` is just a property-name lookup into
  whatever `readTool` actually returned (`render.ts:74,82-83`). If a column
  is later removed from `fullColumns`, the returned row simply no longer
  has that key — the lookup yields `undefined`, rendered as `"—"`, never
  stale or forbidden data.
- `filterableColumns` is re-checked inside `readTool` itself on every call
  (`read.ts:220-227`), not only at widget-creation time.
- Domain/entity existence, `fixedFilter`, and `parentFilter` are all
  re-derived from the live registry inside `readTool` on every render
  (`read.ts:167`, `180`, `191-197`, `210-216`).
- `truncateColumns` (the lead's ruling on `self_mastery.lesson.provenance_quote`,
  capped at 240 chars, `registry.ts:820`) is enforced inside `toItem`
  (`read.ts:79-92`) — the single function both the id-path and list-path
  funnel every returned row through. It therefore applies identically
  whether the caller is the real MCP `read` tool or a widget. Proven
  directly against `readTool` in
  `lib/mcp/tools/__tests__/read-self-mastery.test.ts:180-191`.

**Conclusion: no stale-capability hole.** A widget created under looser
rules, rendered after the registry tightens, either keeps working (if still
valid) or surfaces its own per-widget render error — it cannot silently keep
returning data under retired rules, because there is no "rules as of
creation time" state stored anywhere for it to fall back on. The only
things written at creation time are `domain`, `entity`, `filter`, and a
`display` shape already validated against `fullColumns` as they stood at
that moment — none of that is re-used as a trust decision later; the trust
decision is remade, from scratch, by `readTool` every time.

### 3. Does render.ts pass the filter through unmodified? Can a crafted filter widen scope?

Passed through unmodified (`render.ts:58`: `filter: row.data_source.filter`),
and it cannot widen scope:

- Every filter key is checked against `filterableColumns` at both write
  time (`validate.ts:72-75`) and render time (`read.ts:220-227`) — a column
  a widget isn't allowed to filter on cannot be named at all, at either
  stage.
- **No entity's `fixedFilter` column is also in that entity's own
  `filterableColumns`.** Checked two independent ways:
  - Eng1's own one-off script over `REGISTRY`, scanning every entity's
    `fixedFilter` keys against its own `filterableColumns`: zero overlaps.
  - The lead's independent re-scan, written separately rather than reusing
    Eng1's script, **with a positive control in front of it**: assertions
    that the scan actually sees more than 40 entities, at least one
    `fixedFilter`, and at least one non-empty `filterableColumns` — so a
    "zero overlaps" result couldn't come from a scan that was structurally
    incapable of finding one. Positive control passed, then: zero overlaps,
    `source_chunks` confirmed empty on both `fullColumns` and
    `summaryColumns`, and no column matching
    `encrypted_key|pin_hash|password|secret|_token|refresh_token` anywhere
    in the registry.
  - Because `fixedFilter` is applied unconditionally, before the caller's
    own filter loop runs (`read.ts:218-219` vs. `220-227`), even the
    adversarial case — a crafted filter somehow naming a fixed column —
    could only ever produce a conflicting `.eq()` on the same column,
    which yields zero rows, never a widened result.
- `parentFilter` entities independently re-verify the named parent's
  ownership and `parentFixedFilter` at render time
  (`read.ts:153-163`, `verifyParent`), using the row's/filter's OWN column
  value, never a cached claim — a crafted `filter.event_id` pointed at a
  `co_op` event fails "no parent row found," never returns `co_op` data.
- The STORED `data_source` shape (`validate.ts:35-39`) has no `detail` or
  `fields` key at all — `validateDataSource` only ever persists
  `{domain, entity, filter}` (`validate.ts:91`), and `render.ts` hardcodes
  `detail: "full"` and never passes `fields`. There is no path for a widget
  to request anything wider than `fullColumns`, regardless of what a
  caller tries to smuggle into `patch.data_source` at creation time.

## The structural argument — stronger than any list of checked cases, and the one invariant to keep true

A list of checked entities/columns can always be incomplete. The reason this
audit's conclusion doesn't rest on completeness is a single property, true
by construction right now:

> **Nothing about what was allowed at widget-creation time is ever cached
> or trusted again. Every render re-derives the full set of permissions —
> which domain/entity exist, which columns are selectable, which filters
> are allowed, which fixed/parent scoping applies, and any truncation rule
> — from the live registry, by calling the exact same `readTool()` function
> the real MCP `read` tool calls.**

That property holds IF AND ONLY IF `readTool` has exactly the callers it has
today. Checked by grep at audit time:

```
readTool( called from:
  app/api/mcp/route.ts        <- the real MCP "read" tool
  lib/widgets/render.ts       <- widget rendering
```

**This two-caller invariant is the thing that must stay true.** The moment a
third caller appears — a new surface that reads widget (or any other)
data by querying tables directly instead of going through `readTool` — this
audit's conclusion no longer covers it, and the new surface needs its own
version of this same argument, not an assumption that it inherits this one.
The same check applies one level up: `createWidgetCore`/`updateWidgetCore`
(the only functions that can persist a widget's `data_source`/`display`)
have exactly one caller each today — `lib/mcp/tools/widget-manage.ts`'s
`create`/`update` actions, both of which call `validateDataSource`/
`validateDisplay` before ever calling the core function. If a second write
path to those columns is ever added (e.g. a future Settings UI for editing
widgets by hand), it must also validate before writing, or this audit's
"write time" half goes stale even though "render time" still holds.

## The `aggregate: "count"` vs. `source_chunks` nuance — a decision, not an oversight

**Accepted, with the reasoning recorded here rather than left in a message,
because a clean "no overlaps found" reads as a hole to someone encountering
it cold without the context.**

A `metric_card` widget with `display: { aggregate: "count" }` CAN be created
against `data_source: { domain: "self_mastery", entity: "source_chunks" }`,
because `aggregate: "count"` is the one `display` shape `validateDisplay`
never checks against `fullColumns` (there is no field to check — counting
needs no column at all). At render time, `selectClause`
(`read.ts:65-68`) resolves the actual SQL select to just the entity's
`idColumn` — for `source_chunks`, that's `id` alone, since
`updatedAtColumn` is `null` and `fullColumns` is `[]`
(`registry.ts:1101-1113`). The widget can therefore display "this book has
N chunks" — a count, never a row's `text` or `.embedding`.

**Why this is acceptable, not a gap to close:** the registry's own stated
design intent for `source_chunks` is "existence is not secret, content is"
(`registry.ts`, the entity's own header comment). `read(detail:"ids")`
already grants exactly this capability today — enumerate `source_chunks`
ids (and, via pagination, their count) for any caller with `read` scope.
The widget surface does not add a new exposure; it reuses an
already-sanctioned one through a second UI. The information content is
length metadata about ingested material ("this book has N chunks"), never
the chunks' text.

**What would turn this from a non-issue into a real one, so it's written
down rather than left to be rediscovered:** if `source_chunks` ever gains a
non-empty `fullColumns` for some future legitimate reason (e.g. a
`page_count` or `token_count` summary field), the `aggregate: "count"` path
stays exactly as safe as it is today — count-only exposure never touches
`fullColumns` at all. What would need re-auditing at that point is whether
the NEW `fullColumns` entries are themselves safe to expose via
`aggregate: "field"`/`list` widgets, which is a question about that future
change, not about the mechanism audited here.

## Provenance

- Eng1's audit, reported 2026-09-10, verified by reading
  `lib/widgets/validate.ts`, `lib/widgets/render.ts`,
  `lib/widgets/actions-core.ts`, `lib/mcp/tools/widget-manage.ts`,
  `lib/mcp/tools/read.ts`, and `lib/mcp/registry.ts` directly, plus the
  existing test suites (`lib/widgets/__tests__/validate.test.ts`,
  `lib/mcp/tools/__tests__/read-self-mastery.test.ts`) and a one-off script
  confirming zero `fixedFilter`/`filterableColumns` overlaps across the
  whole registry.
- Independently re-verified by the team-lead with a separately-written
  scan (not a re-run of Eng1's script) that included a positive control —
  proving the scan could detect an overlap before trusting it to report
  none — plus a direct check for `encrypted_key|pin_hash|password|secret|
  _token|refresh_token`-shaped columns anywhere in the registry.
- No code was changed as part of this audit. Nothing here requires a fix.
