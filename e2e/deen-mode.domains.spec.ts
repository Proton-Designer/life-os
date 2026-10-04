import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";
import { getDeenState, setDeenMode } from "./deen-mode-helpers";

/**
 * DEEN-09 -- Deen Mode, end to end, on the DOMAINS-mode fixture
 * (seed-domains@lifeos.test; "Domains Fixture" project, so *.domains.spec.ts).
 *
 * Contract under test (INSTRUCTIONS R2-R5):
 *  - OFF (the default for every account): nothing religious anywhere -- nav,
 *    Home, Settings (no Prayer/Location, Timezone kept) -- and /deen and
 *    /personal/faith redirect to Home.
 *  - ON: Faith appears in nav, Home and Settings.
 *  - ON -> OFF never deletes deen data; OFF -> ON restores it.
 *
 * ONBOARDING is deliberately NOT walked here: reaching the Personal Growth
 * step calls saveDomainSelection, which would reconcile (archive) this
 * permanent fixture's user_domains rows. "No faith option in onboarding" is
 * pinned by unit tests (personal-growth-step / onboarding-wizard) and by the
 * fresh-signup specs (onboarding.spec.ts, stranger-journey.spec.ts).
 *
 * STATE DISCIPLINE: the spec establishes its own starting state (OFF) and the
 * afterAll ALWAYS leaves the account OFF -- seed-domains is the "religion
 * stripped" fixture other specs rely on. Fully serial: one live account.
 *
 * FIXTURE ASSUMPTION (unverified until the lead's first run): the domains
 * fixture has a Faith area (a `faith` user_domains row), which is why Faith
 * is reachable at /personal/faith once Deen Mode is ON.
 */
test.describe.configure({ mode: "serial" });

const RELIGIOUS = /\bdeen\b|\bfaith\b|prayer|qur.?an|sunnah|salah|adhkar|madhab/i;

function secretHeaders(): Record<string, string> {
  const secret = process.env.E2E_TEST_SECRET;
  if (!secret) throw new Error("E2E_TEST_SECRET not set -- see .env.local");
  return { "x-e2e-secret": secret };
}

async function clearIsha(request: APIRequestContext) {
  const res = await request.delete("/api/test/clear-prayer", { headers: secretHeaders(), data: { prayerName: "isha" } });
  if (!res.ok()) throw new Error(`clear-prayer failed: ${res.status()}`);
}

/** Flips the Settings -> Features -> Deen Mode switch through the real UI and waits for the server to have it. */
async function toggleInSettings(page: Page, request: APIRequestContext, to: boolean) {
  await page.goto("/settings");
  await dismissCheckinDialogIfPresent(page);
  const sw = page.getByRole("switch", { name: "Deen Mode" });
  await expect(sw).toBeVisible();
  if ((await sw.getAttribute("aria-checked")) === String(to)) return;
  await sw.click();
  await expect.poll(async () => (await getDeenState(request)).deenMode, { timeout: 15_000 }).toBe(to);
}

test.beforeAll(async ({ browser }, testInfo) => {
  const use = testInfo.project.use;
  const context = await browser.newContext({ baseURL: use.baseURL, storageState: use.storageState });
  try {
    await setDeenMode(context.request, false);
  } finally {
    await context.close();
  }
});

test.afterAll(async ({ browser }, testInfo) => {
  const use = testInfo.project.use;
  const context = await browser.newContext({ baseURL: use.baseURL, storageState: use.storageState });
  try {
    await clearIsha(context.request).catch(() => {});
    await setDeenMode(context.request, false);
  } finally {
    await context.close();
  }
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 }); // desktop sidebar + Settings section rail visible
});

test.describe("Deen Mode OFF (the default)", () => {
  test("navigation names nothing religious", async ({ page }) => {
    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);
    await expect(page.getByRole("link", { name: RELIGIOUS })).toHaveCount(0);
    await expect(page.getByRole("button", { name: RELIGIOUS })).toHaveCount(0);
  });

  test("Home shows nothing religious", async ({ page }) => {
    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);
    await expect(page.getByRole("heading").first()).toBeVisible(); // page rendered, not an error shell
    await expect(page.locator("body")).not.toContainText(RELIGIOUS);
  });

  test("Settings: no Prayer or Location section, Timezone kept, the switch is off", async ({ page }) => {
    await page.goto("/settings");
    await dismissCheckinDialogIfPresent(page);

    await expect(page.getByText("Prayer", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Location", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Calculation method")).toHaveCount(0);
    await expect(page.getByLabel("Asr madhab")).toHaveCount(0);
    // Timezone is app-wide and must stay editable (it used to live inside Location).
    await expect(page.getByText("Timezone", { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel("Timezone")).toBeVisible();
    // The only way in is this switch, and it starts off.
    await expect(page.getByRole("switch", { name: "Deen Mode" })).toHaveAttribute("aria-checked", "false");
  });

  test("/deen and /personal/faith redirect to Home", async ({ page }) => {
    for (const route of ["/deen", "/personal/faith"]) {
      await page.goto(route);
      await expect(page, route).toHaveURL(/\/$/);
    }
  });
});

test.describe("Deen Mode ON, then OFF again", () => {
  test("turning it on in Settings reveals Faith in Settings, nav and Home", async ({ page }) => {
    await toggleInSettings(page, page.request, true);

    await page.goto("/settings");
    await dismissCheckinDialogIfPresent(page);
    await expect(page.getByText("Prayer", { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel("Calculation method")).toBeVisible();
    await expect(page.getByText("Location", { exact: true }).first()).toBeVisible();

    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);
    // Faith is back in navigation and on Home.
    await expect(page.getByRole("link", { name: /faith|deen|personal/i }).first()).toBeVisible();
    await expect(page.getByText("Deen", { exact: true }).first()).toBeVisible();

    await page.goto("/personal/faith");
    await expect(page).toHaveURL(/\/personal\/faith/);
    await page.goto("/deen");
    await expect(page).toHaveURL(/\/deen/);
  });

  test("turning it off hides everything again but KEEPS the data; turning it on restores it", async ({ page }) => {
    const request = page.request;
    expect((await getDeenState(request)).deenMode).toBe(true);

    // Create real deen data while ON: a prayer row (start from a known state).
    await clearIsha(request);
    await page.goto("/deen");
    await dismissCheckinDialogIfPresent(page);
    const salahPanel = page.locator("[data-panel]").filter({ has: page.getByText("Salah", { exact: true }) });
    const ishaRow = salahPanel.locator("li", { hasText: "Isha" });
    await expect(ishaRow).toBeVisible();
    await ishaRow.getByRole("button", { name: "On-time" }).click();
    await expect.poll(async () => (await getDeenState(request)).prayerRows, { timeout: 15_000 }).toBeGreaterThan(0);
    const rowsWhileOn = (await getDeenState(request)).prayerRows;

    // OFF: UI stripped, data identical.
    await toggleInSettings(page, request, false);
    const afterOff = await getDeenState(request);
    expect(afterOff.deenMode).toBe(false);
    expect(afterOff.prayerRows).toBe(rowsWhileOn);

    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);
    await expect(page.locator("body")).not.toContainText(RELIGIOUS);
    await page.goto("/deen");
    await expect(page).toHaveURL(/\/$/);

    // ON again: the prayer is still marked, exactly as left.
    await toggleInSettings(page, request, true);
    expect((await getDeenState(request)).prayerRows).toBe(rowsWhileOn);
    await page.goto("/deen");
    await dismissCheckinDialogIfPresent(page);
    const restoredRow = page.locator("[data-panel]").filter({ has: page.getByText("Salah", { exact: true }) }).locator("li", { hasText: "Isha" });
    await expect(restoredRow.getByRole("button", { name: "On-time" }).locator("span")).toHaveClass(/text-accent-business/);

    // Leave no residue; afterAll restores OFF.
    await clearIsha(request);
  });
});
