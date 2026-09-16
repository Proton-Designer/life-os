/**
 * Live production verification of WIDGET-02 (deployed ee068a8), per Opus
 * Lead's explicit checklist: both nav modes, 1280 and 390, on >=4 domain
 * pages -- hide+save+reload persists; reorder holds; Cancel discards;
 * hide-everything shows the empty state with a way back; unhiding proves
 * the widget's underlying DATA was never touched while hidden (checked
 * directly against the database via the service-role client, not just
 * re-observed in the UI).
 *
 * Traffic discipline: one browser, sequential, one login per account,
 * chromium directly (never `npx playwright test` against prod).
 *
 * Usage: npx tsx scripts/widget02-verify.ts [baseUrl]
 */
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: path.resolve(__dirname, "../.env.local") });

const BASE = (process.argv[2] ?? "https://tracking-app-sand.vercel.app").replace(/\/$/, "");
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPA_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(2);
}
const admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });

const accounts = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../.claude/overnight/run-20260915-0011/teamb-accounts.json"), "utf8")) as Record<
  string,
  { email: string; password: string; userId: string; mode: string }
>;
for (const a of Object.values(accounts)) {
  if (!/@lifeos\.test$/.test(a.email)) {
    console.error(`Refusing to run against a non-test account: ${a.email}`);
    process.exit(2);
  }
}

const results: { account: string; label: string; ok: boolean; detail: string }[] = [];
function check(account: string, label: string, ok: boolean, detail = "") {
  results.push({ account, label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${account}] ${label}${detail ? ` — ${detail}` : ""}`);
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
  await pause(2000); // hydration buffer
  return res;
}

async function login(page: Page, email: string, password: string) {
  await nav(page, `${BASE}/login`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
}

async function textVisible(page: Page, text: string): Promise<boolean> {
  return page
    .getByText(text, { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 4000 })
    .then(() => true)
    .catch(() => false);
}

async function openManager(page: Page) {
  const btn = page.getByRole("button", { name: "Manage widgets on this page" });
  await btn.first().waitFor({ state: "visible", timeout: 10000 });
  await btn.first().click();
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 8000 });
}

async function closeManager(page: Page, action: "save" | "cancel") {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: action === "save" ? "Save" : "Cancel" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
  await pause(1500);
}

function rowFor(page: Page, label: string) {
  return page.getByRole("dialog").getByText(label, { exact: true }).locator("..").locator("..");
}

async function toggleHidden(page: Page, label: string) {
  await rowFor(page, label).getByRole("switch").click();
}

async function moveUp(page: Page, label: string) {
  await rowFor(page, label).getByRole("button", { name: `Move ${label} up` }).click();
}

/** Every item's label, in the dialog's own current draft order. Waits for the list to actually render (async fetch inside the dialog) before reading -- evaluateAll itself does not auto-wait the way locator actions do. */
async function allItemLabels(page: Page): Promise<string[]> {
  const dialog = page.getByRole("dialog");
  await dialog.locator("li").first().waitFor({ state: "visible", timeout: 8000 });
  const raw = await dialog.locator("li").evaluateAll((lis) => lis.map((li) => li.querySelector("p")?.textContent?.trim() ?? ""));
  return raw.filter((t) => t.length > 0);
}

interface PageCheck {
  domainKey: string;
  path: string;
  widgetLabel: string;
  partnerLabel: string; // a second widget on the same page, for the reorder check
  table: string;
  countRow: (userId: string) => Promise<number>;
}

async function countRows(table: string, userId: string, extra?: (q: any) => any): Promise<number> {
  let q = admin.from(table).select("*", { count: "exact", head: true }).eq("user_id", userId);
  if (extra) q = extra(q);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

async function runFullPageCheck(page: Page, account: string, userId: string, pc: PageCheck) {
  const label = `${pc.domainKey}:${pc.widgetLabel}`;
  await nav(page, `${BASE}${pc.path}`);

  const startVisible = await textVisible(page, pc.widgetLabel);
  check(account, `${label} — starts visible`, startVisible);
  if (!startVisible) return;

  const rowsBefore = await pc.countRow(userId);

  // 1. Hide + Save -> persists across a reload.
  await openManager(page);
  await toggleHidden(page, pc.widgetLabel);
  await closeManager(page, "save");
  check(account, `${label} — hidden immediately after Save`, !(await textVisible(page, pc.widgetLabel)));
  await nav(page, `${BASE}${pc.path}`);
  check(account, `${label} — RELOAD: still hidden after fresh navigation`, !(await textVisible(page, pc.widgetLabel)));

  const rowsWhileHidden = await pc.countRow(userId);
  check(account, `${label} — DATA INTACT while hidden (row count unchanged: ${rowsBefore} -> ${rowsWhileHidden})`, rowsBefore === rowsWhileHidden);

  // 2. Re-open, un-hide in the draft, Cancel -> must not persist.
  await openManager(page);
  await toggleHidden(page, pc.widgetLabel);
  await closeManager(page, "cancel");
  check(account, `${label} — CANCEL: still hidden immediately after Cancel`, !(await textVisible(page, pc.widgetLabel)));
  await nav(page, `${BASE}${pc.path}`);
  check(account, `${label} — CANCEL: still hidden after fresh navigation (cancel never wrote)`, !(await textVisible(page, pc.widgetLabel)));

  // 3. Re-open, un-hide for real, Save -> restored + data still correct.
  await openManager(page);
  await toggleHidden(page, pc.widgetLabel);
  await closeManager(page, "save");
  check(account, `${label} — restored to visible after the real Save`, await textVisible(page, pc.widgetLabel));
  await nav(page, `${BASE}${pc.path}`);
  const stillVisibleAfterReload = await textVisible(page, pc.widgetLabel);
  check(account, `${label} — RELOAD: restored and persists`, stillVisibleAfterReload);
  const rowsAfterUnhide = await pc.countRow(userId);
  check(account, `${label} — DATA INTACT after unhide (row count unchanged: ${rowsBefore} -> ${rowsAfterUnhide})`, rowsBefore === rowsAfterUnhide);

  // 4. Reorder: move the partner widget up by ONE slot (the button's real
  // semantics -- a single click swaps with the immediate predecessor, it
  // does not jump to the global front of a 7-item list), Save, confirm the
  // dialog's own draft order reflects the swap after a reload (proves the
  // saved `position` values actually round-trip), then attempt a second
  // reorder and Cancel it, confirming the un-saved attempt never persists.
  // Checked RELATIVELY (did the partner's index decrease by exactly one,
  // overtaking whoever was immediately ahead of it) rather than asserting
  // "is now first" -- correct regardless of how many other widgets a page
  // has ahead of the pair being tested.
  await openManager(page);
  const orderBefore = await allItemLabels(page);
  const partnerIndexBefore = orderBefore.indexOf(pc.partnerLabel);
  const setupOk = partnerIndexBefore > 0;
  check(account, `${label} — REORDER setup: partner is present and not already first`, setupOk, `index ${partnerIndexBefore} in [${orderBefore.join(", ")}]`);
  if (!setupOk) {
    // A stale fixture from a prior run left the partner already at index 0
    // -- clicking "Move up" would hit a disabled button and hang. Bail out
    // of the reorder sub-check rather than timing out; the page/domain's
    // OTHER checks (hide/save/reload/cancel/data-intact) already ran and
    // are unaffected by this.
    await closeManager(page, "cancel");
    return;
  }
  await moveUp(page, pc.partnerLabel);
  await closeManager(page, "save");
  await openManager(page);
  const orderAfterSavedReorder = await allItemLabels(page);
  const partnerIndexAfterSave = orderAfterSavedReorder.indexOf(pc.partnerLabel);
  check(
    account,
    `${label} — REORDER: partner moved up exactly one slot and SAVED, persists in the dialog's own order`,
    partnerIndexAfterSave === partnerIndexBefore - 1,
    `was ${partnerIndexBefore}, now ${partnerIndexAfterSave}`
  );
  await closeManager(page, "cancel");

  // Reorder again (move it back down), this time Cancel -> the saved
  // (post-first-reorder) order must survive unchanged.
  await openManager(page);
  await rowFor(page, pc.partnerLabel).getByRole("button", { name: `Move ${pc.partnerLabel} down` }).click();
  await closeManager(page, "cancel");
  await openManager(page);
  const orderAfterCancelledReorder = await allItemLabels(page);
  const partnerIndexAfterCancel = orderAfterCancelledReorder.indexOf(pc.partnerLabel);
  check(
    account,
    `${label} — REORDER+CANCEL: an un-saved reorder attempt never persists`,
    partnerIndexAfterCancel === partnerIndexAfterSave,
    `expected still at ${partnerIndexAfterSave}, got ${partnerIndexAfterCancel}`
  );

  // Restore original order for a clean fixture. Current index is LOWER
  // than the original -> the item needs to move DOWN (index increases)
  // to get back; current HIGHER -> needs to move UP.
  if (partnerIndexAfterCancel < partnerIndexBefore) {
    await rowFor(page, pc.partnerLabel).getByRole("button", { name: `Move ${pc.partnerLabel} down` }).click();
  } else if (partnerIndexAfterCancel > partnerIndexBefore) {
    await rowFor(page, pc.partnerLabel).getByRole("button", { name: `Move ${pc.partnerLabel} up` }).click();
  }
  await closeManager(page, "save");
}

async function runHideEverythingCheck(page: Page, account: string, domainKey: string, pagePath: string, dialogLabel: string, pageMarkerText: string) {
  const label = `${domainKey}:hide-everything`;
  await nav(page, `${BASE}${pagePath}`);
  const startVisible = await textVisible(page, pageMarkerText);
  check(account, `${label} — fixture starts visible`, startVisible);
  if (!startVisible) return;

  await openManager(page);
  await toggleHidden(page, dialogLabel);
  await closeManager(page, "save");
  await nav(page, `${BASE}${pagePath}`);

  // Not an exact match: the message text is a plain text node sharing its
  // containing <div> with the "way back" button (self-mastery-library.tsx/
  // page.tsx's own markup), so the div's own full text also includes the
  // button's label -- a substring match is the correct check here.
  const emptyStateVisible = await page
    .getByText("Every widget on this page is hidden.", { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  check(account, `${label} — empty state message shown`, emptyStateVisible);
  const wayBackVisible = await page
    .getByRole("button", { name: "Manage widgets" })
    .first()
    .waitFor({ state: "visible", timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  check(account, `${label} — empty state offers a way back into the manager`, wayBackVisible);

  // Restore.
  await openManager(page);
  await toggleHidden(page, dialogLabel);
  await closeManager(page, "save");
  await nav(page, `${BASE}${pagePath}`);
  check(account, `${label} — restored to visible after cleanup`, await textVisible(page, pageMarkerText));
}

async function mobileReachabilityCheck(page: Page, account: string, domainKey: string, pagePath: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await nav(page, `${BASE}${pagePath}`);
  const iconVisible = await page
    .getByRole("button", { name: "Manage widgets on this page" })
    .first()
    .waitFor({ state: "visible", timeout: 6000 })
    .then(() => true)
    .catch(() => false);
  check(account, `${domainKey}:mobile — manager icon reachable at 390x844`, iconVisible);
  if (!iconVisible) return;
  await openManager(page);
  const moveVisible = await page
    .getByRole("dialog")
    .getByRole("button", { name: /Move .* (up|down)/ })
    .first()
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check(account, `${domainKey}:mobile — Move up/down buttons present (touch reorder path)`, moveVisible);
  const switchVisible = await page
    .getByRole("dialog")
    .getByRole("switch")
    .first()
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check(account, `${domainKey}:mobile — visibility switch present`, switchVisible);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await pause(1000);
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function runAccount(
  browser: Browser,
  name: string,
  email: string,
  password: string,
  userId: string,
  checks: PageCheck[],
  hideEverything?: { domainKey: string; path: string; dialogLabel: string; pageMarkerText: string }
) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await login(page, email, password);
    for (const pc of checks) {
      await runFullPageCheck(page, name, userId, pc);
    }
    if (hideEverything) {
      await runHideEverythingCheck(page, name, hideEverything.domainKey, hideEverything.path, hideEverything.dialogLabel, hideEverything.pageMarkerText);
    }
    // Mobile pass -- reuse the same context/page, resize, no re-login.
    for (const pc of checks) {
      await mobileReachabilityCheck(page, name, pc.domainKey, pc.path);
    }
  } catch (err) {
    check(name, "run aborted", false, err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.message.startsWith("ABORT:")) throw err;
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const onlyLegacy = process.env.ONLY_LEGACY === "1";
  const onlyHabits = process.env.ONLY_HABITS === "1";
  try {
    const legacy = accounts["teamb-legacy@lifeos.test"]!;
    const domains = accounts["teamb-domains@lifeos.test"]!;

    if (onlyHabits) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await login(page, legacy.email, legacy.password);
      await runHideEverythingCheck(page, "teamb-legacy", "habits", "/habits", "Identity habits", "Your identities");
      await page.close();
      return;
    }

    // teamb-legacy: School (deadline_risk / course_load) + Business (kill_list / weekly_goal).
    await runAccount(browser, "teamb-legacy", legacy.email, legacy.password, legacy.userId, [
      {
        domainKey: "school",
        path: "/school",
        widgetLabel: "Deadline risk",
        partnerLabel: "Course load",
        table: "class_assessments",
        countRow: (userId) => countRows("class_assessments", userId),
      },
      {
        domainKey: "business",
        path: "/business",
        widgetLabel: "Today's kill list",
        partnerLabel: "This week's goal",
        table: "kill_list_items",
        countRow: (userId) => countRows("kill_list_items", userId),
      },
    ], { domainKey: "habits", path: "/habits", dialogLabel: "Identity habits", pageMarkerText: "Your identities" });

    // ONLY_LEGACY=1 conserves traffic for a targeted re-run of a fix --
    // teamb-domains already passed every check in the full run this
    // script's own board Log records.
    if (onlyLegacy) return;

    // teamb-domains: Deen (salah / quran) + Fitness (daily_log / this_week).
    await runAccount(browser, "teamb-domains", domains.email, domains.password, domains.userId, [
      {
        domainKey: "deen",
        path: "/deen",
        widgetLabel: "Salah",
        partnerLabel: "Qur'an",
        table: "prayers",
        countRow: (userId) => countRows("prayers", userId),
      },
      {
        domainKey: "fitness",
        path: "/fitness",
        widgetLabel: "Daily Log",
        partnerLabel: "This week",
        table: "workout_sessions",
        countRow: (userId) => countRows("workout_sessions", userId),
      },
    ]);
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
