import { NextResponse } from "next/server";
import { getPublicOrigin } from "mcp-handler";

/**
 * RFC 8414 OAuth 2.0 Authorization Server Metadata — the discovery document
 * an MCP client (Claude/ChatGPT/Gemini) fetches to learn this server's
 * authorize/token/register endpoints, per L4 (PROGRAM-PLAN.md).
 *
 * `getPublicOrigin` (from `mcp-handler`, already a dependency for L3) rather
 * than a hardcoded env var — it reads the standard proxy-forwarding headers
 * Vercel sets, so this stays correct behind whatever host this actually
 * deploys to without a second source of truth for "what is our own URL."
 *
 * Static per-request (no DB read, no auth) — this document describes the
 * server's fixed capabilities, not per-user state.
 */
export async function GET(request: Request) {
  const origin = getPublicOrigin(request);

  return NextResponse.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
      token_endpoint: `${origin}/api/mcp/oauth/token`,
      registration_endpoint: `${origin}/api/mcp/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["read", "write"],
    },
    {
      headers: {
        "cache-control": "public, max-age=3600",
        "access-control-allow-origin": "*",
      },
    }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
    },
  });
}
