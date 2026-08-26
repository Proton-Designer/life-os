import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

// 2026-08-25/26 batch 2, item 2 — Ayman: "when i have the app open on my
// laptop and my phone, and i make a change on my phone, it doesnt display
// at all on my macbook, and vice versa." Two REAL, independent browser
// contexts sharing the same SEED session (simulating his two devices) —
// a single-context test proves nothing about this bug, since one page
// already has the fresh data from its own navigation/action.
//
// Uses Maghrib specifically — distinct from deen.spec.ts's Isha and
// sunnah-disclosure.spec.ts's Asr, so this spec never races either of
// those over the same `prayers` row when the suite runs.
const PRAYER_NAME = "maghrib";
const PRAYER_LABEL = "Maghrib";

// RE-ENABLED 2026-08-26 (batch 2, afternoon). Root cause found, fixed, and
// proven with a deterministic (non-flaky) repro — full writeup below for
// anyone who needs the history; the mechanism this test exercises is no
// longer held.
//
// ROOT CAUSE: a channel's postgres_changes RLS scoping is fixed at JOIN
// time. `createBrowserClient`'s session restore from cookies is
// asynchronous (GoTrueClient.initialize()); the previous provider deferred
// `channel.subscribe()` by only one microtask (a fix for a real but
// SEPARATE bug — see below), which is nowhere near long enough to
// guarantee the session has finished restoring. When `subscribe()` won
// that race, the join went out under the anon role. RLS then matched zero
// rows for postgres_changes on that channel FOREVER — and critically, the
// channel still reported SUBSCRIBED, and a later `realtime.setAuth()`
// call (the SDK's own internal auth-state listener catching up, or an
// explicit call) updated the socket's general auth but did NOT
// retroactively re-scope the already-established postgres_changes
// registration. This is why the symptom looked "healthy": correct filter,
// correct eventual access token on the socket, SUBSCRIBED status — and
// still zero events, permanently, for that one page load.
//
// Proven deterministically (no browser, no timing luck) with a standalone
// script: subscribe with only the anon key attached, THEN sign in
// (triggering the SDK's normal self-heal `setAuth()` push) — the event
// never arrives. Reverse the order — resolve the session BEFORE
// subscribing — and the identical write arrives in well under a second,
// every time. This is why the previous investigation's "auth timing ruled
// out" conclusion was wrong: it checked whether the socket held a correct
// token by the time SUBSCRIBED fired, which is always true (the post-join
// self-heal guarantees it) — not whether the token was already correct at
// the moment the join was SENT, which is the actual determining factor.
//
// FIX: RealtimeSyncProvider (components/realtime/realtime-sync-provider.tsx)
// now `await`s `supabase.auth.getSession()` and explicitly calls
// `supabase.realtime.setAuth(session.access_token)` itself BEFORE ever
// building the channel — never subscribing first and trusting the SDK's
// internal listener to have already caught up. This also naturally
// subsumes the earlier Strict-Mode double-invoke fix (a real, separate bug
// — the dev-only double-invoke sent a phx_join immediately followed by a
// phx_leave for the same filter content, which the one-microtask defer
// dodged): the join is now gated behind a genuinely async step, so a
// phantom first mount's cleanup always cancels before that step resolves.
//
// Also confirmed still holding from the original investigation: RLS is
// enforced on the postgres_changes stream itself, independent of the
// client-side `filter:` (an unfiltered subscription as SEED, plus a
// synthetic other-user row inserted directly via SQL, received nothing for
// the other user's row); debounce and unmount cleanup are unit-tested
// (components/realtime/__tests__/realtime-sync-provider.test.tsx, which
// now also covers the session-restore race directly with a mocked delayed
// getSession()).
test.describe("Cross-device realtime sync", () => {
  test("marking a prayer in one browser context reflects in a second context, with no manual reload or interaction there", async ({
    browser,
    baseURL,
  }) => {
    const secret = process.env.E2E_TEST_SECRET;
    test.skip(!secret, "E2E_TEST_SECRET not set — see .env.local");

    // Both contexts share the SAME SEED session (playwright/.auth/user.json)
    // via the project's own storageState — two independent "devices," one
    // account, exactly Ayman's reported scenario.
    const contextA = await browser.newContext({ storageState: "playwright/.auth/user.json" });
    const contextB = await browser.newContext({ storageState: "playwright/.auth/user.json" });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // Establish a known starting state before either page loads it —
      // same residual-state discipline as every other prayer-status spec
      // in this suite (prayer-row.tsx deletes on a repeat tap of the
      // active status, so a stale prior run inverts the first click).
      const cleanup = await pageA.request.delete(`${baseURL}/api/test/clear-prayer`, {
        headers: { "x-e2e-secret": secret! },
        data: { prayerName: PRAYER_NAME },
      });
      expect(cleanup.ok()).toBe(true);

      await pageA.goto("/deen");
      await dismissCheckinDialogIfPresent(pageA);
      await pageB.goto("/deen");
      await dismissCheckinDialogIfPresent(pageB);

      const salahPanelA = pageA
        .locator("[data-panel]")
        .filter({ has: pageA.getByText("Salah", { exact: true }) });
      const salahPanelB = pageB
        .locator("[data-panel]")
        .filter({ has: pageB.getByText("Salah", { exact: true }) });
      const rowA = salahPanelA.locator("li", { hasText: PRAYER_LABEL });
      const rowB = salahPanelB.locator("li", { hasText: PRAYER_LABEL });

      // Baseline: neither page shows it logged yet.
      await expect(rowB.getByRole("button", { name: "On-time" }).locator("span")).not.toHaveClass(
        /text-accent-business/
      );

      // Give both contexts' RealtimeSyncProvider a moment to actually
      // reach SUBSCRIBED (a real websocket join round trip, deferred by
      // one tick to dodge React Strict Mode's dev-only double-invoke —
      // see the component's own comment) before the mutation fires. A
      // write that lands before the subscription is live is invisible to
      // it by definition, independent of whether sync itself works.
      await pageB.waitForTimeout(1500);

      // The mutation happens in context A only. Context B is never
      // clicked, reloaded, or otherwise driven again after this point —
      // any change it shows has to have arrived via the realtime
      // subscription's own router.refresh(), not this test.
      await rowA.getByRole("button", { name: "On-time" }).click();

      // Debounce (400ms) + a real RSC round trip — generous but bounded
      // timeout, no manual reload on B in between.
      await expect(rowB.getByRole("button", { name: "On-time" }).locator("span")).toHaveClass(
        /text-accent-business/,
        { timeout: 10_000 }
      );
    } finally {
      const restore = await pageA.request.delete(`${baseURL}/api/test/clear-prayer`, {
        headers: { "x-e2e-secret": secret! },
        data: { prayerName: PRAYER_NAME },
      });
      expect(restore.ok()).toBe(true);
      await contextA.close();
      await contextB.close();
    }
  });

  // Migration 053 (2026-08-26, same batch): Work (co_op) writes exclusively
  // to coop_tasks/coop_targets, a completely separate table family from
  // the shared `tasks` table School/Business/etc. use — it was NOT in the
  // realtime publication until this batch, so it was the one domain where
  // "logging tasks from any screen and domain" (Ayman's own words) still
  // silently didn't sync. Same two-context shape as the prayer test above,
  // proving the UI path end to end — not just that the table is in the
  // publication, which the mechanism being identical to the working tables
  // is exactly the kind of assumption that would let a real gap through.
  test("advancing a Work task's stage in one browser context reflects in a second context, with no manual reload or interaction there", async ({
    browser,
    baseURL,
  }) => {
    const secret = process.env.E2E_TEST_SECRET;
    test.skip(!secret, "E2E_TEST_SECRET not set — see .env.local");

    const contextA = await browser.newContext({ storageState: "playwright/.auth/user.json" });
    const contextB = await browser.newContext({ storageState: "playwright/.auth/user.json" });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // The Pipeline board only renders with an active position-1 target —
      // SEED has none by default, so this test establishes its own known
      // task in Backlog before either page loads (same discipline as the
      // prayer test's clear-prayer call above).
      const setup = await pageA.request.post(`${baseURL}/api/test/reset-coop-pipeline`, {
        headers: { "x-e2e-secret": secret! },
      });
      expect(setup.ok()).toBe(true);
      const { taskTitle } = (await setup.json()) as { taskTitle: string };

      await pageA.goto("/work");
      await pageB.goto("/work");

      // The same task also renders in the Weekly Agenda panel (each with
      // its own "Advance a stage" button) — scope to the Pipeline panel
      // specifically, same [data-panel] discipline as the Deen/Salah test
      // above, rather than assuming the task's title or button is unique
      // on the page.
      const pipelinePanelA = pageA.locator("[data-panel]").filter({ has: pageA.getByText("Pipeline", { exact: true }) });
      const pipelinePanelB = pageB.locator("[data-panel]").filter({ has: pageB.getByText("Pipeline", { exact: true }) });

      // Baseline: the task is in Backlog on both pages, not In Progress.
      await expect(pipelinePanelB.getByText("Backlog (1)")).toBeVisible();

      // Give both contexts' RealtimeSyncProvider a moment to actually
      // reach SUBSCRIBED before the mutation fires — same reasoning as the
      // prayer test's wait above.
      await pageB.waitForTimeout(1500);

      // The mutation happens in context A only — context B is never
      // clicked, reloaded, or otherwise driven again after this point.
      await pipelinePanelA.getByRole("button", { name: "Advance a stage" }).click();

      // Debounce (400ms) + a real RSC round trip — B's board should move
      // the task out of Backlog and into In Progress with no reload.
      await expect(pipelinePanelB.getByText("In Progress (1)")).toBeVisible({ timeout: 10_000 });
      await expect(pipelinePanelB.getByText("Backlog (0)")).toBeVisible();
    } finally {
      const cleanup = await pageA.request.delete(`${baseURL}/api/test/reset-coop-pipeline`, {
        headers: { "x-e2e-secret": secret! },
      });
      expect(cleanup.ok()).toBe(true);
      await contextA.close();
      await contextB.close();
    }
  });
});
