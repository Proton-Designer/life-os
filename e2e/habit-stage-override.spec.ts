import { test } from "@playwright/test";

// Item 6 (Habit Builder editor, 2026-08-25/26) — data layer landed at
// 5c1b16b/959234a (migration 047, lib/deen/habit-stage.ts,
// app/(app)/deen/actions.ts's six actions). C owns the two-screen dialog
// UI on top of it; that UI doesn't exist yet, so this is a stub, not a
// placeholder passing test — there is nothing to select or assert against
// until it lands (Server Actions aren't callable directly over HTTP the
// way the test-only /api/test/* routes are, so there's no meaningful
// interim assertion to make from here either).
//
// WIRE THIS UP once C's UI exists — the assertion that actually matters
// (Opus Lead, 2026-08-25/26): "at minimum that an overridden stage
// actually renders where the override says." Concretely:
//   1. Open a habit's editor, set a stage override (e.g. "locked" on a
//      freshly-created habit that would otherwise derive "active_build").
//   2. Confirm the habit's displayed stage badge/label reflects the
//      override, not the derived days-since-committed_date value.
//   3. Reset the override to null (automatic) and confirm the display
//      reverts to the derived stage.
//   4. Same residual-state discipline as every other spec in this suite:
//      create a throwaway habit for this test rather than mutating one of
//      SEED's real habits, and delete it in an afterEach/afterAll —
//      archiveDeenHabit soft-deletes (sets `archived`), so use a direct
//      hard-delete test route if one gets added, or confirm archiving is
//      an acceptable final state for a test-created habit before relying
//      on it as cleanup.
test.describe("Habit Builder — stage override (item 6 UI, stub)", () => {
  test.skip("an overridden stage renders where the override says — wire up once C's editor UI lands", () => {});
});
