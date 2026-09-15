import { z } from "zod";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { verifyAccessToken } from "@/lib/mcp/tokens";
import { isUserActive } from "@/lib/mcp/active-user";
import { runMcpTool } from "@/lib/mcp/tool-wrapper";
import { listCapabilitiesTool, resolveListCapabilitiesOperation } from "@/lib/mcp/tools/list-capabilities";
import { readTool, resolveReadOperation, type ReadArgs } from "@/lib/mcp/tools/read";
import { writeTool, resolveWriteOperation, type WriteArgs } from "@/lib/mcp/tools/write";
import { widgetManageTool, resolveWidgetManageOperation, resolveWidgetManageScope, type WidgetManageArgs } from "@/lib/mcp/tools/widget-manage";
import { schedulerManageTool, resolveSchedulerManageOperation, resolveSchedulerManageScope, type SchedulerManageArgs } from "@/lib/mcp/tools/scheduler-manage";
import { readMcpAuth } from "@/lib/mcp/auth-info";
import { AGENT_INSTRUCTIONS } from "@/lib/agent-api/instructions";

/**
 * L3+L6+L11 (docs/ai-connector/PROGRAM-PLAN.md), scope per the team-lead's
 * adoption of Eng2's TOOL-ARCHITECTURE.md (commit 2855e96): four of the
 * seven generic tools — `list_capabilities` (discovery), `read` (every
 * domain read, wired to `deen`'s 8 entities — lib/mcp/registry.ts), and
 * `write` (every domain write, wired to `deen.prayer.log`,
 * `deen.sunnah_log.toggle`, `deen.adhkar.toggle` — lib/mcp/write-registry.ts).
 * `deen.prayer.unlog` is deliberately NOT wired — see write-registry.ts's
 * header. `widget_manage` is now wired too (L11/R7 Tier 1 declarative
 * widgets — lib/mcp/tools/widget-manage.ts, gated per TOOL-ARCHITECTURE.md
 * §6: config rows only, never agent-authored code). `scheduler_manage` is
 * now wired too (L7 — lib/mcp/tools/scheduler-manage.ts, deferred/
 * recurring writes fired by app/api/cron/scheduled-actions/route.ts's
 * pg_cron+pg_net poll, reusing this SAME `write` tool at fire time — never
 * a parallel executor). `search`/`fetch` remain explicitly out of scope
 * for this layer.
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

const WriteInputSchema = z.object({
  domain: z.string(),
  entity: z.string(),
  action: z.string(),
  id: z.string().optional(),
  patch: z.record(z.string(), z.unknown()).optional(),
});

const WidgetManageInputSchema = z.object({
  action: z.enum(["list", "create", "update", "delete"]),
  id: z.string().optional(),
  patch: z.record(z.string(), z.unknown()).optional(),
});

const SchedulerManageInputSchema = z.object({
  action: z.enum(["list", "create", "cancel", "pause"]),
  id: z.string().optional(),
  patch: z.record(z.string(), z.unknown()).optional(),
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
          "Call first with no arguments: returns this account's map (local today and timezone, legacy/domains mode, active areas, and each domain's readable and writable entities as rows in domain_fields order). Call with a domain for its entities' fields, filters, and each write action's description, patch shape, requires_id and schedulable.",
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
          // No domain: this account's map (P4-03), read through the same
          // user-scoped client every tool gets. `now` is the instant only;
          // the map derives the local date via localDateString.
          (userClient, userId) => listCapabilitiesTool(domain, domain ? undefined : { userClient, userId, now: new Date() }),
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

    server.registerTool(
      "write",
      {
        title: "Write",
        description:
          "Write data to any domain/entity/action this connector exposes. Requires a token with 'write' scope — a read-only token is denied and the denial is audited. Call list_capabilities first if unsure of valid domain/entity names.",
        inputSchema: WriteInputSchema,
      },
      async (args, ctx) =>
        runMcpTool(
          serviceClient,
          ctx.http?.authInfo,
          "write",
          resolveWriteOperation(args as WriteArgs),
          "write",
          args,
          (userClient, userId) => writeTool(userClient, userId, args as WriteArgs),
        ),
    );

    server.registerTool(
      "widget_manage",
      {
        title: "Manage widgets",
        description:
          "Create, update, delete, or list declarative dashboard widgets (L11/R7 Tier 1 — a config row rendered by a fixed, audited renderer, never agent-authored code). A widget's data source can only reference a domain/entity this connector's read() already exposes. 'create'/'update'/'delete' require a token with 'write' scope; 'list' only needs 'read'.",
        inputSchema: WidgetManageInputSchema,
      },
      async (args, ctx) =>
        runMcpTool(
          serviceClient,
          ctx.http?.authInfo,
          "widget_manage",
          resolveWidgetManageOperation(args as WidgetManageArgs),
          resolveWidgetManageScope((args as WidgetManageArgs).action),
          args,
          (userClient, userId) => widgetManageTool(userClient, userId, args as WidgetManageArgs),
        ),
    );

    server.registerTool(
      "scheduler_manage",
      {
        title: "Manage scheduled actions",
        description:
          "Create, cancel, pause, or list deferred/recurring MCP actions (L7) -- including reminders. patch.tool_name selects the shape: 'write' (patch.domain/entity/action/write_id?/write_patch? -- only VERIFIED IDEMPOTENT write actions can be scheduled, refused with a clear message otherwise, since at-least-once delivery means a scheduled action can fire twice for the same intended run) or 'notify' (patch.title/body -- a real push notification, e.g. \"remind me to review my kill list at 4pm\"; refused at create time if this account has no push subscription registered, since that reminder could never actually reach you). A one-off run needs patch.run_at (an ISO instant); a recurring one needs patch.cron_expression ('MM HH * * *' daily or 'MM HH * * D' weekly, D=0-6, all in the account's own local time) -- never both. 'create'/'cancel'/'pause' require a token with 'write' scope; 'list' only needs 'read'.",
        inputSchema: SchedulerManageInputSchema,
      },
      async (args, ctx) => {
        // The one tool that needs the CALLING token's own id (to record
        // WHICH token authorizes a scheduled action, for L7's fire-time
        // scope re-check) -- readMcpAuth is a pure function of the same
        // authInfo runMcpTool itself reads, called a second time here
        // rather than widening runMcpTool's own fn(userClient, userId)
        // signature for one caller. See scheduler-manage.ts's own header.
        const auth = readMcpAuth(ctx.http?.authInfo);
        return runMcpTool(
          serviceClient,
          ctx.http?.authInfo,
          "scheduler_manage",
          resolveSchedulerManageOperation(args as SchedulerManageArgs),
          resolveSchedulerManageScope((args as SchedulerManageArgs).action),
          args,
          (userClient, userId) => schedulerManageTool(userClient, userId, auth?.tokenId ?? null, args as SchedulerManageArgs),
        );
      },
    );
  },
  { serverInfo: { name: "lifeos-mcp", version: "0.1.0" }, instructions: AGENT_INSTRUCTIONS },
);

const authedHandler = withMcpAuth(handler, verifyToken, { required: true });

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE };
