import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

const ROUTES: { name: string; href: string }[] = [
  { name: "Goals", href: "/goals" },
  { name: "Habits", href: "/habits" },
  { name: "Worries", href: "/worries" },
  { name: "Weekly Review", href: "/weekly-review" },
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
test("Goals, Habits, Worries, and Weekly Review are all reachable from the legacy nav", async ({ page }) => {
  await page.goto("/");
  await dismissCheckinDialogIfPresent(page);

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
});
