import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  consumeAuthorizationCode,
  rotateRefreshToken,
  mintRefreshToken,
  findAccessTokenForRefreshToken,
  findLiveAccessTokenIdsForClient,
  getOAuthClient,
  formatOAuthTokenLabel,
} from "@/lib/mcp/oauth";
import { createAccessToken, revokeAccessToken, getTokenScopesById, OAUTH_ACCESS_TOKEN_TTL_SECONDS } from "@/lib/mcp/tokens";
import { repointScheduledActionsToken } from "@/lib/scheduling/token-handoff";

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
 * Refreshing an EXPIRED access token is the normal path and is allowed --
 * getTokenScopesById reads scopes regardless of expiry.
 */

/** P4-12: every OAuth-minted access token is a 30-day mcp_oauth token. An instant (now + TTL), never a calendar date. */
function oauthTokenOptions() {
  return { clientKind: "mcp_oauth" as const, expiresAt: new Date(Date.now() + OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString() };
}

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

    const rotated = await rotateRefreshToken(supabase, rawRefreshToken);
    if (!rotated.ok) {
      if (rotated.reuseDetected) {
        // Theft signal. Revoke BOTH: (1) the stale row's own access token —
        // usually already dead from the normal rotation that superseded it,
        // a harmless no-op, but cheap insurance if it somehow isn't — and
        // (2) whatever access token is CURRENTLY live for this (user,
        // client) pair, which is the one that actually matters: if an
        // attacker redeemed this same refresh token before its legitimate
        // holder did, THAT redemption looked like an ordinary rotation and
        // produced the live token the attacker is now holding. Revoking
        // only (1) would leave (2) — the attacker's working credential —
        // completely untouched. See lib/mcp/oauth.ts's rotateRefreshToken
        // and findLiveAccessTokenIdsForClient doc comments for the full
        // reasoning (corrected during L4 flow verification — an earlier
        // version of this code only did (1)).
        const stale = await findAccessTokenForRefreshToken(supabase, rawRefreshToken);
        if (stale) {
          const liveIds = await findLiveAccessTokenIdsForClient(supabase, stale.userId, stale.clientId);
          const toRevoke = new Set([stale.accessTokenId, ...liveIds]);
          for (const tokenId of toRevoke) {
            await revokeAccessToken(supabase, stale.userId, tokenId);
          }
        }
      }
      return tokenError(rotated.error, rotated.message);
    }

    // Rotate the ACCESS token too, not just the refresh token: the old access
    // token is revoked the moment a new one is issued, so a refresh genuinely
    // rotates the live credential. Since P4-12 the old token would also die
    // on its own at its 30-day expires_at; a client that never refreshes
    // stops working then (see this file's header).
    //
    // SCOPES ARE CARRIED FORWARD FROM THE TOKEN BEING REPLACED, never
    // widened to full access by default — a read-only OAuth-issued token
    // must still be read-only after a refresh.
    const priorScopes = await getTokenScopesById(supabase, rotated.oldAccessTokenId);
    if (!priorScopes || priorScopes.length === 0) {
      // The token being refreshed no longer exists or has no scopes (e.g.
      // it was manually revoked from Settings between issuance and this
      // refresh) — refuse rather than silently minting a fresh full-access
      // token for a credential that shouldn't exist anymore.
      return tokenError("invalid_grant", "The access token this refresh token belongs to no longer exists.");
    }

    const rotatedClient = await getOAuthClient(supabase, rotated.clientId);
    const minted = await createAccessToken(supabase, rotated.userId, formatOAuthTokenLabel(rotatedClient), priorScopes, oauthTokenOptions());
    if (!minted.ok || !minted.token || !minted.status) {
      return tokenError("server_error", minted.message, 500);
    }

    // P4-11: move this user's scheduled actions onto the new token BEFORE the
    // old one is revoked — they fire under `token_id`, and the runner pauses
    // any row whose token is revoked, so revoking first killed every schedule
    // an OAuth client had created at its first refresh. Only this legitimate
    // rotation re-points; the reuse-detection branch above deliberately does
    // not (a stolen chain's schedules must stay denied). If the move fails,
    // fail the refresh closed: revoke the token we just minted and leave the
    // old token + schedules exactly as they were.
    try {
      await repointScheduledActionsToken(supabase, rotated.userId, rotated.oldAccessTokenId, minted.status.id);
    } catch (e) {
      await revokeAccessToken(supabase, rotated.userId, minted.status.id);
      return tokenError("server_error", e instanceof Error ? e.message : "Could not complete the token refresh.", 500);
    }
    await revokeAccessToken(supabase, rotated.userId, rotated.oldAccessTokenId);

    const nextRefresh = await mintRefreshToken(supabase, { accessTokenId: minted.status.id, clientId: rotated.clientId, userId: rotated.userId });
    if (!nextRefresh.ok) return tokenError("server_error", nextRefresh.message, 500);

    return NextResponse.json({
      access_token: minted.token,
      token_type: "Bearer",
      expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      scope: minted.status.scopes.join(" "),
      refresh_token: nextRefresh.refreshToken,
    });
  }

  return tokenError("unsupported_grant_type", `grant_type "${grantType}" is not supported. Use authorization_code or refresh_token.`);
}
