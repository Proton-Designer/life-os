import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  consumeAuthorizationCode,
  rotateRefreshToken,
  mintRefreshToken,
  findAccessTokenForRefreshToken,
  findLiveAccessTokenIdsForClient,
} from "@/lib/mcp/oauth";
import { createAccessToken, revokeAccessToken, getTokenScopesById } from "@/lib/mcp/tokens";

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
 * _id>"), with the same one-click revocation.
 *
 * NO `expires_in` IN THE RESPONSE — DELIBERATE, NOT AN OMISSION. This
 * access token does not carry a clock-based expiry (mcp_access_tokens has no
 * `expires_at` column, and this design doesn't add one — see
 * lib/mcp/oauth.ts's mintRefreshToken doc comment). Claiming an expiry we
 * don't enforce would be worse than naming none. The refresh_token this
 * endpoint DOES issue still earns its place independent of any clock: its
 * rotation is single-use, and a REPLAYED (already-rotated) refresh token is
 * treated as a theft signal that revokes the whole token family — a real
 * security property even for a token that never expires on its own.
 */

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

    const minted = await createAccessToken(supabase, consumed.userId, `OAuth: ${clientId}`, consumed.scopes);
    if (!minted.ok || !minted.token || !minted.status) {
      return tokenError("server_error", minted.message, 500);
    }

    const refresh = await mintRefreshToken(supabase, { accessTokenId: minted.status.id, clientId, userId: consumed.userId });
    if (!refresh.ok) return tokenError("server_error", refresh.message, 500);

    return NextResponse.json({
      access_token: minted.token,
      token_type: "Bearer",
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

    // Rotate the ACCESS token too, not just the refresh token: this is the
    // only mechanism that makes "refreshing" mean anything for a credential
    // with no clock-based expiry (see this file's header) — the old access
    // token is revoked the moment a new one is issued, so a client that
    // never refreshes keeps working forever (fine — that's the accepted,
    // revocation-only model), but a client that DOES refresh genuinely
    // rotates its live credential rather than just its refresh token.
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

    const minted = await createAccessToken(supabase, rotated.userId, `OAuth: ${rotated.clientId}`, priorScopes);
    if (!minted.ok || !minted.token || !minted.status) {
      return tokenError("server_error", minted.message, 500);
    }
    await revokeAccessToken(supabase, rotated.userId, rotated.oldAccessTokenId);

    const nextRefresh = await mintRefreshToken(supabase, { accessTokenId: minted.status.id, clientId: rotated.clientId, userId: rotated.userId });
    if (!nextRefresh.ok) return tokenError("server_error", nextRefresh.message, 500);

    return NextResponse.json({
      access_token: minted.token,
      token_type: "Bearer",
      scope: minted.status.scopes.join(" "),
      refresh_token: nextRefresh.refreshToken,
    });
  }

  return tokenError("unsupported_grant_type", `grant_type "${grantType}" is not supported. Use authorization_code or refresh_token.`);
}
