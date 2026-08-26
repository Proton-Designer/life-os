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

// HELD — 2026-08-26, Opus Lead's call. RealtimeSyncProvider is NOT mounted
// (see the comment in components/shell/app-shell-chrome.tsx), so this test
// is red by construction until it's re-enabled. Skipped rather than deleted
// because the mechanism, the migration, the debounce logic, and the RLS
// negative test are all real and want to ship tomorrow — only the mount
// point and this test are dormant.
//
// What's confirmed working (verified live against the real DB tonight):
//   - supabase/migrations/049_realtime_publication.sql is applied; all 9
//     tables are in the `supabase_realtime` publication.
//   - RLS is enforced on the postgres_changes stream itself, independent of
//     the client-side `filter:` — proved with an unfiltered subscription as
//     SEED plus a synthetic other-user row inserted directly via SQL: SEED
//     received nothing for the other user's row.
//   - RealtimeSyncProvider's debounce (burst of writes -> one refresh) and
//     unmount cleanup are unit-tested and correct
//     (components/realtime/__tests__/realtime-sync-provider.test.tsx).
//   - Found and fixed a real bug: React Strict Mode's dev-only
//     double-invoke was sending the server a phx_join immediately followed
//     by a phx_leave for the SAME (schema, table, filter) content before
//     the first join's reply ever came back. Deferring the actual
//     `channel.subscribe()` call by one microtask means the phantom first
//     mount's cleanup cancels it before any phx_join is sent, so only the
//     mount that survives to the next tick ever joins — no join/leave
//     churn at all. This is real and correct, but it turned out NOT to be
//     the reason events go missing (see below).
//
// What's still broken, unexplained, and the actual reason this is held:
//   A standalone Node script (supabase-js directly, no @supabase/ssr, no
//   React) that signs in, subscribes to `prayers` with the exact same
//   filter our provider uses, and waits for a raw SQL INSERT/UPDATE,
//   RELIABLY receives the postgres_changes event — reproduced repeatedly,
//   including with 9 tables bound on one channel (matching the provider
//   exactly) and with a filter list containing the SEED user's id.
//
//   The real browser app, from a clean single mount (confirmed SUBSCRIBED,
//   correct access token attached to the socket, server-echoed binding ids
//   matching what was requested), INTERMITTENTLY receives nothing for a
//   live write — reproduced multiple times tonight, including immediately
//   after a full dev-server restart with no other tab, script, or test
//   context connected. Ruled out as the cause: auth timing (session is
//   present and attached before SUBSCRIBED fires), the Strict-Mode churn
//   above (fixed, problem persisted), multi-table binding (works fine in
//   the isolated Node reproduction), and the client-side filter string
//   (byte-identical to the working Node case). Not ruled out: something
//   server-side about multiple simultaneous or recently-superseded
//   subscriptions to identical (schema, table, filter) content — the
//   server assigns the SAME numeric binding id to that content across
//   unrelated channels/connections, which smells like a shared/dedup'd
//   registration that this session did not get to the bottom of.
//
// Next engineer: don't re-derive the above — start by reproducing the
// "isolated Node script works, live single-tab browser session doesn't"
// split with fresh debug instrumentation, then chase the server-side dedup
// theory specifically (e.g. what happens with only ONE ever-connected
// subscriber to that filter content, in total, project-wide, at the time
// of the write).
test.describe.skip("Cross-device realtime sync — HELD, see the block comment above", () => {
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
});
