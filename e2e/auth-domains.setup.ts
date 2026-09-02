import { test as setup, expect } from "@playwright/test";
import path from "path";

/**
 * A SECOND authenticated session, for the domains-mode fixture account.
 *
 * WHY A SECOND ACCOUNT AND NOT A SEEDED SEED (R41): the app genuinely has two
 * modes. SEED (`ayman.mohammed@newtonbev.com`) has zero `user_domains` rows, so
 * it resolves to `mode: "legacy"` and every visibility check short-circuits on
 * `isLegacy ||` before reaching a single line of domains-mode code. That is not
 * a gap in a spec — it means the whole suite is structurally incapable of
 * reaching that half of the product, and it let a regression through that
 * removed Faith, Fitness and Self-Mastery from Home. Both accounts are
 * permanent fixtures; neither is the "real" one.
 *
 * WHY ITS OWN FILE AND ITS OWN PATH: two concurrent `auth.setup` processes
 * writing one `storageState` left a complete JSON object followed by a
 * fragment, and every test in the run then failed with
 * `SyntaxError: Unexpected non-whitespace character after JSON` — which reads
 * exactly like broken authentication (AGENTS.md). Two accounts, two files, and
 * never two writers on one path.
 */
const authFile = path.resolve(__dirname, "../playwright/.auth/seed-domains.json");

setup("authenticate domains fixture", async ({ page }) => {
  const email = process.env.SEED_DOMAINS_USER_EMAIL;
  const password = process.env.SEED_DOMAINS_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("SEED_DOMAINS_USER_EMAIL / SEED_DOMAINS_USER_PASSWORD must be set (see .env.local)");
  }

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Extended for a cold serverless start, same reason as helpers.login().
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });

  await page.context().storageState({ path: authFile });
});
