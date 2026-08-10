import { test, expect } from "@playwright/test";

// Relies on the shared authenticated session (e2e/auth.setup.ts).
test("kill list: completing an item reflects on the Business page", async ({ page }) => {
  await page.goto("/business");

  const slots = page.locator("ul").first().locator("> li");
  await expect(slots).toHaveCount(3);

  // Deliberately does not fill empty slots with test data: setKillListItem
  // has no way to write an item back to empty (components/business/kill-list.tsx's
  // submit() rejects blank text before ever calling it), so any slot this
  // test populated would leave permanently fabricated "E2E test item" text
  // in the real account with no revert path. Only exercises the (fully
  // reversible) completion toggle on a slot that already has real content.
  let targetIndex = -1;
  const slotCount = await slots.count();
  for (let i = 0; i < slotCount; i++) {
    if (await slots.nth(i).getByRole("button", { name: "Mark complete" }).count()) {
      targetIndex = i;
      break;
    }
  }
  if (targetIndex === -1) {
    test.skip(true, "No populated, not-yet-completed kill-list slot in this account — nothing to toggle in this run");
  }

  // Pinned to a positional slot locator, not a "Mark complete" role/name
  // locator — that locator re-queries live and would silently jump to a
  // different slot once this one's accessible name flips to "Mark incomplete"
  // mid-test.
  const slot = slots.nth(targetIndex);

  await slot.getByRole("button", { name: "Mark complete" }).click();
  await expect(slot.getByRole("button", { name: "Mark incomplete" })).toBeVisible();

  await slot.getByRole("button", { name: "Mark incomplete" }).click();
  await expect(slot.getByRole("button", { name: "Mark complete" })).toBeVisible();
});
