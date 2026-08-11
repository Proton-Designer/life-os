import { Page, expect } from "@playwright/test";

export async function login(page: Page) {
  const email = process.env.SEED_USER_EMAIL;
  const password = process.env.SEED_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("SEED_USER_EMAIL / SEED_USER_PASSWORD must be set (see .env.local)");
  }

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

// The real CheckinScheduler (lib/checkins/compute-checkin-slots.ts) mounts on
// every authenticated page and can pop its Dialog the moment a check-in slot
// is genuinely due for this real account — independent of anything a given
// spec is testing, and it covers the page and intercepts clicks when it does.
// Escape triggers the Dialog's onOpenChange(false) → snoozeCheckin(), which
// deliberately persists nothing (a snooze isn't an answer, per Task 10.2), so
// this is safe to call defensively without altering real account data.
export async function dismissCheckinDialogIfPresent(page: Page) {
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
}
