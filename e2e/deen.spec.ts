import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

// Isha, specifically: it's the last prayer of the day, so at almost any hour
// this run happens, today's Isha is the prayer least likely to already carry
// a real logged status the test would need to preserve exactly.
const PRAYER_NAME = "isha";
const PRAYER_LABEL = "Isha";
const STATUS_LABELS = ["On-time", "Qada", "Missed"] as const;

/**
 * Waits for a mutation click to fully settle before it's safe to navigate
 * away. Two things have to both be true, not just one:
 *
 * 1. The Server Action's own response has to come back — PrayerRow's
 *    handleClick calls setOptimisticStatus synchronously and `await
 *    markPrayer(...)` after, in the same transition, so a class assertion
 *    right after the click can pass on the OPTIMISTIC paint alone, a tick
 *    before the real Supabase round trip lands.
 * 2. The page has to stay put until ALL of that click's network activity
 *    is done, not just the first response — `page.goto()` tears down the
 *    current page's execution context, which cancels any of ITS still-
 *    in-flight requests. A live capture showed one click fan out into ~5
 *    sequential POSTs (the action itself plus revalidation chatter); racing
 *    a navigation in before the last one finishes can silently abort the
 *    write entirely — not just read it stale, actually never persist it.
 *    That's what two earlier "fixes" here missed: `await
 *    expect(button).toBeEnabled()` (isPending flips true on React's NEXT
 *    render, not synchronously with the click, so a poll can land in that
 *    gap and pass immediately) and waiting for a single matching response
 *    (the first of the ~5 isn't reliably the last one, and navigating away
 *    right after it fired straight into the cancellation window above).
 *    Confirmed directly: an isolated click followed immediately by
 *    `page.goto()` left the `prayers` row missing entirely — not stale,
 *    genuinely never written — while the same click followed by
 *    `waitForLoadState("networkidle")` on the SAME page, before
 *    navigating anywhere, committed reliably across 5/5 repeated runs.
 *
 * `networkidle` is doing something different here than the network-idle
 * call this suite's other rulings tonight correctly rejected as a proxy on
 * the DESTINATION page (waiting long enough for a race to probably have
 * resolved). This is on the SOURCE page, before ever navigating: not
 * inferring completion from elapsed time, but refusing to cancel the real
 * request by leaving before it's actually done.
 */
async function clickAndSettle(page: import("@playwright/test").Page, button: import("@playwright/test").Locator) {
  await button.click();
  await page.waitForLoadState("networkidle");
}

// Relies on the shared authenticated session (e2e/auth.setup.ts).
test("marking a prayer on-time reflects on both /deen and Home", async ({ page, baseURL }) => {
  const secret = process.env.E2E_TEST_SECRET;
  if (!secret) {
    test.skip(true, "E2E_TEST_SECRET not set — see .env.local");
  }

  await page.goto("/deen");
  await dismissCheckinDialogIfPresent(page);

  // Scoped to the Salah panel specifically — the Qada backlog panel also
  // renders <li>s with "Isha · <date>" text (lib/deen/qada-backlog-list.tsx),
  // so an unscoped "li" locator resolves ambiguously in strict mode.
  const salahPanel = page.locator("[data-panel]").filter({ has: page.getByText("Salah today", { exact: true }) });
  const prayerRow = salahPanel.locator("li", { hasText: PRAYER_LABEL });
  await expect(prayerRow).toBeVisible();

  // Capture real pre-test state before mutating anything: whichever status
  // button (if any) currently carries the "active" Badge variant is the
  // account's real logged status — the color itself now varies by status
  // (positive/warning/negative), so "active" means "not the neutral variant"
  // rather than one specific class. None active means genuinely unlogged
  // ("pending" — markPrayer has no such value to write, so there's nothing
  // to restore to by clicking; cleanup instead deletes the row via the
  // test-only route).
  let priorStatusLabel: (typeof STATUS_LABELS)[number] | null = null;
  for (const label of STATUS_LABELS) {
    const isActive = await prayerRow
      .getByRole("button", { name: label })
      .locator("span")
      .evaluate((el) => !el.className.includes("bg-muted"));
    if (isActive) {
      priorStatusLabel = label;
      break;
    }
  }

  const onTimeButton = prayerRow.getByRole("button", { name: "On-time" });
  await clickAndSettle(page, onTimeButton);
  await expect(onTimeButton.locator("span")).toHaveClass(/text-accent-business/);

  // Reflects on Home: a logged (non-pending) prayer is excluded from the
  // priority list entirely (lib/home/get-priority-items.ts).
  await page.goto("/");
  await dismissCheckinDialogIfPresent(page);
  await expect(page.getByRole("button", { name: `Mark "${PRAYER_LABEL}" done` })).toHaveCount(0);

  // Restore real account state exactly as found.
  if (priorStatusLabel) {
    await page.goto("/deen");
    await dismissCheckinDialogIfPresent(page);
    const restoreSalahPanel = page.locator("[data-panel]").filter({ has: page.getByText("Salah today", { exact: true }) });
    const restoreButton = restoreSalahPanel
      .locator("li", { hasText: PRAYER_LABEL })
      .getByRole("button", { name: priorStatusLabel });
    await clickAndSettle(page, restoreButton);
  } else {
    const cleanup = await page.request.delete(`${baseURL}/api/test/clear-prayer`, {
      headers: { "x-e2e-secret": secret! },
      data: { prayerName: PRAYER_NAME },
    });
    expect(cleanup.ok()).toBe(true);
  }
});
