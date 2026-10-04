import { type APIRequestContext, type Browser, type TestInfo, type test as PlaywrightTest } from "@playwright/test";

/**
 * Deen Mode (profiles.deen_mode) is per-account state that decides whether
 * Faith exists in the UI at all. Specs must therefore establish it themselves
 * -- never trust fixture state (the SEED account is legacy and its value is
 * whatever production last had; seed-domains is the OFF fixture).
 *
 * Talks to app/api/test/deen-mode (secret-gated, own profile only).
 */
function secretHeaders(): Record<string, string> {
  const secret = process.env.E2E_TEST_SECRET;
  if (!secret) throw new Error("E2E_TEST_SECRET not set -- see .env.local");
  return { "x-e2e-secret": secret };
}

export async function getDeenState(request: APIRequestContext): Promise<{ deenMode: boolean; prayerRows: number }> {
  const res = await request.get("/api/test/deen-mode", { headers: secretHeaders() });
  if (!res.ok()) throw new Error(`deen-mode GET failed: ${res.status()} ${await res.text()}`);
  return (await res.json()) as { deenMode: boolean; prayerRows: number };
}

export async function setDeenMode(request: APIRequestContext, on: boolean): Promise<void> {
  const res = await request.put("/api/test/deen-mode", { headers: secretHeaders(), data: { on } });
  if (!res.ok()) throw new Error(`deen-mode PUT failed: ${res.status()} ${await res.text()}`);
}

/** An authenticated request context for the CURRENT project's account (its storageState), usable inside beforeAll/afterAll where the page fixtures don't exist. */
async function withProjectRequest<T>(browser: Browser, testInfo: TestInfo, fn: (request: APIRequestContext) => Promise<T>): Promise<T> {
  const use = testInfo.project.use;
  const context = await browser.newContext({ baseURL: use.baseURL, storageState: use.storageState });
  try {
    return await fn(context.request);
  } finally {
    await context.close();
  }
}

/**
 * Registers beforeAll/afterAll on the calling spec file: before any test runs,
 * the project's account is put in the requested Deen Mode state; after the
 * file finishes, the PRIOR value is restored (so nothing a spec does here
 * leaks into the next one -- the run is fully serial against one live DB).
 *
 *   useDeenMode(test);          // Faith visible (default)
 *   useDeenMode(test, false);   // Faith stripped
 */
export function useDeenMode(test: typeof PlaywrightTest, on = true): void {
  let prior: boolean | null = null;

  test.beforeAll(async ({ browser }, testInfo) => {
    await withProjectRequest(browser, testInfo, async (request) => {
      prior = (await getDeenState(request)).deenMode;
      if (prior !== on) await setDeenMode(request, on);
    });
  });

  test.afterAll(async ({ browser }, testInfo) => {
    if (prior === null || prior === on) return;
    const restoreTo = prior;
    await withProjectRequest(browser, testInfo, (request) => setDeenMode(request, restoreTo));
  });
}
