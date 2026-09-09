import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { verifyAccessToken } from "@/lib/mcp/tokens";
import { isUserActive } from "@/lib/mcp/active-user";
import { runMcpTool } from "@/lib/mcp/tool-wrapper";
import { getProfileTool } from "@/lib/mcp/tools/get-profile";
import { listTasksDueTodayTool } from "@/lib/mcp/tools/list-tasks-due-today";

/**
 * L3 (docs/ai-connector/PROGRAM-PLAN.md): the MCP server itself. Deliberately
 * narrow — two read tools only, proving the mechanism end to end. The full
 * tool surface (L5+) is blocked on Eng2's TOOL-ARCHITECTURE.md by design.
 *
 * Streamable HTTP only — no SSE, no Redis (settled in PROGRAM-PLAN.md's
 * findings: Claude is deprecating SSE, Gemini rejects it outright, and
 * Redis was only ever a 1.x SSE-resumability concern).
 *
 * THE AUTH CHAIN, end to end, matches R4/R4a exactly:
 *   Authorization: Bearer lifeos_pat_...
 *     -> verifyAccessToken (SERVICE-ROLE client — see its own comment in
 *        lib/mcp/tokens.ts for why: no userId exists yet to scope an RLS
 *        client around, so an RLS-scoped lookup would find nothing for any
 *        token, which is a false "invalid" on everything)
 *     -> isUserActive (R4a — the GoTrue checks the signing path below
 *        skips: banned/soft-deleted. MUST run here, between "token
 *        verified" and "session minted", never folded into either)
 *     -> (per-tool, inside runMcpTool) scope check, rate limit, mint a
 *        locally-signed ES256 session JWT, build a user-scoped client from
 *        it — RLS applies from there on exactly as it does for the
 *        cookie-authed UI.
 *
 * verifyToken's job ends at "is this bearer token live, and does it belong
 * to someone who should be allowed to exist at all" — wrong token, revoked
 * token, and malformed token all collapse to the same `undefined` (401)
 * here, on purpose: distinguishing them to the caller would leak which
 * half of a guess was closer to a real credential.
 */
async function verifyToken(_req: Request, bearerToken?: string) {
  if (!bearerToken) return undefined;

  const serviceClient = createServiceRoleClient();
  const verified = await verifyAccessToken(serviceClient, bearerToken);
  if (!verified) return undefined;

  const active = await isUserActive(serviceClient, verified.userId); // R4a, not optional
  if (!active) return undefined;

  return {
    token: bearerToken,
    clientId: verified.tokenId,
    scopes: verified.scopes,
    extra: { userId: verified.userId, tokenId: verified.tokenId },
  };
}

const handler = createMcpHandler(
  (server) => {
    // One service-role client per request (createMcpHandler's own "per-
    // request-factory" model — this callback runs once per request, not
    // once globally), shared by every tool this request calls through
    // runMcpTool's rate-limit/audit steps. Each tool still gets its OWN
    // freshly minted, user-scoped RLS client from lib/mcp/session.ts —
    // this one never touches domain data, only tokens/audit bookkeeping.
    const serviceClient = createServiceRoleClient();

    server.registerTool(
      "get_profile",
      {
        title: "Get profile",
        description: "Read the authenticated Life OS account's basic profile: display name, timezone, prayer calculation settings.",
      },
      async (ctx) =>
        runMcpTool(serviceClient, ctx.http?.authInfo, "get_profile", "read", {}, (userClient, userId) =>
          getProfileTool(userClient, userId),
        ),
    );

    server.registerTool(
      "list_tasks_due_today",
      {
        title: "List tasks due today",
        description:
          "Read the authenticated account's tasks due today, computed in the account's OWN timezone (never the server's).",
      },
      async (ctx) =>
        runMcpTool(serviceClient, ctx.http?.authInfo, "list_tasks_due_today", "read", {}, (userClient, userId) =>
          listTasksDueTodayTool(userClient, userId),
        ),
    );
  },
  { serverInfo: { name: "lifeos-mcp", version: "0.1.0" } },
);

const authedHandler = withMcpAuth(handler, verifyToken, { required: true });

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE };
