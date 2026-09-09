-- 137: `updated_at` for the five cross-cutting tables the MCP `settings`/
-- `distractions` read-only domains expose (lib/mcp/registry.ts).
--
-- Same discipline as 133/135/136: read each table's REAL write paths before
-- deciding, not blanket-added by table-name pattern-matching. Found while
-- building those domains — TOOL-ARCHITECTURE.md's "updated_at on every
-- entity, no exceptions" needs a real column behind it, or the entity's
-- `updatedAtColumn` must honestly be `null` until this lands (all five are
-- currently registered `null` for exactly that reason, with this migration
-- named in each entity's own updatedAtVerification note).
--
-- FIVE TABLES, ALL GENUINELY MUTATED IN PLACE (checked against real callers,
-- not assumed):
--
--   profiles              -- MUTABLE, extremely widely: updateProfile
--                            (app/(app)/settings/actions.ts) upserts
--                            display_name/timezone/theme_preset/
--                            hidden_features/pin_hash/etc. on an EXISTING
--                            row for any settings change; skipCheckinsToday
--                            (app/(app)/checkin/actions.ts) updates
--                            paused_date directly. `created_at` is set once
--                            at account creation and would be stale for the
--                            entire life of the account after the first
--                            settings change. NEEDS a real updated_at — no
--                            existing column is even a partial proxy.
--   user_settings          -- MUTABLE: saveWeekdayBaselines/
--                            clearWeekdayBaselines (app/(app)/settings/
--                            weekday-baseline-actions.ts) UPDATE an existing
--                            row; self-mastery session code upserts FSRS
--                            settings. The table has NO created_at or
--                            updated_at at all today (confirmed against
--                            lib/supabase/database.types.ts's generated Row
--                            type) — nothing to even go stale. NEEDS a real
--                            updated_at.
--   distraction_triggers   -- MUTABLE: updateTrigger (app/(app)/
--                            distractions/actions.ts) UPDATEs name/
--                            description on an existing row post-creation.
--                            `created_at` would go stale on the first edit.
--                            NEEDS a real updated_at. (No app code path
--                            currently flips `archived` — verified by
--                            grepping for `archived: true`/`archiveTrigger`
--                            and finding neither — but the name/description
--                            edit path alone is enough to need this.)
--   trigger_action_plans    -- MUTABLE two different ways: saveActionPlan's
--                            direct branch UPDATEs an existing current
--                            plan's `body` in place; separately,
--                            save_trigger_plan (migration 041's RPC) UPDATEs
--                            the OLD row's `superseded_at`/`supersede_reason`
--                            when a new version is authored, which changes a
--                            row that already has a `created_at`. No column
--                            reflects either kind of change today. NEEDS a
--                            real updated_at.
--   trigger_plan_outcomes   -- MUTABLE: record_plan_outcome (migration 043's
--                            RPC) does `insert ... on conflict (user_id,
--                            trigger_id, date) do update set followed =
--                            excluded.followed, plan_id = excluded.plan_id`
--                            — a same-day resubmission genuinely overwrites
--                            an existing row's `followed`/`plan_id`, and
--                            `created_at` (the only timestamp on the table)
--                            would go stale for that row. NEEDS a real
--                            updated_at.
--
-- THREE TABLES CHECKED AND DELIBERATELY LEFT UNCHANGED (append-only,
-- created_at IS the true last-modified time — same reasoning 133 used for
-- quran_sessions/reflection_entries):
--
--   checkins               -- Every write path INSERTs only: answerCheckin,
--                            recordMissedCheckin (app/(app)/checkin/
--                            actions.ts), and save_allocation_checkin
--                            (migrations 020/022/108's RPC, whose
--                            unique_violation branch SELECTs the existing
--                            row rather than updating it). No UPDATE
--                            anywhere. `created_at` is faithful. NO CHANGE.
--   checkin_allocations     -- Written only inside save_allocation_checkin's
--                            insert loop (plus the is_wasted row added by
--                            108) — never updated after insert. `created_at`
--                            is faithful. NO CHANGE.
--   distraction_events      -- Written only by insertEvent (app/(app)/
--                            distractions/actions.ts), an INSERT with no
--                            corresponding update/delete path found anywhere
--                            in the app. `created_at` is faithful. NO
--                            CHANGE.
--
-- `user_api_keys` is NOT in this file: it already has a real `updated_at`
-- column (migration 104) that api-key-actions.ts's `saveApiKey` explicitly
-- sets on every upsert (`updated_at: new Date().toISOString()`) — faithful
-- today, verified against its one write path, no migration needed.
--
-- Reuses migration 074's existing `public.touch_updated_at()` trigger
-- function — not reinvented, same idiom as 133/135/136. `if not exists` /
-- `drop trigger if exists` throughout, matching 135/136's idempotent-rerun
-- shape rather than 133's plain form.
--
-- No begin;/commit; — the runner (apply-migration.sh) owns the transaction.

alter table public.profiles              add column if not exists updated_at timestamptz not null default now();
alter table public.user_settings         add column if not exists updated_at timestamptz not null default now();
alter table public.distraction_triggers  add column if not exists updated_at timestamptz not null default now();
alter table public.trigger_action_plans  add column if not exists updated_at timestamptz not null default now();
alter table public.trigger_plan_outcomes add column if not exists updated_at timestamptz not null default now();

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles for each row execute function public.touch_updated_at();

drop trigger if exists user_settings_touch_updated_at on public.user_settings;
create trigger user_settings_touch_updated_at
  before update on public.user_settings for each row execute function public.touch_updated_at();

drop trigger if exists distraction_triggers_touch_updated_at on public.distraction_triggers;
create trigger distraction_triggers_touch_updated_at
  before update on public.distraction_triggers for each row execute function public.touch_updated_at();

drop trigger if exists trigger_action_plans_touch_updated_at on public.trigger_action_plans;
create trigger trigger_action_plans_touch_updated_at
  before update on public.trigger_action_plans for each row execute function public.touch_updated_at();

drop trigger if exists trigger_plan_outcomes_touch_updated_at on public.trigger_plan_outcomes;
create trigger trigger_plan_outcomes_touch_updated_at
  before update on public.trigger_plan_outcomes for each row execute function public.touch_updated_at();
