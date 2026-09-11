# `mcp_widgets` — new table needed for L11 (Tier 1 declarative widgets)

**STATUS: APPLIED.** This proposal shipped as `supabase/migrations/141_mcp_widgets.sql`
(confirmed present in `lib/supabase/database.types.ts`). Kept below as the historical
design rationale for the table shape, not as an open request — a request document
that quietly outlives its own request is exactly the kind of stale artifact this
program has spent effort removing elsewhere; this banner exists so it doesn't
happen here too.

**RESOLVED 2026-09-11 by migration `149`.** The divergence noted below (found
2026-09-10) — the applied migration's `kind` CHECK still `in ('metric_card', 'list')`
while `WIDGET_KINDS` had grown to five — is fixed: `149_mcp_widgets_kind_widen.sql`
widened `mcp_widgets_kind_check` to admit all five, verified in two ways neither of
which is a mocked unit test: (1) the migration's own `do $$...$$` block re-reads
`pg_get_constraintdef` from the live catalog and asserts all five are present; (2)
`scripts/verify-mcp-widgets-kind-check.ts` called the real `widgetManageTool` create
path with a real service-role client against production and got `accepted` for all
five kinds, then cleaned up with a real DELETE and re-checked zero rows remained.
Left below as the record of what actually happened, not to re-litigate it.

~~**One divergence from the DDL below, found verifying this banner (2026-09-10):**
the applied migration's `kind` CHECK is still `in ('metric_card', 'list')` — the
two kinds this doc originally scoped to. `lib/widgets/validate.ts`'s `WIDGET_KINDS`
has since grown to five (`progress_against_goal`, `sparkline`, `streak` added), and
`render.ts`/`actions-core.ts` both have real code for at least the first two of
those three — but nothing has widened this CHECK to match. Creating a widget with
any of those three kinds passes every application-level check and then fails at
the database `INSERT` with a constraint violation. Reported, not fixed here.~~

**Not a numbered migration** *(historical note, describing the state at the time
this was written — it since became migration 141, above)*. Per the standing
instruction, this was a request + a reviewable SQL sketch, not a file in
`supabase/migrations/`.

## What this is, per R7/TOOL-ARCHITECTURE.md §6

A widget is a **row, not a file** — `kind` (a fixed, human-built renderer
kind), a `data_source` reference into the existing `read` dispatch
(`lib/mcp/registry.ts`), a slot/placement, and display options. Rendered by
one audited server-side renderer (`lib/widgets/render.ts` +
`components/home/mcp-widgets-panel.tsx`), never agent-authored code. No
deploy, reversible (an MCP-originated "delete" archives the row per the
no-hard-delete rule below; the in-app remove button really deletes it),
scoped by RLS like everything else.

Named `mcp_widgets`, not `widgets` — the app already has an unrelated
`widgets: string[]` column on `user_subdomains` (Work-subdomain feature
selection from a fixed catalogue, T-0002/D-010, still unbuilt) and I don't
want a second concept named "widget" colliding in greps, migrations, or
anyone's mental model. `mcp_` also matches this program's other new tables
(`mcp_access_tokens`, `mcp_audit_log`).

## Proposed DDL (reuses migration 074's `touch_updated_at()`, built with the trigger from day one — not retrofitted later, per the lesson of every prior domain's `updated_at` pass)

```sql
create table public.mcp_widgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Narrow on purpose: only the kinds this pass actually builds a renderer
  -- for. R11 (PROGRAM-PLAN.md) extends the declarative vocabulary instead
  -- of building Tiers 2/3 -- more kinds land incrementally, one at a time,
  -- each with its own validation+render+test+Home-wiring pass, never
  -- pre-admitted ahead of a real renderer. progress_against_goal is the
  -- first (R11's own suggested starting point: goal data already exists).
  -- Widening this CHECK for the next kind is an ordinary additive ALTER
  -- (same "a CHECK, not an enum" reasoning as migration 120's dump_source).
  kind text not null check (kind in ('metric_card', 'list', 'progress_against_goal', 'sparkline', 'streak')),
  title text not null,
  -- { domain: string, entity: string, filter?: Record<string, string|number|boolean> }
  -- Validated at write time (lib/widgets/validate.ts) against the SAME
  -- registry.ts allowlists read()/write() already enforce -- domain/entity
  -- must resolve, filter keys must be in filterableColumns, and a
  -- parentFilter-bearing entity's required filter column must be present.
  -- Rendering (lib/widgets/render.ts) calls the real readTool() function,
  -- not a second hand-rolled query -- so fixedFilter/parentFilter/
  -- fullColumns are enforced identically to an MCP read call, by
  -- construction, not by the widget layer re-deriving the same rules.
  data_source jsonb not null,
  -- kind-specific: metric_card -> { aggregate: "count" } | { aggregate: "field", field: string };
  -- list -> { titleField: string, subtitleField?: string, limit?: number };
  -- progress_against_goal -> { aggregate: { type: "count" } | { type: "sum", field: string }, goal: number }
  -- (goal is a static number set on the widget itself, not pulled from a
  -- second entity -- that's the natural next increment once multi-source
  -- widgets land, not this one);
  -- sparkline -> { dateField: string, valueField?: string, days?: number (7-60, default 14) }
  -- (R12: dateField MUST be the data source entity's own primary sort
  -- column, descending -- validated against orderBy, not just fullColumns
  -- -- see lib/widgets/validate.ts's own comment on why. Rendered via a
  -- RAISED row limit, lib/widgets/render.ts's WIDGET_RENDER_MAX_ROWS=100,
  -- never reachable through this column or any other widget-authored
  -- input -- R12/PROGRAM-PLAN.md);
  -- streak -> { dateField: string }
  -- (same orderBy guard as sparkline's dateField, reusing the same shared
  -- validator -- a streak counts consecutive LOCAL CALENDAR DAYS with a
  -- hit, not rows; "what counts as a hit" is narrowed via data_source's
  -- own `filter`, so no separate predicate concept was needed. Also
  -- rendered via the raised WIDGET_RENDER_MAX_ROWS fetch, same reasoning
  -- as sparkline -- a streak needs to look back further than 20 rows to
  -- find where it actually breaks.)
  display jsonb not null default '{}'::jsonb,
  -- Only "home" is renderable this pass -- the Home page's own Panel stack
  -- (app/(app)/page.tsx, rendered by components/home/mcp-widgets-panel.tsx)
  -- is the one place with an established, already-reviewed vertical-stack
  -- pattern and room to grow: the topbar icon row and mobile-island
  -- primary-item row are BOTH documented at capacity, calculated to a
  -- 320px floor, and have broken live before when they grew
  -- (components/shell/topbar.tsx, components/shell/mobile-island.tsx --
  -- widgets do not go there, and never will without a real redesign of
  -- one of those two). Additive CHECK widening later if a second slot is
  -- ever built.
  slot text not null default 'home' check (slot in ('home')),
  position int not null default 0,
  -- MCP-originated "delete" (widget_manage's `delete` action) flips this to
  -- 'archived' rather than removing the row -- the standing no-hard-delete
  -- rule (PROGRAM-PLAN R9's `'unlogged'` precedent), because an MCP call
  -- may originate from a model acting on injected content, not the account
  -- owner's own hand. The cookie-authed removeWidget Server Action (a
  -- person clicking remove on their own dashboard) keeps a real DELETE --
  -- same actor-based asymmetry R9 already draws for unmarkPrayer. Archived
  -- widgets are excluded from both `read()`/`widget_manage("list")`'s
  -- default result and from rendering, same as an absent row.
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index mcp_widgets_user_id_idx on public.mcp_widgets (user_id);
create index mcp_widgets_user_slot_idx on public.mcp_widgets (user_id, slot, position);
create index mcp_widgets_user_status_idx on public.mcp_widgets (user_id, status);

alter table public.mcp_widgets enable row level security;

create policy "mcp_widgets_own_row"
  on public.mcp_widgets for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create trigger mcp_widgets_touch_updated_at
  before update on public.mcp_widgets
  for each row execute function public.touch_updated_at();
```

No backfill — this is a new table, genuinely zero rows anywhere.
