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
 * The remote MCP server. Five generic tools, each dispatching through a
 * registry rather than one tool per table:
 *   - `list_capabilities` — no argument: this account's map (P4-03,
 *     lib/agent-api/account-map.ts); with a domain: its entities, fields,
 *     filters and write actions.
 *   - `read` — every entity in lib/mcp/registry.ts (list with total, limit,
 *     equality and {gte,lte} range filters; or one row by id).
 *   - `write` — every action in lib/mcp/write-registry.ts. No hard deletes:
 *     removal archives or flips a status.
 *   - `widget_manage` — declarative Home widgets (config rows drawn by a
 *     fixed renderer, never agent-authored code).
 *   - `scheduler_manage` — deferred/recurring writes and reminders, fired by
 *     app/api/cron/scheduled-actions through this SAME `write` path.
 * Every tool call runs through lib/mcp/tool-wrapper.ts -> the transport-
 * neutral core lib/agent-api/execute.ts (scope, rate limit, session, audit).
 * `search`/`fetch` were never built. Counts live in the registries (and
 * `npx tsx scripts/mcp-surface-counts.ts`), deliberately not in this comment.
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
 *        5-minute HS256 session JWT (lib/mcp/session.ts explains why HS256
 *        with the legacy shared secret, not ES256), build a user-scoped client from
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
  // Equality value, or a {gte?, lte?} range on a range-filterable column (P4-04).
  // .strict() so a misspelled bound is rejected, not silently dropped.
  filter: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.object({ gte: z.union([z.string(), z.number()]).optional(), lte: z.union([z.string(), z.number()]).optional() }).strict(),
      ]),
    )
    .optional(),
  detail: z.enum(["ids", "summary", "full"]).optional(),
  fields: z.array(z.string()).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(20).optional(),
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
          "Call first with no arguments. Returns this account's map: today {local_date, timezone, local_time}, mode (legacy|domains), active_areas, vocabulary_map (area -> domains), and domains as a compact table: domain_fields names the columns once and each domains[name] is a row in that order -- [one_line, active_for_account, read entity names, writable entity names, views]. active_for_account is informational, never a restriction. Call with a domain for its entities' fields and filters, each write action's description, patch shape, requires_id and schedulable, and any write_only_entities.",
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
          "Read one entity: a page of up to 20 rows {items, has_more, cursor, total}, or one row by id. detail: ids | summary (default) | full; fields narrows further. filter: equality on filterable_fields, or {gte, lte} on range_filterable_fields (e.g. a date range). limit 1-20 for just the latest N. Invalid names are rejected with the valid set named in the error.",
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
          "Create, update, delete (archive), or list Home dashboard widgets: a config row drawn by a fixed renderer, never agent-authored code. Kinds, the display schema per kind, and the data_source shape are in list_capabilities(\"widgets\"). A data source can reference only an entity read() exposes. create/update/delete need 'write' scope; list needs 'read'.",
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
