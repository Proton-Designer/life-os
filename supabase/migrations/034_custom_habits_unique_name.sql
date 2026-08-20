-- Phase 5 (Engineer 2) — the two daily checks (spec §7, "Hit protein
-- target" / "8,000+ steps") are find-or-create rows against custom_habits,
-- which has no uniqueness guard today. Without this, a double-tap or two
-- concurrent Home loads could each insert their own habit row for the same
-- name, producing duplicate checkboxes. Zero rows exist for domain='fitness'
-- currently (per the redesign spec's finding), so this is a pure addition —
-- nothing to conflict with on creation.
--
-- Partial (where not archived), matching the exercises/rep_goals convention
-- already established in 025/027: an archived habit must not block
-- recreating one with the same name.
--
-- Deliberately spans ALL domains, not scoped to domain='fitness' — the
-- index is (user_id, domain, lower(name)), so Deen's habit-builder (which
-- writes into this same custom_habits table) is covered too. That's the
-- right call on the merits — two identically-named active habits in one
-- domain is a bug on any screen, not just this one — but it changes
-- behaviour for a screen this phase doesn't otherwise touch, so it's
-- recorded here deliberately rather than as an incidental side effect
-- (Opus Lead, 2026-08-20). Verified clean against live data first: zero
-- active-duplicate rows on (user_id, domain, name) as of this migration —
-- the table has exactly one row total, an archived fitness habit, so this
-- applies to an effectively empty table with nothing to reconcile.

create unique index if not exists custom_habits_user_domain_name_unique
  on public.custom_habits (user_id, domain, lower(name))
  where not archived;
