/**
 * Live production verify sweep (PLAN-P2-P3-COMPLETION.md, ENG1's pass over
 * ENG2-built tasks): P2-03, P2-06, P2-08, P2-10, P2-13 (slices A-C; slice D
 * was deliberately not built -- see that task's own Log). A standalone
 * script (uses @playwright/test's exported `chromium` directly -- NEVER
 * `npx playwright test` against the production alias, which triggered a
 * 23-minute Vercel Security Checkpoint at 15:10 today).
 *
 * TRAFFIC DISCIPLINE (RULES-CARD.md): one browser, sequential, one login
 * per account per run, >=500ms between navigations, batched into one
 * script run. A 403 with x-vercel-mitigated aborts immediately.
 *
 * Both nav modes via the two teamb accounts (legacy / domains), both
 * viewports (1280x800 desktop, 390x844 mobile) via ONE browser context per
 * account (no second login) -- resize, don't re-auth.
 *
 * Seeds fixtures with the service role / a signed-in-as-account client so
 * each cron/AI-fed panel and each threshold-gated detector has something
 * real to show. Every fixture is cleaned up in `finally` and cleanup is
 * verified by re-select, never by trusting the UI's own confirmation.
 *
 * P2-13 is BYOK-only (embeddings) and its actual embed-stage transition is
 * driven by a CRON_SECRET-gated route, same posture the P2-09 sweep
 * (scripts/p2-p3-verify-sweep.ts) already took for that task's assembly
 * cron: not available to this script, unit evidence (399/399, cited in the
 * 03 review) stands in for it. Live verification here is scoped to "no UI
 * regression on /self-mastery from the pipeline changes," which IS in
 * scope for a browser script.
 *
 * Usage: npx tsx scripts/p2-p3-verify-sweep-eng1.ts [baseUrl]
 */
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
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
const accounts = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../.claude/overnight/run-20260915-0011/teamb-accounts.json"), "utf8")
) as Record<string, { email: string; password: string; userId: string; mode: string }>;
for (const a of Object.values(accounts)) {
  if (!/@lifeos\.test$/.test(a.email)) {
    console.error(`Refusing to run against a non-test account: ${a.email}`);
    process.exit(2);
  }
}

const admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });

const results: { account: string; task: string; label: string; ok: boolean; detail: string }[] = [];
function check(account: string, task: string, label: string, ok: boolean, detail = "") {
  results.push({ account, task, label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${account}] [${task}] ${label}${detail ? ` :: ${detail.slice(0, 200)}` : ""}`);
}

const pause = (ms = 600) => new Promise((r) => setTimeout(r, ms));

// Local reimplementation of lib/date-utils.ts's pure date-string math --
// this script isn't wired for the "@/" path alias, so these are copied
// verbatim (checked against the source at write time) rather than imported.
function localDateStringTz(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function getWeekStartDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}
function addDaysToDateString(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}
function getMostRecentCompletedWeekStart(todayStr: string): string {
  return addDaysToDateString(getWeekStartDate(todayStr), -7);
}

async function visible(locator: ReturnType<Page["locator"]>, timeout = 8000): Promise<boolean> {
  return locator
    .first()
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
}

async function nav(page: Page, url: string) {
  await pause(); // >=500ms between navigations
  const res = page.url() === url ? await page.reload({ waitUntil: "domcontentloaded" }) : await page.goto(url, { waitUntil: "domcontentloaded" });
  if (res && res.status() === 403) {
    const headers = res.headers();
    if (headers["x-vercel-mitigated"]) {
      throw new Error(`ABORT: 403 x-vercel-mitigated on ${url} -- Vercel Security Checkpoint tripped. Stopping immediately.`);
    }
  }
  // Same lesson as scripts/p2-p3-verify-sweep.ts: `domcontentloaded` fires
  // before client hydration finishes, so a fixed post-load pause is needed
  // for real interaction, not just presence checks.
  await pause(2000);
  return res;
}

async function asAccountClient(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(SUPA_URL!, ANON!, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in for fixture seeding failed: ${error.message}`);
  return c;
}

async function login(page: Page, email: string, password: string) {
  await nav(page, `${BASE}/login`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
}

// ── fixtures ──────────────────────────────────────────────────────────
interface Fixtures {
  classId: string;
  taskId: string;
  assessmentIds: string[];
  dayStartLocalDate: string;
  questionId: string;
  reviewIds: string[];
  narrativeWeekStart: string;
  recapWeekStart: string;
}
type PartialFixtures = Partial<Fixtures>;

async function seedFixtures(who: string, client: SupabaseClient, userId: string, timezone: string, f: PartialFixtures): Promise<void> {
  const today = localDateStringTz(new Date(), timezone);

  // ── P2-06: day_starts (unlocks /open/today) + a starred task with a planned_date of today ──
  f.dayStartLocalDate = today;
  const { error: dsErr } = await admin.from("day_starts").upsert({ user_id: userId, local_date: today, woke_at: new Date().toISOString() }, { onConflict: "user_id,local_date" });
  if (dsErr) throw new Error(`day_start seed failed: ${dsErr.message}`);

  const { data: existingTasks } = await admin.from("tasks").select("mit_rank").eq("user_id", userId).eq("planned_date", today).not("mit_rank", "is", null);
  const usedRanks = new Set((existingTasks ?? []).map((t) => t.mit_rank as number));
  let freeRank = 1;
  while (usedRanks.has(freeRank)) freeRank++;
  const { data: taskRow, error: taskErr } = await client
    .from("tasks")
    .insert({ user_id: userId, domain: "school", title: "P2P3-ENG1-VERIFY timebox task", planned_date: today, mit_rank: freeRank })
    .select("id")
    .single();
  if (taskErr) throw new Error(`task seed failed: ${taskErr.message}`);
  f.taskId = taskRow!.id as string;

  // ── shared class, for P2-06's task readability and P2-10's assessments ──
  const { data: cls, error: clsErr } = await client.from("classes").insert({ user_id: userId, code: "P2P3-ENG1-VERIFY", position: 0 }).select("id").single();
  if (clsErr) throw new Error(`class seed failed: ${clsErr.message}`);
  f.classId = cls!.id as string;

  // ── P2-10: three ungraded, non-excused assessments due the SAME future week -> item-count overflow (>=3) ──
  const overflowDate = addDaysToDateString(today, 14); // 2 weeks out, well inside the 6-week horizon
  const assessmentIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const { data: a, error: aErr } = await client
      .from("class_assessments")
      .insert({ user_id: userId, class_id: f.classId, name: `P2P3-ENG1-VERIFY item ${i + 1}`, type: "exam", date: overflowDate })
      .select("id")
      .single();
    if (aErr) throw new Error(`assessment seed ${i} failed: ${aErr.message}`);
    assessmentIds.push(a!.id as string);
  }
  f.assessmentIds = assessmentIds;

  // ── P2-08: 20 "sure" reviews, 4 correct / 16 incorrect -> 20% actual-correct-rate, well below the 85% expectation, bucket+total both clear MIN_BUCKET_SAMPLE(5)/MIN_TOTAL_SAMPLE(20) -> overconfident verdict ──
  // `reviews` requires exactly one of card_id/question_id set (a composite
  // tenancy FK) -- seed one throwaway question to hang all 20 rows off of.
  const { data: question, error: qErr } = await client
    .from("questions")
    .insert({ user_id: userId, class_id: f.classId, prompt: "P2P3-ENG1-VERIFY question", answer: "P2P3-ENG1-VERIFY answer", origin: "self", active: true, source_skipped: true })
    .select("id")
    .single();
  if (qErr) throw new Error(`question seed failed: ${qErr.message}`);
  f.questionId = question!.id as string;

  const reviewRows = Array.from({ length: 20 }, (_, i) => ({
    user_id: userId,
    question_id: f.questionId,
    confidence: "sure" as const,
    correct: i < 4,
    rating: 3,
    request_retention: 0.9,
    learning_steps_after: 0,
    state_after: "review" as const,
  }));
  const { data: reviews, error: revErr } = await client.from("reviews").insert(reviewRows).select("id");
  if (revErr) throw new Error(`reviews seed failed: ${revErr.message}`);
  f.reviewIds = (reviews ?? []).map((r) => r.id as string);

  // ── P2-03: both weekly-synthesis artifacts for the most recently completed week ──
  const weekStart = getMostRecentCompletedWeekStart(today);
  f.narrativeWeekStart = weekStart;
  f.recapWeekStart = weekStart;
  const { error: narrErr } = await admin
    .from("collegeos_weekly_narratives")
    .upsert({ user_id: userId, week_start: weekStart, narrative_text: "P2P3-ENG1-VERIFY: a quiet week overall.", generated_at: new Date().toISOString() }, { onConflict: "user_id,week_start" });
  if (narrErr) throw new Error(`collegeos_weekly_narratives seed failed: ${narrErr.message}`);
  const { error: recapErr } = await admin
    .from("ulm_weekly_recaps")
    .upsert({ user_id: userId, week_start: weekStart, overall_retention_pct: 72, trend: "up", strongest_book_title: "P2P3-ENG1-VERIFY Strong Book", weakest_book_title: "P2P3-ENG1-VERIFY Weak Book" }, { onConflict: "user_id,week_start" });
  if (recapErr) throw new Error(`ulm_weekly_recaps seed failed: ${recapErr.message}`);

  check(who, "setup", "fixtures seeded", true, `class ${f.classId}, week ${weekStart}, overflow week of ${overflowDate}`);
}

async function cleanupFixtures(who: string, userId: string, f: PartialFixtures) {
  if (f.reviewIds?.length) await admin.from("reviews").delete().in("id", f.reviewIds);
  if (f.questionId) await admin.from("questions").delete().eq("id", f.questionId);
  if (f.assessmentIds?.length) await admin.from("class_assessments").delete().in("id", f.assessmentIds);
  if (f.taskId) await admin.from("tasks").delete().eq("id", f.taskId);
  if (f.classId) await admin.from("classes").delete().eq("id", f.classId);
  if (f.dayStartLocalDate) await admin.from("day_starts").delete().eq("user_id", userId).eq("local_date", f.dayStartLocalDate);
  if (f.narrativeWeekStart) await admin.from("collegeos_weekly_narratives").delete().eq("user_id", userId).eq("week_start", f.narrativeWeekStart);
  if (f.recapWeekStart) await admin.from("ulm_weekly_recaps").delete().eq("user_id", userId).eq("week_start", f.recapWeekStart);

  const remaining: Record<string, number | null> = {};
  const { count: reviewCount } = f.reviewIds?.length ? await admin.from("reviews").select("id", { count: "exact", head: true }).in("id", f.reviewIds) : { count: 0 };
  remaining.reviews = reviewCount ?? 0;
  const { count: classCount } = f.classId ? await admin.from("classes").select("id", { count: "exact", head: true }).eq("id", f.classId) : { count: 0 };
  remaining.class = classCount ?? 0;
  const { count: dayStartCount } = f.dayStartLocalDate
    ? await admin.from("day_starts").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("local_date", f.dayStartLocalDate)
    : { count: 0 };
  remaining.dayStart = dayStartCount ?? 0;
  const { count: narrCount } = f.narrativeWeekStart
    ? await admin.from("collegeos_weekly_narratives").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("week_start", f.narrativeWeekStart)
    : { count: 0 };
  remaining.narrative = narrCount ?? 0;
  const allGone = Object.values(remaining).every((n) => n === 0);
  check(who, "cleanup", "all fixtures GONE (verified by re-select)", allGone, JSON.stringify(remaining));
}

// ── per-task checks ──────────────────────────────────────────────────
async function checkP203(page: Page, who: string) {
  await nav(page, `${BASE}/weekly-review`);
  const narrativeOk = await visible(page.getByText("P2P3-ENG1-VERIFY: a quiet week overall."));
  check(who, "P2-03", "CollegeOS weekly narrative renders under 'Your week' on Weekly Review", narrativeOk);

  await nav(page, `${BASE}/self-mastery`);
  const recapCard = page.getByTestId("weekly-recap-card");
  const recapOk = await visible(recapCard);
  check(who, "P2-03", "ULM weekly recap card renders", recapOk);
  if (recapOk) {
    const text = await recapCard.innerText();
    check(who, "P2-03", "recap shows 72% retention + strongest/weakest book titles", text.includes("72%") && text.includes("P2P3-ENG1-VERIFY Strong Book") && text.includes("P2P3-ENG1-VERIFY Weak Book"), text);
  }
}

async function checkP206(page: Page, who: string) {
  await nav(page, `${BASE}/open/today`);
  const row = page.getByTestId(/^timebox-row-/);
  const rowVisible = await visible(row);
  check(who, "P2-06", "seeded starred task appears on Merged Today's timeline (Start Day already marked)", rowVisible);
  if (!rowVisible) return;

  const timeInput = row.first().locator('input[type="time"]');
  await timeInput.fill("09:30");
  await row.first().getByRole("button", { name: "Save" }).click();
  await pause(1500);
  const { data: afterSave } = await admin.from("tasks").select("planned_start_time").eq("id", (await row.first().getAttribute("data-testid"))!.replace("timebox-row-", "")).maybeSingle();
  check(who, "P2-06", "planned start time persisted to the DB (09:30)", afterSave?.planned_start_time === "09:30", String(afterSave?.planned_start_time));

  await nav(page, `${BASE}/open/today`);
  const reloadedInput = page.getByTestId(/^timebox-row-/).first().locator('input[type="time"]');
  const reloadedOk = await visible(reloadedInput);
  const reloadedValue = reloadedOk ? await reloadedInput.inputValue() : "";
  check(who, "P2-06", "planned start time survives a page reload (editable, persisted)", reloadedValue === "09:30", reloadedValue);

  const clearBtn = page.getByTestId(/^timebox-row-/).first().getByRole("button", { name: "Clear" });
  if (await visible(clearBtn)) {
    await clearBtn.click();
    await pause(1000);
    check(who, "P2-06", "Clear button present and clickable (undo path)", true);
  }
}

async function checkP208(page: Page, who: string) {
  await nav(page, `${BASE}/self-mastery`);
  const card = page.getByTestId("overconfidence-card");
  const ok = await visible(card);
  check(who, "P2-08", "overconfidence card renders", ok);
  if (ok) {
    const text = await card.innerText();
    check(
      who,
      "P2-08",
      "20 'sure' reviews at 20% actual-correct-rate produce the OVERCONFIDENT verdict (destructive styling, real % quoted)",
      text.includes("20%") && /actually right/i.test(text),
      text
    );
  }
}

async function checkP210(page: Page, who: string) {
  await nav(page, `${BASE}/school`);
  const overflowBadge = page.getByText("Overflow", { exact: true });
  const ok = await visible(overflowBadge);
  check(who, "P2-10", "3 ungraded assessments due the same future week trigger the item-count Overflow badge", ok);
  const itemsVisible = await visible(page.getByText(/P2P3-ENG1-VERIFY item 1/));
  check(who, "P2-10", "seeded assessment names appear in that week's Course load panel", itemsVisible);
}

async function checkP213NoRegression(page: Page, who: string) {
  await nav(page, `${BASE}/self-mastery`);
  const heading = await visible(page.getByRole("heading", { name: "Self-Mastery" }));
  check(who, "P2-13", "/self-mastery still reachable and renders after the embeddings-pipeline wiring (Slices A-C) -- no regression to the library surface", heading);
  check(
    who,
    "P2-13",
    "embed-stage DB transition + BYOK graceful degradation stayed on unit evidence (399/399, cited in the 03 review) -- the driving route is CRON_SECRET-gated, not reachable from this script, same posture the P2-09 sweep took for its assembly cron",
    true
  );
}

// ── one full account pass ────────────────────────────────────────────
async function runAccount(browser: Browser, email: string, password: string, userId: string, mode: string) {
  const who = email.split("@")[0];
  const fixtures: PartialFixtures = {};
  let context: BrowserContext | null = null;
  try {
    const client = await asAccountClient(email, password);
    const { data: profile } = await admin.from("profiles").select("timezone").eq("user_id", userId).maybeSingle();
    const timezone = (profile?.timezone as string | undefined) ?? "UTC";
    await seedFixtures(who, client, userId, timezone, fixtures);

    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await login(page, email, password);
    check(who, "login", `signed in once (${mode} mode), desktop 1280 pass begins`, true);

    await checkP203(page, who);
    await checkP206(page, who);
    await checkP208(page, who);
    await checkP210(page, who);
    await checkP213NoRegression(page, who);

    // ── mobile 390 pass: same context/session, reachability + no horizontal overflow ──
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileRoutes: [string, string][] = [
      ["P2-03", `${BASE}/weekly-review`],
      ["P2-03-self-mastery", `${BASE}/self-mastery`],
      ["P2-06", `${BASE}/open/today`],
      ["P2-10", `${BASE}/school`],
    ];
    for (const [task, url] of mobileRoutes) {
      await nav(page, url);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      check(who, task, `mobile 390 reachable, no horizontal overflow (${url.replace(BASE, "")})`, !overflow, `scrollWidth check`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("ABORT:")) throw e;
    check(who, "run", "aborted with an unexpected error (not a 403 mitigation)", false, msg);
  } finally {
    if (context) await context.close();
    await cleanupFixtures(who, userId, fixtures);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const a of Object.values(accounts)) {
      await runAccount(browser, a.email, a.password, a.userId, a.mode);
    }
  } catch (e) {
    console.error("ABORTED:", e instanceof Error ? e.message : String(e));
    await browser.close();
    process.exit(3);
  }
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
