import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

// A real 2-hour check-in window can't be waited out in a test run, so this
// drives the actual answerCheckin Server Action directly through a
// test-only, secret-gated route (app/api/test/answer-checkin/route.ts)
// instead of faking a DB row — then verifies both the persisted row and
// that the Business page's Signal:Noise ratio (which reads straight from
// the checkins table) actually changed as a result. Relies on the shared
// authenticated session (e2e/auth.setup.ts) — page.request reuses the same
// browser context's cookies, so the test-route calls below are authenticated
// too.
//
// Post Phase E, the ratio lives in the "Signal:Noise by week" panel's own
// header (one-metric rule — the standalone SnRatioCard/"This week's
// Signal:Noise" text is gone), so the locator is scoped to that panel's
// data-panel container rather than a literal label string.
test("answering a check-in records it and updates the weekly Signal:Noise ratio", async ({ page, baseURL }) => {
  const secret = process.env.E2E_TEST_SECRET;
  if (!secret) {
    test.skip(true, "E2E_TEST_SECRET not set — see .env.local");
  }

  await page.goto("/business");
  await dismissCheckinDialogIfPresent(page);
  const snPanel = page.locator("[data-panel]", { hasText: "Signal:Noise by week" });
  const before = await snPanel.locator(".font-mono").first().innerText();

  const checkinTime = new Date().toISOString();
  const response = await page.request.post(`${baseURL}/api/test/answer-checkin`, {
    headers: { "x-e2e-secret": secret! },
    data: {
      checkinTime,
      tagType: "kill_list",
      tagLabel: "E2E test check-in",
      tagRefId: null,
    },
  });
  expect(response.ok()).toBe(true);
  const { row } = await response.json();
  // Postgres round-trips the timestamp as "...+00:00" rather than "...Z" —
  // compare instants, not string formatting.
  expect(new Date(row.checkin_time).getTime()).toBe(new Date(checkinTime).getTime());
  expect(row).toMatchObject({
    tag_type: "kill_list",
    tag_label: "E2E test check-in",
    answered: true,
  });

  await page.goto("/business");
  await dismissCheckinDialogIfPresent(page);
  const after = await snPanel.locator(".font-mono").first().innerText();
  expect(after).not.toBe(before);

  // Cleanup — delete the exact row this test created.
  const cleanup = await page.request.delete(`${baseURL}/api/test/answer-checkin`, {
    headers: { "x-e2e-secret": secret! },
    data: { id: row.id },
  });
  expect(cleanup.ok()).toBe(true);
});
