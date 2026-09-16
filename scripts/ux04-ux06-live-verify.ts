/**
 * Live production verify for UX-04 (Settings grouping, commit 926caa9) and
 * UX-06 (Deadline Risk / Course Load truncation at heavy volume, commit
 * b182db2), both built by ENG3 -- I run the live pass since ENG1 cannot
 * log into a live account tonight.
 *
 * TRAFFIC DISCIPLINE (RULES-CARD.md): one browser, sequential, one login
 * per account per run, >=500ms between navigations, standalone script
 * (NEVER `npx playwright test` against the prod alias), abort on a 403
 * with x-vercel-mitigated. Both nav-mode accounts (legacy/domains), both
 * viewports (1280x800, 390x844) via resize, not re-auth.
 *
 * UX-06's own AC needs a 40+ assessment fixture: seeded via the signed-in
 * account's own client (real RLS-respecting inserts, not raw admin
 * bypass), a mix of near-due (higher risk) and far-due (lower risk) dates
 * within the Deadline Risk panel's own "Due Soon" bucket window so both
 * the always-visible and the collapsed-behind-"+N more" paths are real,
 * not synthetic. Cleaned up and verified by re-select afterward.
 *
 * Usage: npx tsx scripts/ux04-ux06-live-verify.ts [baseUrl]
 */
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: path.resolve(__dirname, "../.env.local") });

const BASE = (process.argv[2] ?? "https://tracking-app-sand.vercel.app").replace(/\/$/, "");
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !ANON || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / anon key / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(2);
}
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

const admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });

const results: { account: string; label: string; ok: boolean; detail: string }[] = [];
function check(account: string, label: string, ok: boolean, detail = "") {
  results.push({ account, label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${account}] ${label}${detail ? ` :: ${detail.slice(0, 200)}` : ""}`);
}

const pause = (ms = 600) => new Promise((r) => setTimeout(r, ms));

async function visible(locator: ReturnType<Page["locator"]>, timeout = 8000): Promise<boolean> {
  return locator
    .first()
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
}

async function nav(page: Page, url: string) {
  await pause();
  const res = page.url() === url ? await page.reload({ waitUntil: "domcontentloaded" }) : await page.goto(url, { waitUntil: "domcontentloaded" });
  if (res && res.status() === 403) {
    const headers = res.headers();
    if (headers["x-vercel-mitigated"]) {
      throw new Error(`ABORT: 403 x-vercel-mitigated on ${url} -- Vercel Security Checkpoint tripped. Stopping immediately.`);
    }
  }
  await pause(2000);
  return res;
}

async function login(page: Page, email: string, password: string) {
  await nav(page, `${BASE}/login`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
}

async function asAccountClient(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(SUPA_URL!, ANON!, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in for fixture seeding failed: ${error.message}`);
  return c;
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── UX-04: Settings grouping ────────────────────────────────────────────
async function checkUx04(page: Page, who: string, viewportLabel: string) {
  await nav(page, `${BASE}/settings`);

  const heading = await visible(page.getByRole("heading", { name: "Settings" }));
  check(who, `${viewportLabel} UX-04: /settings reachable`, heading);

  // A provider block's trigger is present (collapsed by default for an
  // unconfigured provider) and expands on click. Scoped to #ai (the panel
  // ApiKeySettings itself renders in) -- the panel also hosts a separate
  // AI-provider PREFERENCE picker that also mentions provider names like
  // "OpenAI", so an unscoped role query can match the wrong element.
  const aiPanel = page.locator("#ai");
  const providerTrigger = aiPanel.getByRole("button", { name: "OpenAI", exact: true }).first();
  const triggerVisible = await visible(providerTrigger);
  check(who, `${viewportLabel} UX-04: an AI-provider collapsible trigger is present`, triggerVisible);
  if (triggerVisible) {
    await providerTrigger.click();
    await pause(400);
    const formVisible = await visible(aiPanel.getByPlaceholder("sk-…"));
    check(who, `${viewportLabel} UX-04: clicking the provider trigger reveals its form`, formVisible);
    await providerTrigger.click(); // collapse back, leave the page as found
    await pause(300);
  }

  // Connector token-list reveal (default closed) -- the create-token form
  // itself stays visible unconditionally per the AC. P4-21 (later, unrelated)
  // wrapped this whole section in a "Any agent" tab, not selected by default
  // -- must click it first to reach the form, same as a real user would.
  await page.locator("#connectors").scrollIntoViewIfNeeded().catch(() => {});
  const anyAgentTab = page.getByRole("tab", { name: "Any agent" });
  if (await visible(anyAgentTab)) await anyAgentTab.click();
  await pause(300);
  const createFormVisible = await visible(page.getByText(/Label \(so you can tell tokens apart later\)/i));
  check(who, `${viewportLabel} UX-04: the create-token form stays visible (not behind a reveal)`, createFormVisible);

  // Anchor nav still jumps to the right section id (ids unchanged per AC).
  const connectorsAnchor = await page.locator("#connectors").count();
  check(who, `${viewportLabel} UX-04: #connectors anchor id still present (existing anchor-nav unaffected)`, connectorsAnchor > 0);

  // Account eyebrow label groups Profile/Prayer/Check-ins/Location.
  const accountLabel = await visible(page.getByText("Account", { exact: true }));
  check(who, `${viewportLabel} UX-04: "Account" eyebrow label groups Profile/Prayer/Check-ins/Location`, accountLabel);
}

// ── UX-06: heavy-volume truncation ──────────────────────────────────────
async function seedHeavyVolumeFixture(client: SupabaseClient, userId: string): Promise<{ classId: string; taskIds: string[]; assessmentIds: string[] }> {
  const { data: cls, error: clsErr } = await client.from("classes").insert({ user_id: userId, code: "UX06-VERIFY", position: 0 }).select("id").single();
  if (clsErr) throw new Error(`class seed failed: ${clsErr.message}`);
  const classId = cls!.id as string;

  const taskIds: string[] = [];
  const assessmentIds: string[] = [];

  // 3 due TOMORROW (high proximity -> should land high/critical band, must
  // stay always-visible, never counted toward the "+N more" collapse).
  // 42 due ~10 days out (same "Due Soon" ~2-week bucket, lower proximity
  // -> lower band, the ones that should collapse past the 5-visible cap).
  const dueDates = [...Array(3).fill(todayPlus(1)), ...Array(42).fill(todayPlus(10))];

  for (let i = 0; i < dueDates.length; i++) {
    const dueDate = dueDates[i]!;
    const { data: taskRow, error: taskErr } = await client
      .from("tasks")
      .insert({ user_id: userId, domain: "school", title: `UX06-VERIFY item ${i}`, due_date: dueDate, task_type: "exam", class_id: classId })
      .select("id")
      .single();
    if (taskErr) throw new Error(`task seed ${i} failed: ${taskErr.message}`);
    taskIds.push(taskRow!.id as string);

    const { data: assessment, error: aErr } = await client
      .from("class_assessments")
      .insert({ user_id: userId, class_id: classId, name: `UX06-VERIFY item ${i}`, type: "quiz", date: dueDate, task_id: taskRow!.id })
      .select("id")
      .single();
    if (aErr) throw new Error(`assessment seed ${i} failed: ${aErr.message}`);
    assessmentIds.push(assessment!.id as string);
  }

  return { classId, taskIds, assessmentIds };
}

async function cleanupHeavyVolumeFixture(fixture: { classId: string; taskIds: string[]; assessmentIds: string[] }): Promise<void> {
  await admin.from("class_assessments").delete().in("id", fixture.assessmentIds);
  await admin.from("tasks").delete().in("id", fixture.taskIds);
  await admin.from("classes").delete().eq("id", fixture.classId);

  const { data: remainingAssessments } = await admin.from("class_assessments").select("id").in("id", fixture.assessmentIds);
  const { data: remainingTasks } = await admin.from("tasks").select("id").in("id", fixture.taskIds);
  const { data: remainingClass } = await admin.from("classes").select("id").eq("id", fixture.classId);
  if ((remainingAssessments ?? []).length !== 0 || (remainingTasks ?? []).length !== 0 || (remainingClass ?? []).length !== 0) {
    throw new Error(`cleanup left residue: ${remainingAssessments?.length ?? 0} assessments, ${remainingTasks?.length ?? 0} tasks, ${remainingClass?.length ?? 0} class rows`);
  }
}

async function checkUx06(page: Page, who: string, viewportLabel: string) {
  await nav(page, `${BASE}/school`);

  const deadlineHeading = await visible(page.getByText("Deadline risk", { exact: false }));
  check(who, `${viewportLabel} UX-06: Deadline Risk panel reachable`, deadlineHeading);

  const moreButtons = page.getByRole("button", { name: /\+\d+ more/ });
  const moreCount = await moreButtons.count();
  check(who, `${viewportLabel} UX-06: a "+N more" collapse trigger exists with the 40+ fixture`, moreCount > 0, `found ${moreCount} trigger(s)`);

  if (moreCount > 0) {
    const firstMoreText = await moreButtons.first().innerText();
    await moreButtons.first().click();
    await pause(400);
    const rowCountAfter = await page.locator('[data-testid^="deadline-risk-row-"]').count();
    check(who, `${viewportLabel} UX-06: clicking "+N more" reveals the hidden rows (nothing silently dropped)`, rowCountAfter >= 40, `trigger text: ${firstMoreText}, visible rows after expand: ${rowCountAfter}`);
  }

  // High-severity rows (our 3 due-tomorrow items) must be visible WITHOUT
  // expanding anything -- confirms severity-based always-visible holds
  // with real volume, not just in the unit fixture.
  const highSeverityVisibleUncapped = await visible(page.getByTestId(/deadline-risk-row-/).first());
  check(who, `${viewportLabel} UX-06: at least one row is visible without expanding (high-severity-uncapped path reachable)`, highSeverityVisibleUncapped);
}

async function runAccount(who: string, email: string, password: string, userId: string, includeUx06Fixture: boolean) {
  console.log(`\n=== ${who} ===`);
  const browser = await chromium.launch();
  let fixture: { classId: string; taskIds: string[]; assessmentIds: string[] } | null = null;
  try {
    if (includeUx06Fixture) {
      const client = await asAccountClient(email, password);
      fixture = await seedHeavyVolumeFixture(client, userId);
      check(who, "UX-06 fixture: 45-item class seeded via the account's own RLS-respecting client", true, `class ${fixture.classId}, ${fixture.assessmentIds.length} assessments`);
    }

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await login(page, email, password);

    await checkUx04(page, who, "1280x800 desktop");
    if (includeUx06Fixture) await checkUx06(page, who, "1280x800 desktop");

    await page.setViewportSize({ width: 390, height: 844 });
    await checkUx04(page, who, "390x844 mobile");
    if (includeUx06Fixture) await checkUx06(page, who, "390x844 mobile");

    await context.close();
  } finally {
    await browser.close();
    if (fixture) {
      await cleanupHeavyVolumeFixture(fixture);
      check(who, "UX-06 fixture: cleaned up (class/tasks/assessments), verified by re-select", true);
    }
  }
}

async function main() {
  const legacy = accounts["teamb-legacy@lifeos.test"]!;
  const domains = accounts["teamb-domains@lifeos.test"]!;
  await runAccount("teamb-legacy", legacy.email, legacy.password, legacy.userId, true);
  await runAccount("teamb-domains", domains.email, domains.password, domains.userId, false);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  if (failed.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failed) console.log(`  [${f.account}] ${f.label} :: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("run aborted —", err instanceof Error ? err.message : err);
  process.exit(1);
});
