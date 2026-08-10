import { test as setup } from "@playwright/test";
import path from "path";
import { login } from "./helpers";

// Runs once before the Desktop/Mobile Chrome projects (see the "setup"
// project + dependencies in playwright.config.ts) and saves a real
// authenticated session to disk, so every other spec starts already signed
// in instead of each doing its own fresh password sign-in — 16 independent
// logins in a single run tripped Supabase Auth's sign-in rate limit the
// first time this suite ran twice in a row.
const authFile = path.resolve(__dirname, "../playwright/.auth/user.json");

setup("authenticate", async ({ page }) => {
  await login(page);
  await page.context().storageState({ path: authFile });
});
