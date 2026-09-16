import "server-only";

/**
 * P3-18 -- env-gated Whoop OAuth2 connection. No Whoop app is registered
 * anywhere yet (zero WHOOP_* env vars set in any environment tonight),
 * so `isWhoopConfigured()` returning false is the ONLY reachable state in
 * production right now -- see this task's OPEN_QUESTIONS.md entry.
 *
 * Endpoints verified live via WebSearch/WebFetch against
 * developer.whoop.com (not training memory), same discipline P2-13
 * already established for external-API accuracy:
 * https://developer.whoop.com/docs/developing/oauth/ ,
 * https://developer.whoop.com/api/ .
 */

export const WHOOP_AUTHORIZE_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
export const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";

/**
 * `offline` (refresh-token issuance) plus every documented `read:*` data
 * scope -- broad on purpose since no consumer is built tonight (see the
 * OPEN_QUESTIONS entry): whichever surface eventually reads Whoop data
 * shouldn't need a second re-authorization just to narrow/widen scopes.
 * Revisit once a real consumer is chosen.
 */
export const WHOOP_SCOPES = ["offline", "read:recovery", "read:cycles", "read:sleep", "read:workout", "read:profile", "read:body_measurement"] as const;

export function isWhoopConfigured(): boolean {
  return Boolean(process.env.WHOOP_CLIENT_ID && process.env.WHOOP_CLIENT_SECRET);
}

export function getWhoopClientId(): string {
  const id = process.env.WHOOP_CLIENT_ID;
  if (!id) throw new Error("WHOOP_CLIENT_ID is not configured.");
  return id;
}

export function getWhoopClientSecret(): string {
  const secret = process.env.WHOOP_CLIENT_SECRET;
  if (!secret) throw new Error("WHOOP_CLIENT_SECRET is not configured.");
  return secret;
}
