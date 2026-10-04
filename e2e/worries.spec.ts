import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent, dismissCheckinToastIfPresent, fillReliably, clickAndSettle } from "./helpers";

/** Cold serverless starts can exceed the default 5s expect timeout (found live as a habits.spec.ts Mobile flake, 2026-09-15, same class of risk here). Not a loosened assertion, a longer one for a real slow-but-correct path. */
const MUTATION_TIMEOUT = { timeout: 15_000 };

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
 *
 * `dismissCheckinToastIfPresent` guards every interaction that matters
 * here, proactively — its own header explains why (found live as a real
 * flaky failure in e2e/goals.spec.ts, 2026-09-15: the allocation check-in
 * toast fires on its own timer and can appear mid-test, unrelated to
 * anything this spec does).
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

    await dismissCheckinToastIfPresent(page);
    await page.getByRole("button", { name: "Capture", exact: true }).click();
    const captureDialog = page.getByRole("dialog", { name: "Capture" });
    await expect(captureDialog).toBeVisible();

    await page.getByRole("button", { name: "Worry", exact: true }).click();
    await fillReliably(page.getByLabel("Capture input"), title);
    // clickAndSettle, not a bare click: captureDump is a server round trip,
    // and handleClose() (which is what actually hides the dialog) only
    // runs after it resolves — the button itself shows "Saving…" while
    // pending (components/capture/global-capture-sheet.tsx), so a cold
    // serverless start can outlast the default 5s expect timeout below.
    await clickAndSettle(page, page.getByRole("button", { name: "Confirm" }));
    await expect(captureDialog).toBeHidden(MUTATION_TIMEOUT);

    // IA-P3a: /worries redirects to the reset's worry-hour step; go there directly.
    await page.goto("/week#worries");
    await dismissCheckinDialogIfPresent(page);
    await dismissCheckinToastIfPresent(page);

    const openRow = page.locator("#worries").getByRole("listitem").filter({ hasText: title });
    await expect(openRow).toBeVisible();

    // markWorryHandled is OPTIMISTIC (components/worries/worry-list.tsx's
    // handle()) — the row moves before the server round trip even starts —
    // so this one is not the flake risk the others are. clickAndSettle
    // applied anyway per the Lead's instruction, for consistency with every
    // other mutating click in this file rather than leaving one bare.
    await dismissCheckinToastIfPresent(page);
    await clickAndSettle(page, openRow.getByRole("button", { name: "Handled" }));
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
    await dismissCheckinToastIfPresent(page);
    await handledToggle.click();
    const handledRow = page.locator("#worries").getByRole("listitem").filter({ hasText: title });
    await expect(handledRow).toBeVisible();
    await expect(handledRow.getByRole("button", { name: "Reopen" })).toBeVisible();
  } finally {
    await page.request
      .delete(`${baseURL}/api/test/clear-task`, { headers: { "x-e2e-secret": secret! }, data: { title } })
      .catch(() => undefined);
  }
});
