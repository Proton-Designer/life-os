-- A3 Part 2 (Faith depth dial) + Part 4 (Rhythm onboarding screen) +
-- Part 3 (the generic practice engine's ribbon anchors). Purely additive --
-- no CHECK constraint changes, no data movement, fully reversible. The
-- riskier R27 flatten (personal_growth row split) is a SEPARATE migration
-- (115) precisely so this one can land without a scratch dry-run gate.
--
-- user_domains.depth (BOSS-VISION §7: "position, weight tier, depth,
-- archived_at" -- a generic per-area attribute, same family as weight from
-- 110). NOT NULL, mirroring 110's own reasoning for weight: the Opus Lead's
-- explicit ruling on this migration is that a nullable depth would let a
-- domains-mode Faith row exist with no depth answered yet, and since depth
-- GATES RENDERING (never deletes), a null-defaulting-to-the-lightest-tier
-- would silently hide real quran_sessions/deen_habits/reflection_entries
-- history a user already has -- null-is-never-zero in its most literal
-- form. Unlike weight, there is no per-user "first row" backfill needed:
-- depth is meaningful ONLY for a key='faith' row today (no existing rows
-- have that key pre-115), so every row in this migration's blast radius
-- gets the same inert default. The DEFAULT below is a SQL-level backstop
-- only, never a real UX default -- the onboarding Faith-branch action
-- always writes a real value the moment the user answers (see
-- lib/deen/faith-depth.ts), so a Faith row is never actually LEFT at this
-- default in practice. Non-Faith rows carry it forever, unread by any
-- consumer -- depthIncludes() is never called for a non-Faith key.
-- 'prayers_only' (the lightest tier) is chosen over some other value only
-- because it is the safer of two meaningless choices, matching "nothing
-- defaulted to deepest" in spirit even though this default is never
-- actually shown to a real Faith-picking user.
--
-- profiles.evening_close_time -- the Rhythm onboarding screen's third
-- field (§6 amendment 2), distinct from checkin_window_start/end: those
-- two already exist (reused as WakeSleepBounds, see A3 Part 1's commit)
-- and answer "when are you awake," not "when do you do your nightly
-- review." NOT NULL with a default between the existing wake/sleep
-- defaults (08:00/22:00), same DB-defaults-cover-every-account approach
-- Part 1 relied on -- no absent-state to design for downstream.
--
-- deen_habits.cue_time -- A3 Part 3 (the generic practice engine): a habit
-- gets an OPTIONAL time-of-day cue so it can appear as a Day Ribbon anchor,
-- unifying "named daily practice with a cue" with the existing Habit
-- Builder instead of a new parallel table. Genuinely nullable, not a
-- backstop-default case: most habits have no cue and are simply absent
-- from the ribbon, which is the correct default (get-day-shape.ts only
-- reads habits where cue_time is not null).

begin;

alter table public.user_domains
  add column depth text not null default 'prayers_only'
  check (depth in ('prayers_only', 'prayers_quran', 'full_practice'));

alter table public.profiles
  add column evening_close_time text not null default '21:00';

alter table public.deen_habits
  add column cue_time time null;

commit;
