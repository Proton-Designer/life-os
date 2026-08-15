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

  const prayerRow = page.locator("li", { hasText: PRAYER_LABEL });
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

  await prayerRow.getByRole("button", { name: "On-time" }).click();
  await expect(prayerRow.getByRole("button", { name: "On-time" }).locator("span")).toHaveClass(
    /text-accent-business/
  );

  // Reflects on Home: a logged (non-pending) prayer is excluded from the
  // priority list entirely (lib/home/get-priority-items.ts).
  await page.goto("/");
  await dismissCheckinDialogIfPresent(page);
  await expect(page.getByRole("button", { name: `Mark "${PRAYER_LABEL}" done` })).toHaveCount(0);

  // Restore real account state exactly as found.
  if (priorStatusLabel) {
    await page.goto("/deen");
    await dismissCheckinDialogIfPresent(page);
    await page.locator("li", { hasText: PRAYER_LABEL }).getByRole("button", { name: priorStatusLabel }).click();
  } else {
    const cleanup = await page.request.delete(`${baseURL}/api/test/clear-prayer`, {
      headers: { "x-e2e-secret": secret! },
      data: { prayerName: PRAYER_NAME },
    });
    expect(cleanup.ok()).toBe(true);
  }
});
