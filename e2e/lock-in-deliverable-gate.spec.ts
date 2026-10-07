import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent, fillReliably, openLockInSetup } from "./helpers";

/**
 * #37 (f042c80, ruled 2026-09-14): every Lock-In session — not a distinct
 * "Hour" type — is gated on naming a real deliverable. This spec checks
 * the gate itself: Start stays disabled, with a VISIBLE reason (never a
 * silently unclickable button), until an objective is named; a duration
 * alone is not enough.
 *
 * Non-mutating on purpose: never clicks Start, so no `work_sessions` row
 * is ever created here and there is nothing to tear down. The actual "a
 * named objective lets it start" round trip is exercised by
 * e2e/lock-in-overlay.spec.ts's own startSession() helper — this spec's
 * whole job is the disabled/hint state BEFORE that point.
 */
test("Lock In — Deep Work: Start stays disabled, with its reason visible, until an objective is named", async ({ page }) => {
  await page.goto("/");
  await dismissCheckinDialogIfPresent(page);

  await openLockInSetup(page, "Deep Work");
  const dialog = page.getByRole("dialog", { name: /set a goal/i });
  await expect(dialog).toBeVisible();

  const startButton = dialog.getByRole("button", { name: "Start" });
  await expect(startButton).toBeDisabled();

  // Duration alone is not the gate -- goalMinutes is one of several
  // canStart conditions, not the whole thing.
  await fillReliably(dialog.getByLabel("Duration in minutes"), "25");
  await expect(startButton).toBeDisabled();
  const hint = dialog.getByText("What will you produce? Select an objective or add one above.");
  await expect(hint).toBeVisible();

  // Naming an objective satisfies hasDeliverable -- Start enables and the
  // hint (which only shows while duration+class are set but no objective
  // exists yet) disappears.
  await fillReliably(dialog.getByLabel("Custom objective"), `e2e-gate-check-${Date.now()}`);
  await expect(startButton).toBeEnabled();
  await expect(hint).toBeHidden();

  // Close without starting -- this spec creates no session.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
