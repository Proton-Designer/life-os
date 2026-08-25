import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

// 2026-08-25 rewrite: the check-in model this spec tested (checkins.tag_type,
// read by /business' "Signal:Noise by week" panel) was replaced by the
// allocation-window model (checkins.kind = 'allocation' + checkin_allocations,
// read by /insights) in 05e6ecd, 2026-08-19 — weeks before this spec started
// failing tonight. It was stale, not broken: /business no longer has that
// panel at all, and answerCheckin(tagType, ...) never populates
// allocation-minutes, so the old seeding path can't produce data /insights
// reads either. Rewritten against the current model end to end — see
// app/api/test/save-allocation-checkin/route.ts for why a real 2-hour
// allocation window can't be waited out in a test run and how the window is
// computed from the profile's own timezone, never the runner's raw clock.
//
// A real 2-hour check-in window can't be waited out in a test run, so this
// drives the actual saveAllocationCheckin Server Action directly through a
// test-only, secret-gated route instead of faking a DB row — then verifies
// both the persisted row (checkins + checkin_allocations) and that
// /insights' Signal:Noise panels actually reflect it. Cleanup runs in a
// `finally` so a mid-test failure (a real one, or a Playwright timeout)
// still removes the row instead of leaving stray "E2E test" data behind —
// the exact residue Engineer B found tonight from this spec's old failing
// runs.
test("answering an allocation check-in records it and Insights' Signal:Noise panels reflect it", async ({
  page,
  baseURL,
}) => {
  const secret = process.env.E2E_TEST_SECRET;
  if (!secret) {
    test.skip(true, "E2E_TEST_SECRET not set — see .env.local");
  }

  let checkinId: string | null = null;
  try {
    const response = await page.request.post(`${baseURL}/api/test/save-allocation-checkin`, {
      headers: { "x-e2e-secret": secret! },
      data: { allocation: { business: 30 } },
    });
    expect(response.ok()).toBe(true);
    const { row } = await response.json();
    checkinId = row.id;

    expect(row).toMatchObject({ kind: "allocation", answered: true });
    const allocations: { domain: string; minutes: number }[] = row.checkin_allocations;
    expect(allocations).toEqual(
      expect.arrayContaining([
        { domain: "business", minutes: 30 },
        // wasted = TOTAL_MINUTES(120) - assigned(30), derived and persisted
        // by save_allocation_checkin itself, not something this test computes.
        { domain: "wasted", minutes: 90 },
      ])
    );

    await page.goto("/insights");
    await dismissCheckinDialogIfPresent(page);

    // "Signal:Noise by week" (last 6 weeks, current week included) — a
    // real business allocation this week guarantees non-empty data,
    // regardless of whatever else this shared account has going on. Scoped
    // by an EXACT title match — "Signal:Noise" is a substring of "Signal:
    // Noise by week", so a plain hasText match on either string is
    // ambiguous between these two distinct panels.
    const snByWeekPanel = page.locator("[data-panel]").filter({ has: page.getByText("Signal:Noise by week", { exact: true }) });
    await expect(snByWeekPanel.getByText(/No allocation check-ins answered/)).toHaveCount(0);

    // The range donut ("Signal:Noise", defaults to this week) — same
    // guarantee, independent panel/query.
    const snRangePanel = page.locator("[data-panel]").filter({ has: page.getByText("Signal:Noise", { exact: true }) });
    await expect(snRangePanel.getByText(/No allocation check-ins answered/)).toHaveCount(0);
  } finally {
    if (secret) {
      const cleanup = await page.request.delete(`${baseURL}/api/test/save-allocation-checkin`, {
        headers: { "x-e2e-secret": secret },
        // Deletes by id when the POST above got far enough to capture one;
        // the route falls back to deleting by the well-known window_start
        // otherwise, so a failure before `checkinId` is set still cleans up.
        data: checkinId ? { id: checkinId } : {},
      });
      expect(cleanup.ok()).toBe(true);
    }
  }
});
