-- 141: `mcp_widgets` — the Tier-1 custom widget layer (R7).
--
-- The owner asked for his AI agent to "create custom widgets... place it in
-- its correct spot and make it work," scoped to his account, without changing
-- the app's architecture. Taken literally that is arbitrary code execution plus
-- production deployment driven by a model, stacked on the already-accepted
-- prompt-injection exposure. R7's ruling: deliver the capability, change the
-- mechanism.
--
-- **A widget is a ROW, not a file.** `kind` + a `data_source` reference into the
-- existing MCP read registry + display options, rendered by one audited
-- component. Three consequences, all structural rather than policy:
--
--   * "cannot change the app's architecture" is true by construction -- there is
--     no code path from a row to new behaviour.
--   * widget reads inherit the read registry's column allowlists, `fixedFilter`s
--     and `parentFilter`s, so a widget can NEVER become a back door to
--     `source_chunks.text` (raw book text) or `user_api_keys.encrypted_key`.
--     Proven by test at both the validator and the tool level.
--   * per-account isolation is RLS, not application logic.
--
-- `kind` is a discriminant so a future sandboxed-code tier is an ADDITION, not a
-- rewrite. Tier 2 and Tier 3 are NOT authorised and are not built.
--
-- `status` exists because of the no-hard-delete rule: MCP's "delete" archives.
-- The asymmetry with the in-app remove button (which really deletes) is
-- deliberate and matches R9 -- a person removing their own widget acts with
-- intent; an MCP call may originate from a model acting on injected content.
-- The rule is about the ACTOR, not the operation.
--
-- Carries `touch_updated_at()` from the start, per tonight's four separate
-- migrations (133/135/136/137/138) that existed only because that was skipped.

create table public.mcp_widgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Narrow on purpose: only the 2 kinds this pass actually builds a
  -- renderer for. R7 names metric card/list/small chart/progress ring/
  -- calendar strip as the EVENTUAL set; widening this CHECK later for a
  -- 3rd kind is an ordinary additive ALTER (same "a CHECK, not an enum"
  -- reasoning as migration 120's dump_source) -- deliberately not
  -- pre-admitting a kind with no renderer behind it yet.
  kind text not null check (kind in ('metric_card', 'list')),
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
  -- list -> { titleField: string, subtitleField?: string, limit?: number }
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
