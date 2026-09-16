/**
 * Live production verification of WIDGET-02 (widget manager UI), per that
 * task's own acceptance criteria: "Verified live on prod by a different
 * agent... including a reload-after-save check and a cancel-discards
 * check." Standalone script (chromium directly, never `npx playwright
 * test` against prod), one browser, sequential, teamb-legacy only (one
 * domain -- school -- is representative; the wiring pattern is identical
 * across all 11 registered pages, already confirmed by code review).
 *
 * Usage: npx tsx scripts/widget02-verify.ts [baseUrl]
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, "../.env.local") });

const BASE = (process.argv[2] ?? "https://tracking-app-sand.vercel.app").replace(/\/$/, "");
const EMAIL = "teamb-legacy@lifeos.test";
const PASSWORD = "TeamB-UeCXqORebyoYQQnP!";

const results: { label: string; ok: boolean; detail: string }[] = [];
function check(label: string, ok: boolean, detail = "") {
  results.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`);
}
function pause(ms = 600) {
  return new Promise((r) => setTimeout(r, ms));
}

async function nav(page: Page, url: string) {
  await pause();
  const res = page.url() === url ? await page.reload({ waitUntil: "domcontentloaded" }) : await page.goto(url, { waitUntil: "domcontentloaded" });
  if (res && res.status() === 403 && res.headers()["x-vercel-mitigated"]) {
    throw new Error(`ABORT: 403 x-vercel-mitigated on ${url}. Stopping immediately.`);
  }
  await pause(2000); // hydration buffer -- see p2-p3-verify-sweep.ts's own header on why
  return res;
}

async function login(page: Page) {
  await nav(page, `${BASE}/login`);
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
}

async function deadlineRiskVisible(page: Page): Promise<boolean> {
  return page
    .getByText("Deadline risk", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 4000 })
    .then(() => true)
    .catch(() => false);
}

async function openManager(page: Page) {
  await page.getByRole("button", { name: "Manage widgets on this page" }).click();
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 8000 });
}

async function toggleAndClose(page: Page, label: string, action: "save" | "cancel") {
  const dialog = page.getByRole("dialog");
  const row = dialog.getByText("Deadline risk", { exact: true }).locator("..").locator("..");
  await row.getByRole("switch").click();
  if (action === "save") {
    await dialog.getByRole("button", { name: "Save" }).click();
  } else {
    await dialog.getByRole("button", { name: "Cancel" }).click();
  }
  await dialog.waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
  await pause(1500);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await login(page);
    await nav(page, `${BASE}/school`);

    const initiallyVisible = await deadlineRiskVisible(page);
    check("Deadline risk starts visible", initiallyVisible);
    if (!initiallyVisible) throw new Error("Fixture assumption failed -- Deadline risk not visible at start, aborting to avoid corrupting state.");

    if (process.env.WIDGET02_DEBUG) {
      const ariaButtons = await page.locator("button[aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      console.log("DEBUG aria-label buttons on /school:", JSON.stringify(ariaButtons));
    }

    // 1. Hide + Save -> hidden immediately, and survives a reload.
    await openManager(page);
    await toggleAndClose(page, "Deadline risk", "save");
    check("hidden immediately after Save (no reload yet)", !(await deadlineRiskVisible(page)));
    await nav(page, `${BASE}/school`);
    check("RELOAD-AFTER-SAVE: still hidden after a fresh navigation", !(await deadlineRiskVisible(page)));

    // 2. Re-open, un-hide in the draft, Cancel -> must NOT persist (still hidden).
    await openManager(page);
    await toggleAndClose(page, "Deadline risk", "cancel");
    check("CANCEL-DISCARDS: still hidden immediately after Cancel (draft thrown away)", !(await deadlineRiskVisible(page)));
    await nav(page, `${BASE}/school`);
    check("CANCEL-DISCARDS: still hidden after a fresh navigation (cancel never wrote)", !(await deadlineRiskVisible(page)));

    // 3. Re-open, un-hide for real, Save -> restored, survives a reload. Always run, even if an earlier check failed, to leave the fixture clean.
    await openManager(page);
    await toggleAndClose(page, "Deadline risk", "save");
    check("restored to visible immediately after the real Save", await deadlineRiskVisible(page));
    await nav(page, `${BASE}/school`);
    check("RELOAD-AFTER-SAVE: restored and persists after a fresh navigation", await deadlineRiskVisible(page));

    // 4. Mobile reachability: the header icon and Move buttons exist at 390.
    await page.setViewportSize({ width: 390, height: 844 });
    await pause(1000);
    const iconVisibleMobile = await page
      .getByRole("button", { name: "Manage widgets on this page" })
      .waitFor({ state: "visible", timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    check("manager icon reachable at 390x844", iconVisibleMobile);
    if (iconVisibleMobile) {
      await openManager(page);
      const moveButtonsVisible = await page
        .getByRole("dialog")
        .getByRole("button", { name: /Move .* (up|down)/ })
        .first()
        .waitFor({ state: "visible", timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      check("Move up/down buttons present at 390x844 (touch reorder path)", moveButtonsVisible);
      await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("ABORTED:", err.message);
  process.exit(2);
});
