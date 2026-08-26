import type { NextRequest } from "next/server";

// Shared by every route under app/api/test/ (2026-08-26 extraction, Opus
// Lead — was copy-pasted 11 times). Pure extraction, no behavior change:
// same env var, same header, same boolean. The reason this is worth one
// shared file rather than eleven identical ones isn't the duplication
// itself — it's that these routes are live in production
// (E2E_TEST_SECRET is set there) and Ayman hasn't yet weighed in on
// whether that's acceptable. If he decides it isn't, the fix (an
// environment guard) belongs HERE, once, not stamped across eleven call
// sites. Do not add that guard preemptively — it's his call, and doing so
// now would silently break the e2e suite this whole directory exists to
// support.
export function checkSecret(request: NextRequest): boolean {
  const expectedSecret = process.env.E2E_TEST_SECRET;
  return !!expectedSecret && request.headers.get("x-e2e-secret") === expectedSecret;
}
