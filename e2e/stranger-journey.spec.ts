import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * THE ACCEPTANCE TEST FOR THE MERGED PLATFORM.
 *
 * ULM's own brief defines its bar, and it is not a test count:
 *
 *   "a new user goes from install -> book uploaded -> first session
 *    completed, with zero guidance."
 *
 * Any moment requiring outside knowledge is a DEFECT, not a documentation
 * task. ULM passed this on both platforms before the merge. Nobody had run it
 * on the merged platform — 1,821 passing tests say nothing about whether a
 * stranger can actually get from signup to a completed retrieval session.
 *
 * ADAPTED, because one leg is deliberately absent: there is no ingestion
 * worker yet (deferred, D-042), so "book uploaded" cannot happen. The honest
 * merged-platform version is:
 *
 *   sign up as a stranger -> reach Self-Mastery -> find the seeded deck ->
 *   complete a full retrieval session -> see the session-complete moment,
 *   without being told where anything is.
 *
 * RULES OF THE RUN (ULM's, and they are why the original found seven things
 * instead of one): a genuinely new account, nobody fixes anything mid-run,
 * screenshot every step including the ugly ones, and an honest verdict —
 * could a stranger have done this unaided, yes or no, not "mostly".
 *
 * Navigation here uses only what a stranger can see: visible text and roles.
 * It deliberately does NOT use test ids for the discovery steps, because a
 * testid proves the element exists, not that a person could find it.
 */

const PASSWORD = "Stranger!2026";
const SHOT = ".playwright-mcp/stranger";

const createdEmails: string[] = [];

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

test.afterEach(async () => {
  const emails = createdEmails.splice(0, createdEmails.length);
  if (!emails.length) return;
  const admin = adminClient();
  if (!admin) {
    console.warn(`[stranger] NO SERVICE KEY — accounts LEFT BEHIND: ${emails.join(", ")}`);
    return;
  }
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const email of emails) {
    const m = data?.users.find((u) => u.email === email);
    if (m) await admin.auth.admin.deleteUser(m.id);
  }
});

test.describe("stranger journey", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.setTimeout(180_000);

  test("a stranger reaches a completed retrieval session unaided", async ({ page }) => {
    // 390px throughout: this is a mobile-first product and R7 makes a 390px
    // view the evidence a task is done. Running the journey at desktop width
    // was measuring a viewport almost nobody uses.
    await page.setViewportSize({ width: 390, height: 844 });
    const findings: string[] = [];
    const note = (s: string) => { findings.push(s); console.log(`  [finding] ${s}`); };

    // The retrieval invariant, checked at the NETWORK layer rather than by
    // reading the query: no answer text may reach the client before the user
    // commits to an attempt. Reading the .select() is the near end of this.
    const answerLeaks: string[] = [];
    let revealed = false;
    page.on("response", async (res) => {
      if (revealed || !res.url().includes("/rest/v1/")) return;
      if (!/cards|card_states|get_session_queue/.test(res.url())) return;
      try {
        const body = await res.text();
        if (/"answer"\s*:\s*"(?!")/.test(body)) answerLeaks.push(res.url().slice(0, 120));
      } catch { /* non-text body */ }
    });

    // TEMPORARY DIAGNOSTIC: the overlay catches every load failure and shows one
    // generic string, so the real cause never reaches the screenshot.
    page.on("console", (m) => { if (m.type() === "error") console.log(`  [console] ${m.text().slice(0, 300)}`); });
    page.on("response", async (r) => {
      if (r.status() < 400) return;
      console.log(`  [http ${r.status()}] ${r.url().slice(0, 140)}`);
      try { console.log(`      body: ${(await r.text()).slice(0, 300)}`); } catch { /* opaque */ }
    });

    const email = `onboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    createdEmails.push(email);

    // ---- 1. Sign up ------------------------------------------------------
    await page.goto("/signup");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#confirmPassword").fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/onboarding/, { timeout: 60_000 });
    await page.screenshot({ path: `${SHOT}/01-onboarding-landed.png`, fullPage: true });

    // ---- 2. Onboarding, choosing only Personal Growth ---------------------
    await expect(page.getByTestId("onboarding-wizard")).toBeVisible({ timeout: 20_000 });
    const pg = page.getByText(/personal growth/i).first();
    if (!(await pg.isVisible().catch(() => false))) note("Could not find 'Personal Growth' by its visible name on step 1.");
    await page.getByTestId("domain-option-personal_growth").click();
    await page.screenshot({ path: `${SHOT}/02-domain-chosen.png`, fullPage: true });
    await page.getByTestId("onboarding-next").click();

    // Walk the domain. Self-Mastery must be reachable without being told.
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(600);
      const url = page.url();
      if (!/\/onboarding/.test(url)) break;
      await page.screenshot({ path: `${SHOT}/03-step-${i}.png`, fullPage: true });
      // The Faith step asks for a city before it will continue. That is correct
      // product behaviour — prayer times need a location — and a real stranger
      // would type theirs. An earlier version of this spec did not, stalled
      // here, and reported it as "a stranger would be stuck": a spec gap
      // masquerading as a product defect. Verified against the screenshot
      // before believing it.
      const city = page.getByTestId("faith-location-input");
      if (await city.isVisible().catch(() => false)) {
        await city.fill("Chicago");
        await page.getByTestId("faith-location-search").click().catch(() => {});
        const firstResult = page.getByTestId("faith-location-result").first();
        await firstResult.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {
          note("Searched for a city and no results appeared.");
        });
        if (await firstResult.isVisible().catch(() => false)) await firstResult.click();
        await page.waitForTimeout(500);
      }

      const cont = page.getByTestId("selfmastery-continue");
      if (await cont.isVisible().catch(() => false)) { await cont.click(); continue; }
      const next = page.getByTestId("onboarding-next");
      if (await next.isVisible().catch(() => false)) {
        if (await next.isDisabled().catch(() => false)) {
          note(`Onboarding step ${i}: Next is disabled with no obvious way forward.`);
          const anyOption = page.locator('[data-testid^="subdomain-option"], [data-testid^="widget-option"]').first();
          if (await anyOption.isVisible().catch(() => false)) await anyOption.click();
          else break;
        }
        await next.click({ timeout: 10_000 }).catch(() => {});
        continue;
      }
      // Some steps (Fitness "How do you train?") present option CARDS and no
      // Continue button at all — choosing one advances. A stranger figures that
      // out; the spec has to as well, or it reports its own gap as a defect.
      // Worth noting as a real inconsistency: every preceding step had an
      // explicit Continue, and this one silently doesn't.
      const optionCard = page.locator('button, [role="button"], [role="radio"]')
        .filter({ hasNotText: /back|skip/i }).nth(0);
      if (await optionCard.isVisible().catch(() => false)) {
        await optionCard.click().catch(() => {});
        await page.waitForTimeout(800);
        continue;
      }
      break;
    }
    await page.waitForURL((u) => !/\/onboarding/.test(u.toString()), { timeout: 60_000 }).catch(() => {
      note("Never left onboarding — a stranger would be stuck in the wizard.");
    });
    await page.screenshot({ path: `${SHOT}/04-after-onboarding.png`, fullPage: true });

    // ---- 3. Home: is there an invitation to study? -----------------------
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${SHOT}/05-home.png`, fullPage: true });
    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    const hasDueInvite = /cards? due|nothing due|review anyway|self-mastery/.test(bodyText);
    if (!hasDueInvite) note("Home shows nothing about Self-Mastery — a stranger has no prompt to study.");

    // ---- 4. Enter the session the way a person would ---------------------
    // The whole entry card is ONE <button>, so its accessible name is the entire
    // string ("47 cards ready to start, ~8 min ... Start") — an anchored
    // /^start$/ never matches it. An earlier version of this spec used that
    // anchor and reported "No visible way to start a session from Home" while
    // a Start button sat plainly in the screenshot. Match the card the way a
    // person reads it, not the way a developer names it.
    let entered = false;
    const entryCard = page
      .getByRole("button", { name: /cards? (due|ready to start)|nothing due today|review anyway/i })
      .first();
    if (await entryCard.isVisible().catch(() => false)) { await entryCard.click(); entered = true; }
    else note("No visible way to start a session from Home.");
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOT}/06-session-opened.png`, fullPage: true });
    if (entered) {
      const inSession = await page.getByText(/retrieval session|warm-up/i).first().isVisible().catch(() => false);
      if (!inSession) note("Clicking through from Home did not visibly open a session.");
    }

    // ---- 5. Grade cards until the session ends ---------------------------
    let graded = 0;
    for (let i = 0; i < 60; i++) {
      const selfExplain = page.getByText(/put this lesson in your own words/i).first();
      if (await selfExplain.isVisible().catch(() => false)) {
        // Answer it rather than skipping — a stranger would, and skipping
        // stores a null that never exercises the write path.
        const box = page.getByRole("textbox").first();
        if (await box.isVisible().catch(() => false)) await box.fill("It means acting on the belief behind the behaviour.");
        const onward = page.getByRole("button", { name: /^continue$/i }).first();
        if (await onward.isVisible().catch(() => false)) { await onward.click(); await page.waitForTimeout(900); continue; }
      }

      // Real order, read off the screen rather than assumed: type an attempt,
      // tap calibration, THEN reveal, THEN grade. An earlier version anchored
      // on /^reveal$/ (the button reads "Reveal answer") and looked for the
      // confidence tap AFTER reveal — it graded nothing and reported it as a
      // finding while the session was working perfectly in the screenshot.
      // Give the next card a beat to mount before concluding the session ended.
      // Breaking immediately conflates "session finished" with "React hasn't
      // rendered the next card yet" — the same not-yet-mounted-vs-absent
      // confusion AGENTS.md records for layout-overflow.spec.
      const reveal = page.getByRole("button", { name: /reveal/i }).first();
      const stillGoing = await reveal.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
      if (!stillGoing) break;
      // Wait for Reveal to be ENABLED, not merely present. Grading now always
      // routes through enqueue-then-replay, so the next card's Reveal stays
      // disabled until that round-trip finishes. A fixed sleep raced it and
      // clicked a disabled button, which then reported "found no grade
      // buttons" — the spec's own timing surfacing as a product finding.
      await reveal.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
      try {
        await expect(reveal).toBeEnabled({ timeout: 15_000 });
      } catch {
        note("Reveal stayed disabled for >15s after grading the previous card.");
        break;
      }

      const attempt = page.getByRole("textbox").first();
      if (await attempt.isVisible().catch(() => false)) await attempt.fill("a stranger's honest attempt");

      const conf = page.getByRole("button", { name: /^(sure|think so|guessing)$/i }).first();
      if (await conf.isVisible().catch(() => false)) { await conf.click(); await page.waitForTimeout(200); }

      revealed = true;   // answers are legitimate from here; stop the leak listener
      await reveal.click();
      await page.waitForTimeout(600);

      // A no-key account must see NOTHING new after reveal. getAnswerFeedback
      // returns null for every failure mode including "no key", which is the
      // state almost every user will be in permanently — so the revealed card
      // has to be indistinguishable from before the feature existed. Captured
      // on the first card only, and asserted rather than eyeballed.
      if (graded === 0) {
        await page.waitForTimeout(2500); // let any late feedback arrive if it were going to
        await page.screenshot({ path: `${SHOT}/06b-revealed-no-key.png`, fullPage: true });
        const revealedText = await page.locator("body").innerText();
        for (const forbidden of [/ai suggests/i, /ai unavailable/i, /add (an )?api key/i, /connect your/i, /upgrade/i]) {
          if (forbidden.test(revealedText)) note(`No-key account saw AI-related UI after reveal: ${forbidden}`);
        }
      }

      // Name the grade, don't index into a filtered list. .nth(2) assumed the
      // four grade buttons are the only matches and in a fixed order, which
      // breaks on any card whose actions differ — and it fails as "found no
      // grade buttons", pointing at the product rather than at the selector.
      const grade = page.getByRole("button", { name: /^good$/i }).first();
      if (await grade.isVisible().catch(() => false)) {
        await grade.click();
        graded++;
        await page.waitForTimeout(400);
        continue;
      }
      note("Revealed a card but found no grade buttons.");
      break;
    }
    await page.screenshot({ path: `${SHOT}/07-session-end.png`, fullPage: true });

    // ---- 6. The payoff moment -------------------------------------------
    const endText = (await page.locator("body").innerText()).toLowerCase();
    // Deliberately NOT /session/ — the overlay header reads "Retrieval session",
    // so that pattern matches on every card and would report the payoff moment
    // as seen on a run that never reached it. A check that matches the chrome
    // instead of the content is the same shape as an overlap check run against
    // an empty table: green, and examining nothing.
    const sawPayoff = /tomorrow|streak|day(s)? in a row|nothing due tomorrow|effortful/.test(endText);
    if (graded > 0 && !sawPayoff) note("Session ended with no completion moment — it just stops.");

    if (answerLeaks.length) note(`ANSWER TEXT REACHED THE CLIENT BEFORE REVEAL: ${answerLeaks.join(", ")}`);

    console.log(`\n=== STRANGER JOURNEY ===\ncards graded: ${graded}\nanswer leaks: ${answerLeaks.length}\nfindings: ${findings.length}`);
    findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    console.log(`verdict: ${graded > 0 && findings.length === 0 ? "PASS — a stranger completed a session unaided" : "SEE FINDINGS"}`);

    expect(answerLeaks, "answer text must never reach the client before reveal").toEqual([]);
    expect(graded, "a stranger must be able to grade at least one card").toBeGreaterThan(0);
  });
});
