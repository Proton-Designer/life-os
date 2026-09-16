-- 204: page_layout_widgets (WIDGET-01) -- per-user, per-domain widget
-- layout: which built-in panels a page shows, in what order, and whether
-- each is hidden. lib/page-layout/registry.ts is the declarative source
-- of truth for WHICH widgets exist; this table stores only a user's own
-- override of position/hidden per widget, never the widget's own
-- definition.
--
-- COMPOSITE PRIMARY KEY (user_id, domain_key, widget_key), no synthetic
-- id: the triple IS the identity -- a user has at most one row per widget
-- per domain, and "does a row exist for this widget" is exactly the
-- question every read/write here asks. Same no-synthetic-id idiom this
-- schema already uses for other small per-user state.
--
-- HIDING IS `hidden = true`, NEVER A DELETE, AND NEVER TOUCHES ANY OTHER
-- TABLE. This table has zero relationship to the tables a widget's own
-- content reads from (identity_habits, class_assessments, work_sessions,
-- ...) -- by construction, "hide a widget" can only ever mean "set a flag
-- in THIS row," so the user's own key requirement ("removing a widget
-- hides it and never touches the data it reads") holds structurally, not
-- by convention.
--
-- UNKNOWN/RETIRED WIDGET KEYS ARE NEVER DELETED FROM A USER'S ROW (stated
-- choice, per the task's own acceptance criteria): a stored widget_key
-- that no longer exists in the registry is filtered out at READ time
-- (lib/page-layout/actions-core.ts's getLayoutCore), never rendered, and
-- the row is simply left alone -- if the same key is ever reintroduced to
-- the registry, the user's prior position/hidden state resumes rather
-- than resetting to a fresh default. No CHECK constraint against the
-- registry's own key set: that set lives in application code and changes
-- with deploys, not with migrations, so a DB-level enum here would need a
-- migration every time a widget is added or renamed -- the registry
-- itself, plus saveLayoutCore's own validation against it, is the correct
-- and only place that enforcement belongs.
--
-- NO PUBLIC/CROSS-USER READ PATH OF ANY KIND -- owner-only RLS, same as
-- every other user-owned table.
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

create table public.page_layout_widgets (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  domain_key text not null,
  widget_key text not null,
  position   int not null,
  hidden     boolean not null default false,
  config     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, domain_key, widget_key)
);

comment on table public.page_layout_widgets is
  'WIDGET-01: per-user override of one built-in panel''s position/hidden state on one domain page. lib/page-layout/registry.ts is the source of truth for which widgets exist; a row here only ever overrides position/hidden for a widget the registry already knows about. Absence of a row is never an error -- the registry''s own default applies. A row for a widget key later retired from the registry is left in place, never deleted, and is simply filtered out at read time.';

comment on column public.page_layout_widgets.config is
  'Reserved for future per-widget configuration (e.g. a widget with its own display options). Unused by this task -- every write sets it to the empty object.';

alter table public.page_layout_widgets enable row level security;

create policy "page_layout_widgets_own_row" on public.page_layout_widgets
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
