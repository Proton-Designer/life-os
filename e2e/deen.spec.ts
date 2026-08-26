import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent, clickAndSettle } from "./helpers";

// Isha, specifically: it's the last prayer of the day, so at almost any hour
// this run happens, today's Isha is the prayer least likely to already carry
// a real logged status the test would need to preserve exactly.
// PRE-RUN STATE MATTERS: prayer-row.tsx treats a click on an ALREADY-ACTIVE
// status as a deliberate misclick correction and DELETES the row. So if a
// previous run (or a manual session) left Isha already on-time, this spec's
// first click unmarks it instead of marking it, and the run fails in a way
// that looks like a product bug. Bit three separate runs on 2026-08-24/25.
// The spec restores Isha to neutral at the end for exactly this reason — if
// you are debugging a failure here, check the stored status FIRST.
const PRAYER_NAME = "isha";
const PRAYER_LABEL = "Isha";
const STATUS_LABELS = ["On-time", "Qada", "Missed"] as const;

// clickAndSettle now lives in ./helpers (2026-08-26, item 6 e2e batch) —
// the same source-page-networkidle reasoning applies to every mutating
// click in this suite, not just this file's own. See its doc comment
// there for the full "why not toBeEnabled(), why not the first response"
// history.

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
  const salahPanel = page.locator("[data-panel]").filter({ has: page.getByText("Salah", { exact: true }) });
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
    const restoreSalahPanel = page.locator("[data-panel]").filter({ has: page.getByText("Salah", { exact: true }) });
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
