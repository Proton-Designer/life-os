import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent, dismissCheckinToastIfPresent, fillReliably, clickAndSettle } from "./helpers";

/** Cold serverless starts can exceed the default 5s expect timeout — found live (2026-09-15) as a Mobile flake: the form still held the typed statement with "Add habit" disabled when the default timeout expired. Not a loosened assertion, a longer one for a real slow-but-correct path. */
const MUTATION_TIMEOUT = { timeout: 15_000 };

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
 *
 * `dismissCheckinToastIfPresent` guards every interaction that matters
 * here, proactively — its own header explains why (found live as a real
 * flaky failure in e2e/goals.spec.ts, 2026-09-15: the allocation check-in
 * toast fires on its own timer and can appear mid-test, unrelated to
 * anything this spec does).
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

    await dismissCheckinToastIfPresent(page);
    await addButton.click();
    await fillReliably(page.getByPlaceholder(/Identity statement/i), statement);
    await dismissCheckinToastIfPresent(page);
    // clickAndSettle, not a bare click: createIdentityHabitAction is a
    // server round trip (createIdentityHabitCore's rank pre-check query
    // plus the insert), and the form only unmounts once it resolves — a
    // cold serverless start can exceed the default 5s expect timeout on
    // the row assertions below (found live on Mobile, 2026-09-15) while
    // the write is still correctly in flight, not actually stuck.
    await clickAndSettle(page, page.getByRole("button", { name: "Add habit" }));

    const row = page.getByRole("listitem").filter({ hasText: statement });
    await expect(row).toBeVisible(MUTATION_TIMEOUT);
    await expect(row.getByText("New", { exact: true })).toBeVisible(MUTATION_TIMEOUT);
    await expect(countLabel).toHaveText(`${beforeCount + 1}/7`, MUTATION_TIMEOUT);

    // Vote — cast, via the toggle button's "not yet voted" state. Same
    // clickAndSettle reasoning: castHabitVoteAction is its own round trip.
    const voteButton = row.getByRole("button", { name: "Vote for this identity today" });
    await expect(voteButton).toBeVisible();
    await dismissCheckinToastIfPresent(page);
    await clickAndSettle(page, voteButton);
    const retractButton = row.getByRole("button", { name: "Retract today's vote" });
    await expect(retractButton).toBeVisible(MUTATION_TIMEOUT);

    // Retract — same button, now in its "voted" state.
    await dismissCheckinToastIfPresent(page);
    await clickAndSettle(page, retractButton);
    await expect(row.getByRole("button", { name: "Vote for this identity today" })).toBeVisible(MUTATION_TIMEOUT);
  } finally {
    await page.request
      .delete(`${baseURL}/api/test/clear-habit`, { headers: { "x-e2e-secret": secret! }, data: { identityStatement: statement } })
      .catch(() => undefined);
  }
});
