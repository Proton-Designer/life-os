import { randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { verifyAccessToken, listAccessTokens, tokenHasScope } from "@/lib/mcp/tokens";
import { isUserActive } from "@/lib/mcp/active-user";
import { consumeRateLimit } from "@/lib/mcp/rate-limit";
import { noteAuthFailure } from "@/lib/mcp/auth-failure-limit";
import { mintSessionJwt, buildUserScopedClient } from "@/lib/mcp/session";
import { extractToken, problemResponse } from "@/lib/agent-api/rest/http";
import { findTokenInQuery } from "@/lib/agent-api/rest/parse-path";
import { buildAccountMap } from "@/lib/agent-api/account-map";
import { renderAccountAgentDoc } from "@/lib/agent-api/agent-md";

/**
 * P4-20 -- GET /api/v1/agent.md: the SAME generic doc, filled in for the
 * caller's own account. A standalone route, not routed through
 * lib/agent-api/rest/handler.ts's JSON-shaped operations/execute pipeline
 * (that pipeline always produces a tool RESULT; this produces markdown) --
 * same posture as app/connect/[code]/route.ts: its own thin route reusing
 * the SAME auth/rate-limit primitives the shared pipeline uses, not a
 * second implementation of them.
 *
 * Auth: identical to lib/agent-api/rest/handler.ts's own header check
 * (extractToken -> verifyAccessToken -> isUserActive), and the same
 * token-in-query-string refusal. Rate limit: the SAME "interactive" bucket
 * MCP and REST share (lib/mcp/rate-limit.ts), keyed by this token/user, so
 * hitting this doc doesn't get a free unmetered lane next to real calls.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const ctx = { requestId, operation: "discovery.agent_md" as string | null };
  const url = new URL(request.url);

  const tokenParam = findTokenInQuery(url.searchParams);
  if (tokenParam) {
    return problemResponse(
      "token_in_query",
      400,
      `Tokens are never accepted in the URL (parameter "${tokenParam}"). Send it as "Authorization: Bearer <token>" or "X-LifeOS-Token: <token>".`,
      ctx,
    );
  }

  const serviceClient = createServiceRoleClient();
  const rawToken = extractToken(request.headers);
  const unauthenticated = async () => {
    const verdict = await noteAuthFailure(serviceClient, request);
    if (verdict.limited) {
      return problemResponse("rate_limited", 429, `Too many failed authentication attempts from this network. Retry after ${verdict.retryAfterSeconds}s.`, ctx, {}, verdict.retryAfterSeconds);
    }
    return problemResponse("unauthenticated", 401, 'Send a LifeOS personal access token as "Authorization: Bearer lifeos_pat_...".', ctx, {
      "WWW-Authenticate": 'Bearer realm="lifeos", error="invalid_token"',
    });
  };
  if (!rawToken) return unauthenticated();

  const verified = await verifyAccessToken(serviceClient, rawToken);
  if (!verified) return unauthenticated();
  if (!(await isUserActive(serviceClient, verified.userId))) return unauthenticated();
  if (!tokenHasScope(verified.scopes, "read")) {
    return problemResponse("insufficient_scope", 403, "This token needs read scope to fetch agent.md.", ctx);
  }

  const rateLimit = await consumeRateLimit(serviceClient, { tokenId: verified.tokenId, userId: verified.userId, lane: "interactive" });
  if (!rateLimit.ok) {
    return problemResponse("rate_limited", 429, rateLimit.message ?? "Rate limited.", ctx, {}, rateLimit.retryAfterSeconds);
  }

  const jwt = await mintSessionJwt(verified.userId);
  const userClient = buildUserScopedClient(jwt);
  const map = await buildAccountMap(userClient, verified.userId, new Date());
  const ownToken = (await listAccessTokens(userClient, verified.userId)).find((t) => t.id === verified.tokenId);

  const doc = renderAccountAgentDoc(map, url.origin, { scopes: verified.scopes, expiresAt: ownToken?.expiresAt ?? null });
  return new Response(doc, { status: 200, headers: { "content-type": "text/markdown; charset=utf-8" } });
}
