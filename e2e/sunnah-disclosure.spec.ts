import { test, expect, type Page } from "@playwright/test";
import { dismissCheckinDialogIfPresent, clickAndSettle } from "./helpers";

// Covers A3, the 2026-08-25/26 sunnah disclosure work: the 1.5s
// auto-collapse (both on Deen's own PrayerRow and Home's Now-module prayer
// row, which share components/deen/sunnah-disclosure.tsx), and — the part
// unit tests structurally cannot answer — that a sunnah tap really does
// leave the `prayers` table alone, read from the actual database via the
// read-prayer-status test route, the same check done manually with psql
// during that work. Rendering identically either way is exactly the
// nesting hazard this spec exists to catch.
//
// STATE-AGNOSTIC BY DESIGN, not by assuming a clean slate: rather than
// assert the fard prayer's status is null (which would only be true if
// nothing had ever logged it — a real account can legitimately have a
// stored status for any prayer at any time), this captures the EXACT
// prayers-row snapshot (status + logged_at) before the sunnah tap and
// asserts it is byte-for-byte unchanged after. That holds regardless of
// what the account's real state happens to be when this runs — the same
// "establish your own starting state, don't assume one" discipline
// e2e/deen.spec.ts's residual-status note calls for, applied one level
// deeper.
//
// SEED cleanup: clear-sunnah deletes the exact (prayer, slot) row this
// spec writes, both before (establish a known start) and after (leave no
// residue) — never toggling blind, since toggleSunnah flips whatever is
// currently stored and a prior run's leftover state would invert the
// first tap here exactly the way it does for prayer status elsewhere in
// this suite.

async function readPrayerStatus(page: Page, baseURL: string | undefined, secret: string, prayerName: string) {
  const res = await page.request.get(`${baseURL}/api/test/read-prayer-status?prayerName=${prayerName}`, {
    headers: { "x-e2e-secret": secret },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as { status: string | null; logged_at?: string | null };
}

test.describe("Sunnah disclosure — auto-collapse and the fard-prayer isolation guarantee", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const secret = process.env.E2E_TEST_SECRET;
    test.skip(!secret, "E2E_TEST_SECRET not set — see .env.local");

    // Asr has exactly one rawatib slot (before, per lib/deen/sunnah.ts) —
    // distinct from e2e/deen.spec.ts's own Isha-focused fard-status test,
    // so the two never touch the same row.
    await page.request.delete(`${baseURL}/api/test/clear-sunnah`, {
      headers: { "x-e2e-secret": secret! },
      data: { prayerName: "asr", slot: "before" },
    });
  });

  test.afterEach(async ({ page, baseURL }) => {
    const secret = process.env.E2E_TEST_SECRET;
    if (!secret) return;
    await page.request.delete(`${baseURL}/api/test/clear-sunnah`, {
      headers: { "x-e2e-secret": secret },
      data: { prayerName: "asr", slot: "before" },
    });
  });

  test("Deen: a sunnah tap auto-collapses ~1.5s later and never writes to the fard prayers row", async ({
    page,
    baseURL,
  }) => {
    const secret = process.env.E2E_TEST_SECRET!;
    const before = await readPrayerStatus(page, baseURL, secret, "asr");

    await page.goto("/deen");
    await dismissCheckinDialogIfPresent(page);

    const salahPanel = page.locator("[data-panel]").filter({ has: page.getByText("Salah", { exact: true }) });
    const asrRow = salahPanel.locator("li", { hasText: "Asr" });
    const chevron = asrRow.getByRole("button", { name: "Sunnah for Asr" });
    await expect(chevron).toBeVisible();
    await expect(chevron).toHaveAttribute("aria-expanded", "false");

    await chevron.click();
    const slotButton = asrRow.getByRole("button", { name: /before.*4 rak/i });
    await expect(slotButton).toBeVisible();
    await expect(slotButton).toHaveAttribute("aria-pressed", "false");

    await slotButton.click();
    // Instant, optimistic: pressed state flips before the write settles.
    await expect(slotButton).toHaveAttribute("aria-pressed", "true");

    // Still open well before 1.5s...
    await page.waitForTimeout(800);
    await expect(chevron).toHaveAttribute("aria-expanded", "true");

    // ...auto-collapsed by ~2s (1.5s target plus real network latency).
    await expect(chevron).toHaveAttribute("aria-expanded", "false", { timeout: 2000 });
    await expect(chevron).toHaveText("1/1");

    await page.waitForLoadState("networkidle");

    // The nesting hazard: this must render identically whether the fard
    // prayer was touched or not, so only a real DB read proves it.
    const after = await readPrayerStatus(page, baseURL, secret, "asr");
    expect(after).toEqual(before);

    const sunnahRes = await page.request.get(`${baseURL}/api/test/read-sunnah-status?prayerName=asr&slot=before`, {
      headers: { "x-e2e-secret": secret },
    });
    expect((await sunnahRes.json()).completed).toBe(true);
  });

  test("Home: the Now module's prayer row exposes the sunnah disclosure, and completing the prayer still works independently", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);

    const nowPanel = page.locator("[data-panel]").filter({ has: page.getByText("Now", { exact: true }) });
    const chevron = nowPanel.getByRole("button", { name: /^Sunnah for /i });

    // Home shows at most one prayer at a time (selectNextActionPerDomain) —
    // if nothing is currently actionable there's no row to test against,
    // and this spec skips rather than forcing state to manufacture one.
    if ((await chevron.count()) === 0) {
      test.skip(true, "No pending prayer currently showing in Home's Now module");
    }

    const ariaLabel = await chevron.getAttribute("aria-label");
    const label = ariaLabel!.replace(/^Sunnah for /i, "");
    // Jummah is Dhuhr's Friday display label — sunnah_logs/prayers both
    // still key on "dhuhr" (see get-priority-items.ts, prayer-row.tsx).
    const prayerName = (label === "Jummah" ? "dhuhr" : label).toLowerCase();

    const secret = process.env.E2E_TEST_SECRET;
    test.skip(!secret, "E2E_TEST_SECRET not set — see .env.local");
    const before = await readPrayerStatus(page, baseURL, secret!, prayerName);

    const row = nowPanel.getByRole("button", { name: new RegExp(`^Mark "${label}" done$`) });
    await expect(row).toBeVisible();
    await expect(chevron).toHaveAttribute("aria-expanded", "false");

    await chevron.click();
    await expect(chevron).toHaveAttribute("aria-expanded", "true");
    // The row's own primary action is untouched by opening the disclosure.
    await expect(row).toBeVisible();

    await chevron.click(); // manual collapse, don't wait out the 1.5s twice in this spec
    await expect(chevron).toHaveAttribute("aria-expanded", "false");

    const after = await readPrayerStatus(page, baseURL, secret!, prayerName);
    expect(after).toEqual(before);

    // The chevron never having been given time to write anything, confirm
    // the row's OWN completion still works as its own, separate action.
    await clickAndSettle(page, row);
    await expect(row).toBeHidden({ timeout: 3000 });

    // Restore: this spec must not leave a real prayer marked done.
    const restoreRes = await page.request.delete(`${baseURL}/api/test/clear-prayer`, {
      headers: { "x-e2e-secret": secret! },
      data: { prayerName },
    });
    expect(restoreRes.ok()).toBe(true);
  });
});
