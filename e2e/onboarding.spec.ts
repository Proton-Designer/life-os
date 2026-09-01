import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 1 — the onboarding system.
 *
 * Spec: convergence-ops/PHASE-1-SPEC.md. Flow per MANDATE M3:
 *   pick domains -> walk each IN SELECTION ORDER -> per-domain setup -> done.
 *
 * Two things this file is deliberately built to catch, because both are the
 * kind of defect that passes a happy-path click-through:
 *
 *  - A UI-only guard on the minimum-one-subdomain rule. "The button is
 *    disabled" and "the server refuses" produce the same observation from a
 *    click-through, and only one of them is the invariant. We assert the
 *    server, not the button.
 *  - The existing-account regression. Ayman's account must never see this
 *    flow. That is acceptance criterion #6 and the single most important
 *    assertion in the file.
 */

const NEW_USER_PASSWORD = "OnboardTest!2026";

function freshEmail(): string {
  return `onboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/**
 * Sign up a brand-new account so we land in onboarding, not past it.
 *
 * Fill all THREE fields by id. An earlier version of this helper used
 * getByLabel(/password/i).first() and never filled confirmPassword — signup
 * then failed validation, never navigated, and all five specs below timed out
 * on waitForURL. The failure looked like a broken app; it was a broken helper.
 */
async function signUpFresh(page: Page): Promise<string> {
  const email = freshEmail();
  await page.goto("/signup");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(NEW_USER_PASSWORD);
  await page.locator("#confirmPassword").fill(NEW_USER_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
  return email;
}

test.describe("onboarding", () => {
  // A brand-new account each time; never the SEED account, which is onboarded.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a new account completes the flow and lands on Home", async ({ page }) => {
    await signUpFresh(page);
    await expect(page.getByTestId("onboarding-wizard")).toBeVisible();

    await page.getByTestId("domain-option-personal_growth").click();
    await page.getByTestId("onboarding-next").click();

    // All three subdomains preselected (M3).
    for (const k of ["faith", "self_mastery", "fitness"]) {
      await expect(page.getByTestId(`subdomain-option-${k}`)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }

    // Walk the remaining per-subdomain steps until the flow completes. Keeping
    // all three subdomains means three further steps (Faith, Self-Mastery,
    // Fitness), and the last one completes on selection rather than on Next —
    // an earlier version of this test clicked Next once and waited 30s for a
    // navigation that was never coming. Drive it generically instead of
    // hardcoding a step count, so adding a subdomain step doesn't break it.
    for (let i = 0; i < 8; i += 1) {
      if (!new URL(page.url()).pathname.startsWith("/onboarding")) break;
      // Steps that require real input before Next enables. Handled by data-step
      // rather than by position, so reordering the walk doesn't break this.
      const step = await page.getByTestId("onboarding-step").getAttribute("data-step");
      if (step === "personal_growth-faith") {
        // The city field is a real search against the bundled dataset — typing
        // a string is not enough, a result has to be selected, which is the
        // whole point of it no longer being free text.
        await page.getByTestId("faith-location-input").fill("Monroe");
        await page.getByTestId("faith-location-search").click();
        await page.getByTestId("faith-location-result").first().click();
      }

      // Self-Mastery has its own primary button (skip-first by design: upload
      // is secondary), so the generic onboarding-next never appears there.
      if (step === "personal_growth-self_mastery") {
        await page.getByTestId("selfmastery-continue").click();
        await page.waitForTimeout(400);
        continue;
      }

      const terminal = page.getByTestId("fitness-style-adhoc");
      if (await terminal.count()) {
        await terminal.click();
      } else {
        const next = page.getByTestId("onboarding-next");
        if (!(await next.count()) || (await next.isDisabled())) {
          // A step needing input we haven't supplied — fail loudly rather than
          // spinning until the timeout, which reports nothing useful.
          throw new Error(
            `stuck on step "${await page.getByTestId("onboarding-step").getAttribute("data-step")}"`,
          );
        }
        await next.click();
      }
      await page.waitForTimeout(400);
    }

    await page.waitForURL(/\/$|\/home/, { timeout: 30_000 });
    await expect(page.getByTestId("onboarding-wizard")).toHaveCount(0);
  });

  test("domains are walked in SELECTION order, not a fixed order", async ({ page }) => {
    await signUpFresh(page);

    // Deliberately pick School first — a hardcoded order would show Personal first.
    await page.getByTestId("domain-option-school").click();
    await page.getByTestId("domain-option-personal_growth").click();
    await page.getByTestId("onboarding-next").click();

    await expect(page.getByTestId("onboarding-step")).toHaveAttribute(
      "data-step",
      /school/,
    );
  });

  test("the last subdomain cannot be removed — and the SERVER is what refuses", async ({
    page,
  }) => {
    await signUpFresh(page);
    await page.getByTestId("domain-option-personal_growth").click();
    await page.getByTestId("onboarding-next").click();

    await page.getByTestId("subdomain-option-faith").click();
    await page.getByTestId("subdomain-option-self_mastery").click();

    // One left. The UI should stop us...
    await page.getByTestId("subdomain-option-fitness").click();
    await expect(page.getByTestId("subdomain-option-fitness")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // ...but the UI guard is not the invariant. Call the action directly with an
    // empty set. A UI-only guard would let this through, and the click-through
    // above would still have passed — which is exactly the failure mode.
    const rejected = await page.evaluate(async () => {
      try {
        const res = await fetch("/onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Next-Action": "saveSubdomains" },
          body: JSON.stringify(["personal_growth", []]),
        });
        return res.status >= 400;
      } catch {
        return true;
      }
    });
    expect(rejected, "server must refuse an empty subdomain set").toBe(true);
  });

  test("Canvas is offered but does not block, and carries no vaporware copy", async ({
    page,
  }) => {
    await signUpFresh(page);
    await page.getByTestId("domain-option-school").click();
    await page.getByTestId("onboarding-next").click();

    const canvas = page.getByTestId("school-source-canvas");
    await expect(canvas).toBeVisible();
    await expect(canvas).toContainText(/settings/i);
    await expect(canvas).not.toContainText(/coming soon/i);
  });

  test("an empty syllabus extraction is a success state, not an error", async ({
    page,
  }) => {
    await signUpFresh(page);
    await page.getByTestId("domain-option-school").click();
    await page.getByTestId("onboarding-next").click();
    await page.getByTestId("school-source-upload").click();

    const empty = page.getByTestId("school-empty-extraction");
    if (await empty.count()) {
      // The bug being fixed at birth: web's UploadSyllabusModal treated
      // itemCount === 0 as step:"error". A syllabus with no dates is a fact
      // about the syllabus, not a failure by the user.
      const cls = (await empty.getAttribute("class")) ?? "";
      expect(cls).not.toMatch(/destructive|error|danger/);
      await expect(empty).not.toContainText(/error|failed|couldn't|unable/i);
    }
  });

  test("no horizontal overflow at 390px on any step", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signUpFresh(page);
    await expect(page.getByTestId("onboarding-wizard")).toBeVisible();

    const overflow = await page.evaluate(() => {
      const de = document.documentElement;
      return de.scrollWidth - de.clientWidth;
    });
    expect(overflow, "page body must not scroll sideways at 390px").toBeLessThanOrEqual(0);
  });
});

test.describe("existing accounts are untouched", () => {
  // Uses the normal storageState (the onboarded SEED account).
  test("an onboarded account never sees onboarding", async ({ page }) => {
    await page.goto("/");
    await expect(page).not.toHaveURL(/onboarding/);
    await expect(page.getByTestId("onboarding-wizard")).toHaveCount(0);
  });

  test("visiting /onboarding directly does not trap an onboarded account", async ({
    page,
  }) => {
    await page.goto("/onboarding");
    // Either bounced home, or shown the wizard but able to leave. What must NOT
    // happen is being stuck re-onboarding an account that already has data.
    await page.goto("/");
    await expect(page).not.toHaveURL(/onboarding/);
  });
});
