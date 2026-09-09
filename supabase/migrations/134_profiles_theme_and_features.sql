-- DRAFT — NOT a numbered migration. Per supabase/migrations/ALLOCATIONS.md's
-- rule ("Numbers are allocated by the LifeOS lead only. Nobody
-- self-assigns"), this file lives OUTSIDE supabase/migrations/ so it can
-- never be mistaken for an applied or pending migration. File it as
-- supabase/migrations/<N>_theme_and_feature_visibility.sql once a number is
-- allocated, then delete this draft.
--
-- L10 of the AI-integration program (docs/ai-connector/PROGRAM-PLAN.md):
-- storage for ~5 theme presets and per-account nav-feature visibility, the
-- narrow ("toggle visibility of already-built modules") reading of the
-- owner's "remove unwanted features / add features they don't have yet".
--
-- ON public.profiles, NOT a new table: this is exactly the same shape as
-- every other user-editable display preference already there
-- (display_name, pin_lock_enabled, checkin_window_start, ...), and
-- app/(app)/layout.tsx's AuthedShell already fetches the full profiles row
-- on every authenticated request (getProfile(), memoized) — putting these
-- here means the shell picks up a user's preference for free, no second
-- query, no new round trip.
--
-- BOTH COLUMNS ADDITIVE WITH A DEFAULT THAT REPRODUCES TODAY'S BEHAVIOR
-- EXACTLY: an existing account that never touches either setting must
-- render identically to before this migration. theme_preset defaults to
-- 'oxblood', which is CURRENT :root's own values verbatim (app/globals.css)
-- — not a new look, the existing one now has a name. hidden_features
-- defaults to '{}' — nothing hidden, every nav destination that renders
-- today keeps rendering.
alter table public.profiles
  add column if not exists theme_preset text not null default 'oxblood'
    check (theme_preset in ('oxblood', 'ocean', 'forest', 'sunset', 'mono')),
  add column if not exists hidden_features text[] not null default '{}'::text[]
    check (hidden_features <@ array['deen', 'work', 'business', 'school', 'fitness', 'insights']::text[]);

comment on column public.profiles.theme_preset is
  'L10: which of app/globals.css''s [data-theme-preset] accent-override blocks to '
  'apply (lib/theme-presets.ts is the single source of truth for the enum below and '
  'for what "oxblood" -- the default -- actually contains). CHECK deliberately does '
  'NOT enumerate every future preset in one place only -- lib/theme-presets.ts''s '
  'THEME_PRESET_IDS must be updated in the SAME change as any future ALTER adding a '
  'preset name here, or the app will accept a value the CSS has no override block for.';

comment on column public.profiles.hidden_features is
  'L10: nav destinations this account has turned off (lib/features.ts is the single '
  'source of truth for the enum below). Deliberately excludes "home" and "settings" '
  'from the allowed set -- see that file''s header for why hiding either would be a '
  'self-inflicted lockout rather than a feature. Read/written today only through '
  'app/(app)/settings/actions.ts''s updateProfile(); the MCP read/write tool dispatch '
  '(Eng1, in progress) is expected to reach these as more `settings`-domain entities '
  'later, per the Lead''s explicit instruction not to wire that side yet.';
