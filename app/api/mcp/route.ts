import { z } from "zod";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { verifyAccessToken } from "@/lib/mcp/tokens";
import { isUserActive } from "@/lib/mcp/active-user";
import { runMcpTool } from "@/lib/mcp/tool-wrapper";
import { listCapabilitiesTool, resolveListCapabilitiesOperation } from "@/lib/mcp/tools/list-capabilities";
import { readTool, resolveReadOperation, type ReadArgs } from "@/lib/mcp/tools/read";

/**
 * L3 (docs/ai-connector/PROGRAM-PLAN.md), scope updated per the team-lead's
 * adoption of Eng2's TOOL-ARCHITECTURE.md (commit 2855e96): two of the
 * seven generic tools, the two that prove the architecture —
 * `list_capabilities` (discovery) and `read` (every domain read, wired to
 * exactly one domain/entity here: `deen`/`prayer` — see
 * lib/mcp/registry.ts's own header for why only that one). The full
 * `domain`/`entity`/`action` matrix and the remaining five tools
 * (`search`, `fetch`, `write`, `scheduler_manage`, `widget_manage`) are
 * explicitly out of scope for this layer.
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

const ReadInputSchema = z.object({
  domain: z.string(),
  entity: z.string(),
  id: z.string().optional(),
  filter: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  detail: z.enum(["ids", "summary", "full"]).optional(),
  fields: z.array(z.string()).optional(),
  cursor: z.string().optional(),
});

const ListCapabilitiesInputSchema = z.object({
  domain: z.string().optional(),
});

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
      "list_capabilities",
      {
        title: "List capabilities",
        description:
          "Discover the domains, entities, fields, and actions this connector exposes. Call with no arguments for the domain list, or with a domain to see its entities. Cheap — call whenever unsure before read/write.",
        inputSchema: ListCapabilitiesInputSchema,
      },
      async ({ domain }, ctx) =>
        runMcpTool(
          serviceClient,
          ctx.http?.authInfo,
          "list_capabilities",
          resolveListCapabilitiesOperation(domain),
          "read",
          { domain },
          () => listCapabilitiesTool(domain),
        ),
    );

    server.registerTool(
      "read",
      {
        title: "Read",
        description:
          "Read data from any domain/entity this connector exposes. Call list_capabilities first if unsure of valid domain/entity/field names — an invalid one is rejected with the valid set named in the error.",
        inputSchema: ReadInputSchema,
      },
      async (args, ctx) =>
        runMcpTool(
          serviceClient,
          ctx.http?.authInfo,
          "read",
          resolveReadOperation(args as ReadArgs),
          "read",
          args,
          (userClient, userId) => readTool(userClient, userId, args as ReadArgs),
        ),
    );
  },
  { serverInfo: { name: "lifeos-mcp", version: "0.1.0" } },
);

const authedHandler = withMcpAuth(handler, verifyToken, { required: true });

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE };
