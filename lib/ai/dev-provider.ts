/**
 * The dev-only local provider (R22 / boss-handoff `08-DEV-PROVIDER-SCOPE.md`).
 * A localhost shim (`scripts/dev-provider-shim.mjs`), backed by a headless
 * `claude -p` with ALL tools disabled (`--tools ""`), speaking the OpenAI
 * chat-completions wire — so ingestion can be exercised end to end before a
 * real DeepSeek key exists. It is not a cost measurement and not a quality
 * baseline for DeepSeek.
 *
 * DELIBERATELY NOT IN `PROVIDERS` (./providers.ts), and never will be:
 * `user_api_keys.provider` is `check (provider in ('deepseek'))` and must
 * stay that way (R22) — a user must never be able to NAME this provider from
 * the BYO-key UI. Keeping it structurally outside `ProviderId` means there is
 * nothing in that table's type or the resolve-key code path that could ever
 * select it, rather than a selectable entry someone has to remember to guard.
 *
 * ABSENCE, NOT A GUARDED PRESENCE. `getDevProviderBaseUrl()` returns `null`
 * unless BOTH hold:
 *   1. `NODE_ENV !== "production"` — checked explicitly and first, even
 *      though the env var below is also expected to be unset in any real
 *      deployment. Two independent reasons to be absent is the point: one
 *      being wrong (a leaked env var, a misconfigured deploy) must not be
 *      enough on its own.
 *   2. `SELF_MASTERY_DEV_PROVIDER_URL` is set — same pattern as
 *      `ingestion-availability.ts`'s `SELF_MASTERY_INGESTION_URL`: a
 *      capability whose absence hides the affordance, not a flag that's
 *      present-and-disabled.
 * There is no third state where this "exists but is turned off" — every
 * caller of `getDevProviderBaseUrl()` sees either a real URL or `null`,
 * never a sentinel it has to remember to check twice.
 */
export function getDevProviderBaseUrl(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  const url = process.env.SELF_MASTERY_DEV_PROVIDER_URL;
  return url && url.length > 0 ? url : null;
}

export function isDevProviderAvailable(): boolean {
  return getDevProviderBaseUrl() !== null;
}
