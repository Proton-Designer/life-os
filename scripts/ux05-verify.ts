/**
 * Live production verify for UX-05 (commit c9bfd0e, deploy a200bee):
 * the Signal:Noise donut and the Per-domain Wasted row on /insights must
 * both state, in one short line, that an unconfirmed Lock-In hour counts
 * as Wasted and how to avoid it -- with zero change to the underlying
 * Wasted derivation itself (already confirmed structurally in code review:
 * the diff touches app/(app)/insights/page.tsx only).
 *
 * Both panels only render their "has data" branch (and therefore the new
 * copy) when the account has at least one real allocation checkin with
 * wasted minutes in the current week -- neither teamb account has one by
 * default, so this seeds exactly one via the SAME `save_allocation_checkin`
 * RPC the real UI calls (not a raw table insert -- respects the
 * `checkin_allocations_domain_wasted_xor` CHECK migration 108 added),
 * called as the signed-in account itself (security invoker, auth.uid()),
 * then cleans it up via the admin client and verifies the cleanup by
 * re-select, never by trusting the UI.
 *
 * Standalone script, NEVER `npx playwright test` against the prod alias.
 * Traffic discipline (RULES-CARD.md): one browser, sequential, one login
 * per account per run, >=500ms between navigations, resize (not re-auth)
 * for the mobile pass, abort immediately on a 403 with x-vercel-mitigated.
 *
 * Usage: npx tsx scripts/ux05-verify.ts [baseUrl]
 */
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

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
  await pause(2000); // post-hydration buffer -- see p2-p3-verify-sweep.ts's own note
  return res;
}

async function login(page: Page, email: string, password: string) {
  await nav(page, `${BASE}/login`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
}

/** Seeds exactly one real allocation checkin with wasted minutes, via the SAME RPC the real UI/actions-core.ts call -- respects the domain/is_wasted XOR CHECK, never a raw insert. Returns the checkin id for cleanup. */
async function seedWastedHour(email: string, password: string): Promise<string> {
  const client = createClient(SUPA_URL!, ANON!, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`sign-in for fixture seeding failed: ${signInError.message}`);

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - 120 * 60_000);
  const { data, error } = await client.rpc("save_allocation_checkin", {
    p_window_start: windowStart.toISOString(),
    p_window_end: windowEnd.toISOString(),
    p_allocations: { business: 60 },
    p_wasted_minutes: 60,
  });
  if (error) throw new Error(`save_allocation_checkin seed failed: ${error.message}`);
  await client.auth.signOut();
  return data as string;
}

async function cleanupWastedHour(checkinId: string): Promise<void> {
  const { error } = await admin.from("checkins").delete().eq("id", checkinId);
  if (error) throw new Error(`cleanup delete failed: ${error.message}`);
  const { data, error: selErr } = await admin.from("checkins").select("id").eq("id", checkinId);
  if (selErr) throw new Error(`cleanup verify select failed: ${selErr.message}`);
  if ((data ?? []).length !== 0) throw new Error(`cleanup did not remove checkin ${checkinId}`);
  const { data: orphans, error: orphanErr } = await admin.from("checkin_allocations").select("id").eq("checkin_id", checkinId);
  if (orphanErr) throw new Error(`cleanup orphan-check select failed: ${orphanErr.message}`);
  if ((orphans ?? []).length !== 0) throw new Error(`cleanup left ${orphans!.length} orphaned checkin_allocations row(s) for ${checkinId}`);
}

const DONUT_NOTE = /Wasted includes any Lock-In hour you never confirmed, not just idle time.*Still on it/i;
const ROW_NOTE = /includes unconfirmed Lock-In hours, not just idle time/i;

async function checkInsightsPage(page: Page, who: string, viewportLabel: string) {
  await nav(page, `${BASE}/insights`);

  // Panel titles (components/ui/panel.tsx) render as a plain <span>, not an
  // ARIA heading role -- getByText is the correct selector here, confirmed
  // by reading the component after this check first false-failed while the
  // substantive copy checks below it correctly passed.
  const donutHeading = await visible(page.getByText("Signal:Noise", { exact: true }));
  check(who, `${viewportLabel}: Signal:Noise panel reachable`, donutHeading);

  const donutNoteVisible = await visible(page.getByText(DONUT_NOTE));
  check(who, `${viewportLabel}: donut panel states the unconfirmed-hour rule + how to avoid it`, donutNoteVisible);

  const perDomainHeading = await visible(page.getByText("Per-domain", { exact: true }));
  check(who, `${viewportLabel}: Per-domain panel reachable`, perDomainHeading);

  const wastedRowNoteVisible = await visible(page.getByText(ROW_NOTE));
  check(who, `${viewportLabel}: Per-domain Wasted row states the same rule (self-contained)`, wastedRowNoteVisible);

  // Sanity that this is real, non-zero wasted data (the seeded fixture), not
  // an accidentally-passing empty state -- a positive control that the
  // panel is actually in its "has data" branch, not silently in EmptyState.
  const wastedRowLi = page.locator("li", { hasText: "Wasted" });
  const wastedAmountVisible = await visible(wastedRowLi.getByText(/\d+h|\d+m/));
  check(who, `${viewportLabel}: a real (nonzero) Wasted amount is displayed alongside the note`, wastedAmountVisible, wastedAmountVisible ? await wastedRowLi.first().innerText() : "not found");
}

async function runAccount(who: string, email: string, password: string) {
  console.log(`\n=== ${who} ===`);
  let checkinId: string | null = null;
  const browser = await chromium.launch();
  try {
    checkinId = await seedWastedHour(email, password);
    check(who, "fixture: seeded one real wasted-hour allocation checkin via save_allocation_checkin RPC", true, checkinId);

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await login(page, email, password);

    await checkInsightsPage(page, who, "1280x800 desktop");

    await page.setViewportSize({ width: 390, height: 844 });
    await checkInsightsPage(page, who, "390x844 mobile");

    await context.close();
  } finally {
    await browser.close();
    if (checkinId) {
      await cleanupWastedHour(checkinId);
      check(who, "fixture: seeded checkin + its checkin_allocations rows cleaned up (verified by re-select)", true);
    }
  }
}

async function main() {
  for (const [who, acc] of Object.entries(accounts)) {
    await runAccount(who, acc.email, acc.password);
  }

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
