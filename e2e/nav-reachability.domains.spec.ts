import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

const ROUTES: { name: string; href: string }[] = [
  { name: "Goals", href: "/goals" },
  { name: "Habits", href: "/habits" },
  { name: "Worries", href: "/worries" },
  { name: "Weekly Review", href: "/weekly-review" },
];

/**
 * Same reachability proof as nav-reachability.spec.ts, for the domains-mode
 * pair (TabAppSidebar/TabSidebarNav + TabMobileIsland) — a genuinely
 * different component tree from the legacy one (components/shell/
 * app-shell-chrome.tsx branches on `navMode`), not a CSS variant of it, so
 * it needs its own proof.
 *
 * Runs under the "Domains Fixture" project (Pixel 7 device, seed-domains
 * storageState, playwright.config.ts). BOTH TabSidebarNav (`hidden
 * lg:flex`) and TabMobileIsland (`lg:hidden`) are ALWAYS mounted together
 * for a domains-mode account (app-shell-chrome.tsx) — only CSS decides
 * which one is visible at a given width — so this exercises both by
 * resizing the SAME page rather than needing a second Playwright project.
 */
test.describe("domains-mode nav reachability", () => {
  test("mobile: reachable via TabMobileIsland's More popover", async ({ page }) => {
    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);

    await page.getByRole("button", { name: /^more$/i }).click();
    for (const { name, href } of ROUTES) {
      await expect(page.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  test("desktop: reachable directly in TabSidebarNav, no popover needed", async ({ page }) => {
    // Past the lg breakpoint -- reveals TabAppSidebar's desktop rail
    // (icon-only or labeled, whichever width lands on) and hides
    // TabMobileIsland's floating pill, same CSS toggle the legacy pair
    // uses. The accessible name includes a label even in icon-rail mode
    // (rendered sr-only, not omitted — components/shell/tab-sidebar-nav.tsx
    // mirrors SidebarNav's own convention here), so this assertion doesn't
    // depend on which of the two desktop widths this lands on.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);

    for (const { name, href } of ROUTES) {
      await expect(page.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });
});
