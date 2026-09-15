import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  consumeAuthorizationCode,
  mintRefreshToken,
  findAccessTokenForRefreshToken,
  getOAuthClient,
  formatOAuthTokenLabel,
  runRefreshGrant,
} from "@/lib/mcp/oauth";
import { createAccessToken, OAUTH_ACCESS_TOKEN_TTL_SECONDS } from "@/lib/mcp/tokens";

/**
 * RFC 6749 sec 4.1.3 / 6 token endpoint — the second half of the
 * authorization_code+PKCE dance app/api/mcp/oauth/authorize/route.ts starts,
 * and the refresh_token grant.
 *
 * SERVICE-ROLE THROUGHOUT — this is a server-to-server POST (Claude's/
 * ChatGPT's/Gemini's backend, not a browser), so there is no Life OS session
 * cookie to scope a request through. Same reasoning as
 * lib/mcp/tokens.ts's verifyAccessToken.
 *
 * THE ACCESS TOKEN THIS MINTS IS A REAL `mcp_access_tokens` ROW — the exact
 * same table and shape L2's Settings "Create token" button produces, per
 * the explicit instruction not to invent a parallel credential. It shows up
 * in Settings' connector list like any other PAT (labeled "OAuth: <client
 * _name>" via lib/mcp/oauth.ts's formatOAuthTokenLabel — NOT the raw
 * client_id; see that function's own header for why an earlier version of
 * this label was a real bug, not a cosmetic choice), with the same
 * one-click revocation.
 *
 * ACCESS TOKENS EXPIRE AFTER 30 DAYS, AND THE RESPONSE SAYS SO (P4-12,
 * migration 215). Before 215 there was no `expires_at` column, so this route
 * deliberately returned no `expires_in` rather than claim an expiry nothing
 * enforced -- which also meant no client ever refreshed on a timer. Now every
 * token minted here (both grants) is `client_kind='mcp_oauth'` with
 * `expires_at = now + OAUTH_ACCESS_TOKEN_TTL_SECONDS`, enforced by
 * verifyAccessToken / getLiveTokenById, and `expires_in` reports that TTL.
 * The refresh_token stays clock-free: single-use rotation, and a REPLAYED
 * (already-rotated) refresh token is a theft signal that revokes the family.
 * Refreshing an EXPIRED access token is the normal path and is allowed, but
 * a REVOKED one is never refreshable (P4-11 security fix). The refresh grant
 * is one serialized transaction (P4-13, migration 217).
 */

/** P4-12: every OAuth-minted access token is a 30-day mcp_oauth token. An instant (now + TTL), never a calendar date. */
function oauthTokenOptions() {
  return { clientKind: "mcp_oauth" as const, expiresAt: new Date(Date.now() + OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString() };
}

/**
 * The only free-text 500 description this route sends. Other 500 paths pass
 * createAccessToken's / mintRefreshToken's own `message`, which are fixed,
 * user-facing strings by construction (e.g. the live-token cap message),
 * never DB error text.
 */
const GENERIC_SERVER_ERROR = "The token request couldn't be completed. Try again.";
const TOKEN_CAP_MESSAGE_FOR_CLIENT = "This account already has the maximum number of active connections. Revoke one in Life OS Settings, then reconnect.";

function tokenError(error: string, description: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status });
}

async function parseTokenRequestBody(request: Request): Promise<URLSearchParams | null> {
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      // Not RFC 6749-standard (form-urlencoded is), but some real clients
      // send JSON first — there is no security cost to also accepting it.
      const body = await request.json();
      if (typeof body !== "object" || body === null) return null;
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
        if (typeof value === "string") params.set(key, value);
      }
      return params;
    }
    return new URLSearchParams(await request.text());
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const form = await parseTokenRequestBody(request);
  if (!form) return tokenError("invalid_request", "Malformed request body.");

  const grantType = form.get("grant_type");
  const supabase = createServiceRoleClient();

  if (grantType === "authorization_code") {
    const code = form.get("code");
    const redirectUri = form.get("redirect_uri");
    const clientId = form.get("client_id");
    const codeVerifier = form.get("code_verifier");
    if (!code || !redirectUri || !clientId || !codeVerifier) {
      return tokenError("invalid_request", "code, redirect_uri, client_id, and code_verifier are all required.");
    }

    const consumed = await consumeAuthorizationCode(supabase, { rawCode: code, clientId, redirectUri, codeVerifier });
    if (!consumed.ok) return tokenError(consumed.error, consumed.message);

    // Label with the DCR-supplied client_name ("Claude"), never the raw
    // client_id (a ~50-char random string) — see formatOAuthTokenLabel's
    // own header for why this is a fix, not a cosmetic choice.
    const client = await getOAuthClient(supabase, clientId);
    const minted = await createAccessToken(supabase, consumed.userId, formatOAuthTokenLabel(client), consumed.scopes, oauthTokenOptions());
    if (!minted.ok || !minted.token || !minted.status) {
      return tokenError("server_error", minted.message, 500);
    }

    const refresh = await mintRefreshToken(supabase, { accessTokenId: minted.status.id, clientId, userId: consumed.userId });
    if (!refresh.ok) return tokenError("server_error", refresh.message, 500);

    return NextResponse.json({
      access_token: minted.token,
      token_type: "Bearer",
      expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      scope: consumed.scopes.join(" "),
      refresh_token: refresh.refreshToken,
    });
  }

  if (grantType === "refresh_token") {
    const rawRefreshToken = form.get("refresh_token");
    if (!rawRefreshToken) return tokenError("invalid_request", "refresh_token is required.");

    // The label needs the client's registered name, so look the refresh row
    // up first (read-only; client_id never changes). An unknown token stops
    // here. Everything that WRITES happens inside one transaction below.
    const found = await findAccessTokenForRefreshToken(supabase, rawRefreshToken);
    if (!found) return tokenError("invalid_grant", "Refresh token is invalid.");
    const client = await getOAuthClient(supabase, found.clientId);

    // P4-13: the whole grant is public.mcp_oauth_refresh_grant (migration
    // 217), serialized per (user, client) under an advisory lock:
    //   - REUSE of an already-rotated refresh token (theft signal) burns every
    //     unused refresh token for the pair and revokes the replayed token plus
    //     every live one -- in the same locked transaction, so a refresh racing
    //     the replay can no longer mint a token that survives it (the race the
    //     P4-11 security fix left open).
    //   - a REVOKED access token (Settings, or reuse detection) is never
    //     refreshed; an EXPIRED one is (P4-12's normal path).
    //   - otherwise: rotate, revoke the old token, mint the new one with the
    //     SAME scopes (never widened), move scheduled actions onto it (P4-11,
    //     now atomic), mint the next refresh token.
    const grant = await runRefreshGrant(supabase, rawRefreshToken, {
      label: formatOAuthTokenLabel(client),
      expiresAt: oauthTokenOptions().expiresAt,
    });
    switch (grant.outcome) {
      case "ok":
        return NextResponse.json({
          access_token: grant.accessToken,
          token_type: "Bearer",
          expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
          scope: grant.scopes.join(" "),
          refresh_token: grant.refreshToken,
        });
      case "invalid":
        return tokenError("invalid_grant", "Refresh token is invalid.");
      case "reuse":
        return tokenError("invalid_grant", "Refresh token has already been used. The associated access has been revoked.");
      case "revoked":
        return tokenError("invalid_grant", "The access this refresh token belonged to has been revoked or no longer exists. Reconnect to continue.");
      case "cap":
        return tokenError("server_error", TOKEN_CAP_MESSAGE_FOR_CLIENT, 500);
      case "error":
        return tokenError("server_error", GENERIC_SERVER_ERROR, 500);
    }
  }

  return tokenError("unsupported_grant_type", `grant_type "${grantType}" is not supported. Use authorization_code or refresh_token.`);
}
