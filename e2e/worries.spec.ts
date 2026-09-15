import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent, fillReliably } from "./helpers";

/**
 * Worries (#42): parks one through the Global Capture Sheet (components/
 * capture/global-capture-sheet.tsx — the "Worry" segment writes
 * `dump_source: 'worry'` via `captureDump`, per that file's own header),
 * confirms it shows up open on /worries, then marks it handled.
 *
 * MUTATING: creates a real `tasks` row on SEED, the same as any real
 * capture. Marking it handled both proves the feature AND moves it off the
 * open list — but a "handled" task is not gone, it is still real history
 * (worry-list.tsx's own "N handled" reveal), so this spec must not leave
 * even that behind on Ayman's real account. Cleanup runs in `finally` via
 * app/api/test/clear-task, the same test-only route
 * e2e/task-row-list.spec.ts already uses (worries ARE tasks — see
 * lib/night-plan/worries.ts).
 */
test("park a worry from the capture sheet, see it open, mark it handled", async ({ page, baseURL }) => {
  const secret = process.env.E2E_TEST_SECRET;
  if (!secret) {
    test.skip(true, "E2E_TEST_SECRET not set — see .env.local");
  }

  const title = `e2e-worry-${Date.now()}`;

  try {
    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);

    await page.getByRole("button", { name: "Capture", exact: true }).click();
    const captureDialog = page.getByRole("dialog", { name: "Capture" });
    await expect(captureDialog).toBeVisible();

    await page.getByRole("button", { name: "Worry", exact: true }).click();
    await fillReliably(page.getByLabel("Capture input"), title);
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(captureDialog).toBeHidden();

    await page.goto("/worries");
    await dismissCheckinDialogIfPresent(page);

    const openRow = page.getByRole("listitem").filter({ hasText: title });
    await expect(openRow).toBeVisible();

    await openRow.getByRole("button", { name: "Handled" }).click();
    await expect(openRow).toBeHidden();

    // Reveal the handled list (its own toggle, distinct from any per-row
    // "Handled" button — matched by the "Show/Hide N handled" shape rather
    // than a bare "handled" substring, which every open row's own button
    // also contains). No aria-expanded on this toggle (unlike Goals' own
    // "Completed & dropped" one) — the page was just freshly navigated to,
    // so `showHandled` is guaranteed to be its collapsed default, and a
    // single click always reveals it.
    const handledToggle = page.getByRole("button", { name: /^Show \d+ handled$/i });
    await expect(handledToggle).toBeVisible();
    await handledToggle.click();
    const handledRow = page.getByRole("listitem").filter({ hasText: title });
    await expect(handledRow).toBeVisible();
    await expect(handledRow.getByRole("button", { name: "Reopen" })).toBeVisible();
  } finally {
    await page.request
      .delete(`${baseURL}/api/test/clear-task`, { headers: { "x-e2e-secret": secret! }, data: { title } })
      .catch(() => undefined);
  }
});
