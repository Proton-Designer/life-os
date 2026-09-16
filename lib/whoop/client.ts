import "server-only";
import { safeFetch } from "@/lib/net/safe-outbound-url";
import { WHOOP_AUTHORIZE_URL, WHOOP_TOKEN_URL, WHOOP_SCOPES, getWhoopClientId, getWhoopClientSecret } from "@/lib/whoop/config";

/**
 * Whoop OAuth2 client. Every outbound call goes through `safeFetch`
 * (lib/net/safe-outbound-url.ts) per the Lead's explicit P3-18 ruling,
 * even though both endpoints here are fixed constants, not user input --
 * consistent outbound-call discipline across every external integration
 * in this codebase, not case-by-case judgment calls.
 *
 * NEVER LOGS a token, a code, or a raw response body anywhere in this
 * file, per the Lead's ruling -- every returned message is a short,
 * hand-written string, never `err.message` from a caught fetch/parse
 * error (which could echo response content back).
 */

const REQUEST_TIMEOUT_MS = 10_000;

export type WhoopClientResult<T> = { ok: true; data: T } | { ok: false; message: string };

export interface WhoopTokenSet {
  accessToken: string;
  refreshToken: string;
  /** ISO instant. */
  expiresAt: string;
  scope: string;
}

/** Builds the Whoop authorization redirect URL. `state` is the caller's own CSRF token (bound to the session via an httpOnly cookie) -- this function does not generate or validate it. */
export function buildWhoopAuthorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: getWhoopClientId(),
    redirect_uri: redirectUri,
    scope: WHOOP_SCOPES.join(" "),
    state,
  });
  return `${WHOOP_AUTHORIZE_URL}?${params.toString()}`;
}

interface WhoopTokenResponseShape {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

function parseTokenResponse(raw: unknown): WhoopTokenSet | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as WhoopTokenResponseShape;
  if (typeof r.access_token !== "string" || typeof r.refresh_token !== "string" || typeof r.expires_in !== "number") return null;
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: new Date(Date.now() + r.expires_in * 1000).toISOString(),
    scope: typeof r.scope === "string" ? r.scope : WHOOP_SCOPES.join(" "),
  };
}

async function whoopTokenRequest(body: URLSearchParams): Promise<WhoopClientResult<WhoopTokenSet>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await safeFetch(WHOOP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
      signal: controller.signal,
    });
    if (res.status === 400 || res.status === 401) {
      return { ok: false, message: "Whoop rejected that authorization. Try connecting again." };
    }
    if (!res.ok) {
      return { ok: false, message: `Whoop returned an error (HTTP ${res.status}).` };
    }
    const parsed = parseTokenResponse(await res.json());
    if (!parsed) return { ok: false, message: "Whoop responded, but not with a recognizable token." };
    return { ok: true, data: parsed };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return { ok: false, message: "Whoop didn't respond in time. Try again." };
    // Deliberately a fixed string, never `err.message` -- see this file's
    // own header on never surfacing raw response/error content.
    return { ok: false, message: "Couldn't reach Whoop. Try again." };
  } finally {
    clearTimeout(timeout);
  }
}

export async function exchangeWhoopAuthorizationCode(code: string, redirectUri: string): Promise<WhoopClientResult<WhoopTokenSet>> {
  return whoopTokenRequest(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: getWhoopClientId(), client_secret: getWhoopClientSecret() }),
  );
}

/** Not called anywhere yet tonight (no sync job exists to need a refreshed token) -- built alongside the exchange function since they share the identical token endpoint/response shape, and left ready for whichever future task builds the data-sync job. */
export async function refreshWhoopAccessToken(refreshToken: string): Promise<WhoopClientResult<WhoopTokenSet>> {
  return whoopTokenRequest(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: getWhoopClientId(), client_secret: getWhoopClientSecret(), scope: WHOOP_SCOPES.join(" ") }),
  );
}
