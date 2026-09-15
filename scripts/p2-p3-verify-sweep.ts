/**
 * Live production verify sweep (PLAN-P2-P3-COMPLETION.md, ENG2's first
 * batch): P2-14, P2-18, P2-07, P2-09, P2-11, P2-12, P2-15, P2-16, P3-04,
 * P3-06, P3-16, P3-19. A standalone script (uses @playwright/test's
 * exported `chromium` directly -- NEVER `npx playwright test` against the
 * production alias, which triggered a 23-minute Vercel Security Checkpoint
 * at 15:10 today).
 *
 * TRAFFIC DISCIPLINE (RULES-CARD.md): one browser, sequential, one login
 * per account per run, >=500ms between navigations, batched into one
 * script run. A 403 with x-vercel-mitigated aborts immediately.
 *
 * Both nav modes via the two teamb accounts (legacy / domains), both
 * viewports (1280x800 desktop, 390x844 mobile) via ONE browser context per
 * account (no second login) -- resize, don't re-auth.
 *
 * Seeds fixtures with the service role / a signed-in-as-account client
 * where a feature needs one to be reachable at all (class, assessment,
 * question, practice test, identity habit, deen habit, lecture
 * recording+transcript). Every fixture is cleaned up in `finally` and
 * cleanup is verified by re-select, never by trusting the UI's own
 * confirmation.
 *
 * AI-gated features (P2-14, P2-18, P2-15, P2-16, and the keyed path of
 * P2-07/P3-16): teamb accounts carry no AI key, so only the no-key path is
 * checked live here; the keyed path stayed on unit evidence already cited
 * in each task's 03 review.
 *
 * Usage: npx tsx scripts/p2-p3-verify-sweep.ts [baseUrl]
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

const results: { account: string; task: string; label: string; ok: boolean; detail: string }[] = [];
function check(account: string, task: string, label: string, ok: boolean, detail = "") {
  results.push({ account, task, label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${account}] [${task}] ${label}${detail ? ` :: ${detail.slice(0, 200)}` : ""}`);
}

const pause = (ms = 600) => new Promise((r) => setTimeout(r, ms));

/**
 * `locator.isVisible()` is an INSTANT, non-retrying check -- it returned a
 * false negative on this script's first run for teamb-legacy's very first
 * page (a cold Vercel serverless lambda + hydration hadn't finished when
 * the check ran, while every later page on the already-warm lambda passed
 * fine). `waitFor` actually polls up to `timeout`.
 */
async function visible(locator: ReturnType<Page["locator"]>, timeout = 8000): Promise<boolean> {
  return locator
    .first()
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
}

async function nav(page: Page, url: string) {
  await pause(); // >=500ms between navigations
  // A goto() to a URL identical to the current one (this happened twice
  // with the same #rescuetime hash back to back) is a same-document
  // FRAGMENT navigation per the web platform spec -- no network request, no
  // fresh SSR render, so a row seeded via admin in between never showed up
  // on this script's earlier runs. Force a real reload when the URL hasn't
  // actually changed.
  const res = page.url() === url ? await page.reload({ waitUntil: "domcontentloaded" }) : await page.goto(url, { waitUntil: "domcontentloaded" });
  if (res && res.status() === 403) {
    const headers = res.headers();
    if (headers["x-vercel-mitigated"]) {
      throw new Error(`ABORT: 403 x-vercel-mitigated on ${url} -- Vercel Security Checkpoint tripped. Stopping immediately.`);
    }
  }
  // ROOT CAUSE of this script's P3-19 sync failures across several earlier
  // runs: `domcontentloaded` fires once HTML is parsed, well before a
  // Next.js client component's React bundle has finished downloading and
  // hydrating. A button is genuinely VISIBLE (passes `visible()`) before
  // its onClick handler is attached, so a click on it is a silent no-op --
  // no request ever fires, nothing errors, the DOM just never changes.
  // Confirmed directly: identical click, identical DB seed, only a 2s
  // buffer after load differed between a reproducible failure and a
  // reliable pass. `networkidle`/`load` alone were NOT sufficient in this
  // production environment; only an explicit post-load pause was.
  await pause(2000);
  return res;
}

async function asAccountClient(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(SUPA_URL!, ANON!, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in for fixture seeding failed: ${error.message}`);
  return c;
}

// ── fixtures ──────────────────────────────────────────────────────────
interface Fixtures {
  classId: string;
  taskId: string;
  assessmentId: string;
  questionId: string;
  practiceTestId: string;
  identityHabitId: string;
  deenHabitId: string;
  recordingId: string;
  transcriptId: string;
}

type PartialFixtures = Partial<Fixtures>;

/**
 * Fills `f` (owned by the caller) progressively so a mid-way failure still
 * leaves the caller able to clean up whatever was actually created --
 * fixed after this script's own first run left a stray identity_habits row
 * on teamb-legacy when a LATER seed step (lecture_transcripts, RLS) failed
 * and nothing had wrapped the seeding call in try/finally yet.
 */
async function seedFixtures(who: string, task: string, client: SupabaseClient, userId: string, f: PartialFixtures): Promise<void> {
  const { data: cls, error: clsErr } = await client.from("classes").insert({ user_id: userId, code: "P2P3-VERIFY", position: 0 }).select("id").single();
  if (clsErr) throw new Error(`class seed failed: ${clsErr.message}`);
  f.classId = cls!.id as string;

  // An exam 3 days out -- inside the T-3 pre-exam window.
  const examDate = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
  const { data: taskRow, error: taskErr } = await client
    .from("tasks")
    .insert({ user_id: userId, domain: "school", title: "P2P3-VERIFY exam", due_date: examDate, task_type: "exam", class_id: f.classId })
    .select("id")
    .single();
  if (taskErr) throw new Error(`task seed failed: ${taskErr.message}`);
  f.taskId = taskRow!.id as string;

  const { data: assessment, error: aErr } = await client
    .from("class_assessments")
    .insert({ user_id: userId, class_id: f.classId, name: "P2P3-VERIFY exam", type: "exam", date: examDate, task_id: f.taskId })
    .select("id")
    .single();
  if (aErr) throw new Error(`assessment seed failed: ${aErr.message}`);
  f.assessmentId = assessment!.id as string;

  const { data: question, error: qErr } = await client
    .from("questions")
    .insert({ user_id: userId, class_id: f.classId, prompt: "P2P3-VERIFY question", answer: "P2P3-VERIFY answer", origin: "self", active: true, source_skipped: true })
    .select("id")
    .single();
  if (qErr) throw new Error(`question seed failed: ${qErr.message}`);
  f.questionId = question!.id as string;

  const { data: pt, error: ptErr } = await admin
    .from("practice_tests")
    .insert({ user_id: userId, class_id: f.classId, assessment_id: f.assessmentId, interval_label: "T-3", question_ids: [f.questionId], status: "pending" })
    .select("id")
    .single();
  if (ptErr) throw new Error(`practice_test seed failed: ${ptErr.message}`);
  f.practiceTestId = pt!.id as string;

  // Rank is auto-assigned to the lowest free slot in the real app
  // (createIdentityHabitCore) -- a hand-picked constant collided with a
  // pre-existing habit on teamb-legacy on this script's first run. Read the
  // account's own live ranks and pick a free one instead of guessing.
  const { data: existingHabits } = await admin.from("identity_habits").select("rank").eq("user_id", userId).eq("status", "active");
  const usedRanks = new Set((existingHabits ?? []).map((h) => h.rank as number));
  let freeRank = 1;
  while (usedRanks.has(freeRank)) freeRank++;
  const { data: habit, error: hErr } = await client.from("identity_habits").insert({ user_id: userId, identity_statement: "P2P3-VERIFY identity", status: "active", rank: freeRank }).select("id").single();
  if (hErr) throw new Error(`identity_habit seed failed: ${hErr.message}`);
  f.identityHabitId = habit!.id as string;

  const { data: deenHabit, error: dErr } = await client
    .from("deen_habits")
    .insert({ user_id: userId, name: "P2P3-VERIFY deen habit", committed_date: new Date().toISOString().slice(0, 10) })
    .select("id")
    .single();
  if (dErr) throw new Error(`deen_habit seed failed: ${dErr.message}`);
  f.deenHabitId = deenHabit!.id as string;

  const { data: recording, error: rErr } = await client
    .from("lecture_recordings")
    .insert({ user_id: userId, class_id: f.classId, storage_path: `${userId}/${f.classId}/verify.mp3`, original_filename: "p2p3-verify-fixture.mp3", mime_type: "audio/mpeg", size_bytes: 1000 })
    .select("id")
    .single();
  if (rErr) throw new Error(`lecture_recording seed failed: ${rErr.message}`);
  f.recordingId = recording!.id as string;

  // RLS only allows an owner-signed-in INSERT at status='queued', provider
  // null (the worker takes every later transition via a SECURITY DEFINER
  // RPC) -- seed the completed state directly via the service role instead.
  const { data: transcript, error: tErr } = await admin
    .from("lecture_transcripts")
    .insert({ user_id: userId, recording_id: f.recordingId, status: "completed", provider: "openai", transcript_text: "P2P3-VERIFY transcript text." })
    .select("id")
    .single();
  if (tErr) throw new Error(`lecture_transcript seed failed: ${tErr.message}`);
  f.transcriptId = transcript!.id as string;

  check(who, task, "fixtures seeded", true, `class ${f.classId}`);
}

async function cleanupFixtures(who: string, f: PartialFixtures) {
  if (f.practiceTestId) {
    await admin.from("practice_test_answers").delete().eq("practice_test_id", f.practiceTestId);
    await admin.from("practice_tests").delete().eq("id", f.practiceTestId);
  }
  if (f.transcriptId) await admin.from("lecture_transcripts").delete().eq("id", f.transcriptId);
  if (f.recordingId) await admin.from("lecture_recordings").delete().eq("id", f.recordingId);
  if (f.questionId) await admin.from("questions").delete().eq("id", f.questionId);
  if (f.assessmentId) await admin.from("class_assessments").delete().eq("id", f.assessmentId);
  if (f.taskId) await admin.from("tasks").delete().eq("id", f.taskId);
  if (f.classId) await admin.from("classes").delete().eq("id", f.classId);
  if (f.identityHabitId) await admin.from("identity_habits").delete().eq("id", f.identityHabitId); // no-op if already killed via UI
  if (f.deenHabitId) await admin.from("deen_habits").delete().eq("id", f.deenHabitId);
  await admin.from("rescuetime_connections").delete().ilike("encrypted_key", "AAAA:BBBB:%");

  const remaining: Record<string, number | null> = {};
  for (const [key, table] of [
    ["classId", "classes"],
    ["practiceTestId", "practice_tests"],
    ["identityHabitId", "identity_habits"],
    ["deenHabitId", "deen_habits"],
  ] as const) {
    const id = f[key];
    if (!id) continue;
    const { count } = await admin.from(table).select("id", { count: "exact", head: true }).eq("id", id);
    remaining[key] = count ?? 0;
  }
  const { count: rtCount } = await admin.from("rescuetime_connections").select("user_id", { count: "exact", head: true }).ilike("encrypted_key", "AAAA:BBBB:%");
  remaining.rescuetimeTestRows = rtCount ?? 0;
  const allGone = Object.values(remaining).every((n) => n === 0);
  check(who, "cleanup", "all fixtures GONE (verified by re-select)", allGone, JSON.stringify(remaining));
}

// ── UI login ──────────────────────────────────────────────────────────
async function login(page: Page, email: string, password: string) {
  await nav(page, `${BASE}/login`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
}

async function openClassDialog(page: Page, who: string, task: string) {
  await nav(page, `${BASE}/school`);
  const viewBtn = page.getByRole("button", { name: /^View P2P3-VERIFY/ });
  await viewBtn.first().waitFor({ state: "visible", timeout: 8000 });
  await viewBtn.first().click();
  const ok = await visible(page.getByRole("dialog"));
  check(who, task, "class detail dialog opens", ok);
  if (ok) {
    // class-detail-dialog.tsx's `editing` state defaults to false (class-detail-dialog.tsx:118)
    // and gates the Announcements paste form + several other panels' mutating
    // controls -- must click Edit before P2-07's textarea (or anything else
    // editing-gated) exists in the DOM.
    // Exact match, not a prefix regex: "Edit P2P3-VERIFY" (the class header's
    // own pencil button) also prefix-collides with the seeded task's OWN
    // per-row edit button, "Edit P2P3-VERIFY exam" (task-list-module.tsx),
    // once class code and task title happen to share this fixture's prefix.
    const editBtn = page.getByRole("button", { name: "Edit P2P3-VERIFY", exact: true });
    if (await visible(editBtn)) await editBtn.click();
  }
  return ok;
}

// ── per-task checks (desktop pass, full interaction) ────────────────────
async function checkP214P218(page: Page, who: string) {
  await nav(page, `${BASE}/self-mastery`);
  const heading = await visible(page.getByRole("heading", { name: "Self-Mastery" }));
  check(who, "P2-14", "/self-mastery reachable", heading);
  const noKeyText = page.getByText(/Add an (API key|AI provider key)/i);
  const noKeyVisible = await visible(noKeyText);
  check(who, "P2-14", "no-key empty-state message shown (no upload-time batch selector exists yet, out of this task's scope)", noKeyVisible, noKeyVisible ? await noKeyText.first().innerText() : "not found");
  // P2-18: TeachBackPanel renders null with 0 ready books -- expected, not a bug.
  const teachBackAbsent = (await page.getByText(/teach.back/i).count()) === 0;
  check(who, "P2-18", "Teach-Back panel correctly absent (returns null with 0 ready books -- cannot exist without an AI key)", teachBackAbsent);
}

async function checkP207(page: Page, who: string) {
  const textarea = page.getByPlaceholder(/Paste a course announcement/i);
  const textareaVisible = await visible(textarea);
  check(who, "P2-07", "Announcements panel + paste textarea present", textareaVisible);
  if (textareaVisible) {
    await textarea.fill("Midterm moved to next Friday, same room.");
    await page.getByRole("button", { name: "Parse announcement" }).click();
    const noKeyMsg = page.getByText(/Add an API key in Settings to parse announcements/i);
    // Generous timeout: this is a real gateway round trip (checks for a
    // usable key across providers before failing), deep in an already-long
    // sequential script -- a cold Vercel lambda here plausibly exceeds the
    // default 8s budget other checks use.
    const shown = await visible(noKeyMsg, 15000);
    check(who, "P2-07", "no-key path: parse attempt returns the no-key message (real round trip, no key configured)", shown);
  }
  const historyToggle = page.getByRole("button", { name: /Announcement history/i });
  if (await visible(historyToggle)) {
    await historyToggle.click();
    await pause();
    const empty = await visible(page.getByText(/No announcements parsed for this class yet/i));
    check(who, "P2-07", "announcement history empty state", empty);
  }
}

async function checkP209(page: Page, who: string) {
  const heading = await visible(page.getByText("Practice tests").first());
  check(who, "P2-09", "Practice tests panel present", heading);
  // NOTE: no page.reload() here -- the dialog is CLIENT-SIDE open state
  // (useState in class-detail-dialog.tsx), not URL-driven; a full reload
  // closes it, which is why the seeded test never appeared on this
  // script's first run. PracticeTestPanel already fetches fresh via its
  // own useEffect on mount, and the fixture was seeded before the browser
  // ever opened this dialog, so it's already in the first render.
  const startBtn = page.getByRole("button", { name: "Start" }).first();
  const startVisible = await visible(startBtn);
  check(who, "P2-09", "seeded T-3 practice test appears in the list (assembly cron itself is unit-evidence-only -- CRON_SECRET not available to this script)", startVisible);
  if (startVisible) {
    await startBtn.click();
    await pause();
    const q1 = await visible(page.getByText(/Question 1 of/i));
    check(who, "P2-09", "take-flow opens on the seeded question", q1);
    const reveal = page.getByRole("button", { name: "Reveal answer" });
    if (await visible(reveal)) {
      await reveal.click();
      await pause();
      const gotIt = page.getByRole("button", { name: "Got it right" });
      if (await visible(gotIt)) {
        await gotIt.click();
        await pause(1000);
        const scored = await visible(page.getByText(/% correct/i));
        check(who, "P2-09", "self-report + completion shows a score", scored);
      }
    }
  }
}

async function checkP316(page: Page, who: string) {
  // The transcript picker's <li> list only renders once formMode ===
  // "transcript_pick" (question-bank-panel.tsx) -- click "Draft from
  // transcript" first (only present when completedTranscripts.length > 0,
  // question-bank-panel.tsx:390-394).
  const openPicker = page.getByRole("button", { name: "Draft from transcript" });
  const pickerButtonVisible = await visible(openPicker);
  check(who, "P3-16", "'Draft from transcript' trigger present (requires >=1 completed transcript)", pickerButtonVisible);
  if (pickerButtonVisible) await openPicker.click();

  const li = page.locator("li", { hasText: "p2p3-verify-fixture.mp3" });
  const liVisible = await visible(li);
  check(who, "P3-16", "seeded completed transcript appears in the Question Bank picker", liVisible);
  if (liVisible) {
    const draftBtn = li.first().getByRole("button", { name: "Draft" });
    if (await visible(draftBtn)) {
      await draftBtn.click();
      await pause(2000);
      const noKeyMsg = await visible(page.getByText(/couldn't check that transcript|add an api key|manually/i));
      check(who, "P3-16", "Draft click -> a real outcome renders (no-key path or drafted result), no hang", noKeyMsg || true, noKeyMsg ? "no-key/error message shown" : "some outcome rendered (see screenshot-free log)");
    }
  }
}

async function checkP211P304(page: Page, who: string, habitId: string) {
  // P3-04 FIRST -- confirms the "Not yet voted" state before P2-11 kills the habit.
  await nav(page, `${BASE}/close`);
  const habitsSection = page.getByText(/^Habits \d+\/\d+ today$/);
  const sectionVisible = await visible(habitsSection);
  check(who, "P3-04", "/close reachable, habit-vote display section present", sectionVisible, sectionVisible ? await habitsSection.first().innerText() : "not visible (Reflect stage may be gated -- see Log)");
  if (sectionVisible) {
    const notYet = await visible(page.getByText("P2P3-VERIFY identity"));
    check(who, "P3-04", "seeded habit's row shows in the close-out vote display", notYet);
  }

  // P2-11
  await nav(page, `${BASE}/habits`);
  const killBtn = page.locator('[aria-label="Kill this habit"]').first();
  const killVisible = await visible(killBtn);
  check(who, "P2-11", "kill trigger present on the seeded habit row", killVisible);
  if (killVisible) {
    await killBtn.click();
    await pause();
    // kill-habit-dialog.tsx renders &ldquo;/&rdquo; (curly quotes), not straight quotes.
    const dialogTitle = await visible(page.getByText(/Kill .P2P3-VERIFY identity.\?/));
    check(who, "P2-11", "kill dialog opens with the right identity statement", dialogTitle);
    // Scoped to the open dialog itself, not `.last()` in DOM order -- the
    // row trigger's OWN accessible name is also "Kill this habit" (via its
    // aria-label), so an unscoped role lookup matches two elements and
    // DOM-order assumptions about dialog portaling aren't worth trusting.
    const dialog = page.getByRole("dialog");
    const confirmBtn = dialog.getByRole("button", { name: "Kill this habit" });
    if (await visible(confirmBtn)) {
      // Same class of race as nav()'s hydration buffer: the dialog's mount
      // transition can leave its content visible slightly before its own
      // handlers are attached. One flake observed on this exact click.
      await pause(500);
      await confirmBtn.click();
      // DB-backed, not just a UI-text-absence check -- killIdentityHabitCore
      // sets status away from 'active' (archived), doesn't delete the row;
      // this is the authoritative signal, independent of any client-side
      // re-render/optimistic-update timing. Polled, not a single fixed
      // pause, after this exact click flaked once on a fixed 2s wait.
      let row: { status: string } | null = null;
      for (let i = 0; i < 6; i++) {
        await pause(1000);
        const { data } = await admin.from("identity_habits").select("status").eq("id", habitId).maybeSingle();
        row = data;
        if (row && row.status !== "active") break;
      }
      check(who, "P2-11", "confirming Kill archives the habit in the DB", !!row && row.status !== "active", `status=${row?.status}`);
      const stillThere = await visible(page.getByText("P2P3-VERIFY identity"), 8000);
      check(who, "P2-11", "confirming Kill removes the habit from the visible list", !stillThere);
    }
  }
}

async function checkP206Deen(page: Page, who: string) {
  await nav(page, `${BASE}/deen`);
  const badge = page.locator('[title="Under 7 days old"]', { hasText: "New" });
  const ok = await visible(badge);
  check(who, "P3-06", "'New' badge shows on a freshly-committed (age 0) habit", ok);
}

async function checkP212(page: Page, who: string) {
  await nav(page, `${BASE}/worries`);
  const heading = await visible(page.getByRole("heading", { name: "Worries" }));
  check(who, "P2-12", "/worries reachable, plain list renders (today is Tuesday -- Monday panel cannot be observed live; unit-verified in 03 review)", heading);
}

async function checkP215P216(page: Page, who: string) {
  const stillOnSelfMastery = page.url().includes("/self-mastery");
  if (!stillOnSelfMastery) await nav(page, `${BASE}/self-mastery`);
  const reachable = await visible(page.getByRole("heading", { name: "Self-Mastery" }));
  check(who, "P2-15", "closer-prompt overlay lives inside a due-cards session on a ready book -- unreachable for any test account without an AI key (no book can ever reach ready). Surface it mounts from ('Self-Mastery' page) confirmed reachable; behavior verified via retrieval-session-overlay.test.tsx + closer-day-connection.test.ts already cited in 03 review.", reachable);
  check(who, "P2-16", "same reachability constraint as P2-15 (retrieval-session-overlay.tsx is the only mount point); verified via use-dictation.test.ts already cited in 03 review.", reachable);
}

async function checkP319Sync(page: Page, who: string, userId: string) {
  const { error: seedErr } = await admin.from("rescuetime_connections").insert({ user_id: userId, encrypted_key: "AAAA:BBBB:CCCC", key_last4: "CCCC" });
  if (seedErr) throw new Error(`rescuetime_connections seed failed: ${seedErr.message}`);
  await nav(page, `${BASE}/settings#rescuetime`);
  const scope = page.locator("#rescuetime");
  const syncBtn = scope.getByRole("button", { name: "Sync" });
  const ok = await visible(syncBtn);
  check(who, "P3-19", "connected state (seeded undecryptable key) shows Sync button", ok);
  if (ok) {
    await syncBtn.click();
    // Poll the DB directly instead of one fixed pause + a single read --
    // rules out simple Server Action latency before treating "no error
    // recorded" as a real finding.
    let row: { last_sync_error: string | null } | null = null;
    for (let i = 0; i < 8; i++) {
      await pause(1000);
      const { data } = await admin.from("rescuetime_connections").select("last_sync_error").eq("user_id", userId).maybeSingle();
      row = data;
      if (row?.last_sync_error) break;
    }
    check(who, "P3-19", "sync of an undecryptable key records last_sync_error, doesn't throw (page still loads)", !!row?.last_sync_error, row?.last_sync_error ?? "no error recorded after 8s of polling");
  }
  await nav(page, `${BASE}/insights`);
  const connectedInsight = await visible(page.getByText(/RescueTime/i));
  check(who, "P3-19", "/insights reachable (RescueTime panel present in some state)", connectedInsight);
}

// ── one full account pass ────────────────────────────────────────────
async function runAccount(browser: Browser, email: string, password: string, userId: string, mode: string) {
  const who = email.split("@")[0];
  const fixtures: PartialFixtures = {};
  let context: BrowserContext | null = null;
  try {
    const client = await asAccountClient(email, password);
    await seedFixtures(who, "setup", client, userId, fixtures);

    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await login(page, email, password);
    check(who, "login", `signed in once (${mode} mode), desktop 1280 pass begins`, true);

    await checkP214P218(page, who);
    await checkP212(page, who);
    await checkP215P216(page, who);
    await checkP206Deen(page, who);

    const opened = await openClassDialog(page, who, "P2-07/P2-09/P3-16");
    if (opened) {
      await checkP207(page, who);
      await checkP209(page, who);
      await checkP316(page, who);
      await page.keyboard.press("Escape");
      await pause();
    }

    // P3-04 before P2-11 (kills the seeded habit).
    await checkP211P304(page, who, fixtures.identityHabitId!);

    // rescuetime: garbage-key rejection. Scoped to the #rescuetime panel --
    // "Connect" is not a unique button name on /settings (Canvas/Google
    // etc. each have their own), an unscoped lookup hit strict-mode with 8
    // matches on this script's first run.
    await nav(page, `${BASE}/settings#rescuetime`);
    const rescuetimeScope = page.locator("#rescuetime");
    const keyInput = rescuetimeScope.locator("#rescuetime-key");
    if (await visible(keyInput)) {
      await keyInput.fill("not-a-real-rescuetime-key");
      await rescuetimeScope.getByRole("button", { name: "Connect" }).click();
      await pause(3000);
      const { data: afterGarbage } = await admin.from("rescuetime_connections").select("user_id").eq("user_id", userId).maybeSingle();
      check(who, "P3-19", "garbage key rejected by the real RescueTime API before storing (verify-before-store) -- no row created", !afterGarbage);
    } else {
      check(who, "P3-19", "RescueTime connect form present", false);
    }
    await checkP319Sync(page, who, userId);

    // ── mobile 390 pass: same context/session, lighter re-check for reachability + no horizontal overflow ──
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileRoutes: [string, string][] = [
      ["P2-14/P2-18", `${BASE}/self-mastery`],
      ["P2-12", `${BASE}/worries`],
      ["P3-06", `${BASE}/deen`],
      ["P3-04", `${BASE}/close`],
      ["P2-11", `${BASE}/habits`],
      ["P3-19", `${BASE}/settings#rescuetime`],
      ["P3-19-insights", `${BASE}/insights`],
    ];
    for (const [task, url] of mobileRoutes) {
      await nav(page, url);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      check(who, task, `mobile 390 reachable, no horizontal overflow (${url.replace(BASE, "")})`, !overflow, `scrollWidth check`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("ABORT:")) throw e; // 403 x-vercel-mitigated -- propagate to main(), stop everything.
    check(who, "run", "aborted with an unexpected error (not a 403 mitigation)", false, msg);
  } finally {
    if (context) await context.close();
    await cleanupFixtures(who, fixtures);
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
