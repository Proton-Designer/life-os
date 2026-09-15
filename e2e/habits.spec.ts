import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent, fillReliably } from "./helpers";

/**
 * Habits (#39/#40/#41): creates a real identity habit, confirms the N/7
 * counter increments and it shows "New" (under 7 local days old — score
 * stays hidden, per the ruling "refuses to judge early"), casts today's
 * vote, then retracts it. The decay-score MATH itself (0.96/day, closed
 * form) is covered by lib/habits/__tests__/decay-score.test.ts's unit
 * tests — this only proves the vote round trip is wired to the real UI.
 *
 * MUTATING: creates a real `identity_habits` row on SEED. There is no
 * delete UI (Phase 1 ships archive only, one-way — pause/freeze/resume is
 * ruled Phase 2+) — cleanup runs in `finally` via app/api/test/clear-habit
 * (its own header explains why it exists).
 */
test("create a habit, see N/7 and New, vote for today, then retract", async ({ page, baseURL }) => {
  const secret = process.env.E2E_TEST_SECRET;
  if (!secret) {
    test.skip(true, "E2E_TEST_SECRET not set — see .env.local");
  }

  const statement = `e2e-habit-${Date.now()}`;

  try {
    await page.goto("/habits");
    await dismissCheckinDialogIfPresent(page);

    const addButton = page.getByRole("button", { name: "+ Add an identity habit" });
    if (!(await addButton.isVisible())) {
      test.skip(true, "This account's 7 active habits are already full — no room to add a test habit without archiving a real one first.");
    }

    // Baseline count BEFORE adding, so "N/7" is checked as a real increment
    // rather than assuming this real account starts at 0/7.
    const countLabel = page.getByText(/^\d\/7$/);
    const beforeText = await countLabel.textContent();
    const beforeCount = Number(beforeText?.split("/")[0]);
    expect(Number.isFinite(beforeCount), `could not parse a baseline count from "${beforeText}"`).toBe(true);

    await addButton.click();
    await fillReliably(page.getByPlaceholder(/Identity statement/i), statement);
    await page.getByRole("button", { name: "Add habit" }).click();

    const row = page.getByRole("listitem").filter({ hasText: statement });
    await expect(row).toBeVisible();
    await expect(row.getByText("New", { exact: true })).toBeVisible();
    await expect(countLabel).toHaveText(`${beforeCount + 1}/7`);

    // Vote — cast, via the toggle button's "not yet voted" state.
    const voteButton = row.getByRole("button", { name: "Vote for this identity today" });
    await expect(voteButton).toBeVisible();
    await voteButton.click();
    const retractButton = row.getByRole("button", { name: "Retract today's vote" });
    await expect(retractButton).toBeVisible();

    // Retract — same button, now in its "voted" state.
    await retractButton.click();
    await expect(row.getByRole("button", { name: "Vote for this identity today" })).toBeVisible();
  } finally {
    await page.request
      .delete(`${baseURL}/api/test/clear-habit`, { headers: { "x-e2e-secret": secret! }, data: { identityStatement: statement } })
      .catch(() => undefined);
  }
});
