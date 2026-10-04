import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent, settleRoute } from "./helpers";

// IA-P3: Goals, Habits, Worries and Weekly Review left the nav; their URLs redirect (checked below).
const ROUTES: { name: string; href: string }[] = [{ name: "Insights", href: "/insights" }];
const RETIRED = ["Goals", "Habits", "Worries", "Weekly Review"];
const RETIRED_URLS: { href: string; lands: RegExp }[] = [
  { href: "/goals", lands: /\/week(#goals)?$/ },
  { href: "/habits", lands: /\/week(#habits)?$/ },
  { href: "/worries", lands: /\/week(#worries)?$/ },
  { href: "/weekly-review", lands: /\/(week|insights)(\?tab=week)?$/ },
];

/**
 * Reachability, not just existence — the same "no reader = not done" bar
 * CLAUDE.md sets for a mechanism, extended to nav: a route with no
 * reachable link is exactly as unreachable as a query with no caller. Each
 * of these four routes had this exact gap at some point this phase
 * (existed and worked by direct URL only) before being wired in.
 *
 * Runs under BOTH the "Desktop Chrome" and "Mobile Chrome" projects
 * (legacy SEED account, playwright.config.ts) without any project-specific
 * code: desktop finds them directly in SidebarNav's REVIEW section; mobile
 * must open MobileIsland's "More" popover first, since none of the four
 * are in its fixed 6-icon row (components/shell/mobile-island.tsx).
 */
test("Insights is reachable from the legacy nav; the four retired screens are not listed and their URLs redirect", async ({ page }) => {
  await page.goto("/");
  await dismissCheckinDialogIfPresent(page);
  // Same class of race the Lead found in goals.spec.ts's skip guard
  // (flagged by ritual-builder, 2026-09-15): an isVisible() read right
  // after goto()/dismiss, with no prior wait for the page to actually
  // settle, can catch the DOM before hydration/layout has decided desktop
  // vs. mobile chrome, and read the wrong one. Different failure mode here
  // — a race would fail loudly on the toHaveAttribute checks below rather
  // than silently pass — but the fix is the same: anchor on a real settle
  // point (the route-skeleton-fade-in signal) before the instant read.
  await settleRoute(page);

  // Present on both surfaces, but only VISIBLE on mobile (MobileIsland's
  // `<nav>` is `lg:hidden`) — `.isVisible()`, not `.count()`, is what tells
  // desktop and mobile apart here.
  const moreButton = page.getByRole("button", { name: /^more$/i });
  if (await moreButton.isVisible()) {
    await moreButton.click();
  }

  for (const { name, href } of ROUTES) {
    await expect(page.getByRole("link", { name })).toHaveAttribute("href", href);
  }
  for (const name of RETIRED) {
    await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  }
  for (const { href, lands } of RETIRED_URLS) {
    await page.goto(href);
    await expect(page).toHaveURL(lands);
  }
});
