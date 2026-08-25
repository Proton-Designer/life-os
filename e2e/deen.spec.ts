import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

// Isha, specifically: it's the last prayer of the day, so at almost any hour
// this run happens, today's Isha is the prayer least likely to already carry
// a real logged status the test would need to preserve exactly.
const PRAYER_NAME = "isha";
const PRAYER_LABEL = "Isha";
const STATUS_LABELS = ["On-time", "Qada", "Missed"] as const;

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
  await onTimeButton.click();
  await expect(onTimeButton.locator("span")).toHaveClass(/text-accent-business/);
  // The class check above can pass on the OPTIMISTIC paint alone —
  // PrayerRow's handleClick calls setOptimisticStatus synchronously, then
  // `await markPrayer(...)` inside the same transition — so it resolves a
  // tick after the click, well before the Supabase round trip actually
  // lands. Racing straight into goto("/") from there was a real, previously
  // undiagnosed bug in THIS FILE (not the product): Home's fresh server
  // render could still read the pre-write row. Wait for the real mutation
  // to settle instead of inferring it from something that paints early —
  // the button carries `disabled={isPending}` (prayer-row.tsx), and
  // isPending only clears once the awaited markPrayer call has actually
  // resolved, so waiting for it to re-enable is waiting for the write
  // itself, not a proxy for it like `networkidle` would be.
  await expect(onTimeButton).toBeEnabled();

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
    await restoreButton.click();
    // Same discipline as the mark above: wait for the restore write to
    // actually settle before the test ends, not just its optimistic paint
    // — otherwise Mobile Chrome's run (workers:1, same account, right
    // after this one) could start against a still-in-flight write.
    await expect(restoreButton).toBeEnabled();
  } else {
    const cleanup = await page.request.delete(`${baseURL}/api/test/clear-prayer`, {
      headers: { "x-e2e-secret": secret! },
      data: { prayerName: PRAYER_NAME },
    });
    expect(cleanup.ok()).toBe(true);
  }
});
