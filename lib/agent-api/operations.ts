import "server-only";
import { z } from "zod";
import { listCapabilitiesTool, resolveListCapabilitiesOperation } from "@/lib/mcp/tools/list-capabilities";
import { readTool, resolveReadOperation, type ReadArgs } from "@/lib/mcp/tools/read";
import { writeTool, resolveWriteOperation, type WriteArgs } from "@/lib/mcp/tools/write";
import { widgetManageTool, resolveWidgetManageOperation, resolveWidgetManageScope, type WidgetManageArgs } from "@/lib/mcp/tools/widget-manage";
import { schedulerManageTool, resolveSchedulerManageOperation, resolveSchedulerManageScope, type SchedulerManageArgs } from "@/lib/mcp/tools/scheduler-manage";
import type { OperationSpec } from "./execute";
import type { AgentToolName } from "./tool-names";

/**
 * P4-17: the ONE table that turns a validated `{tool, args}` into the
 * OperationSpec executeOperation runs: input schema, audit `operation`
 * string, required scope, audited args, and the tool call. The REST adapter
 * (lib/agent-api/rest/handler.ts) and the MCP route (app/api/mcp/route.ts)
 * both dispatch through it and both validate with these exact zod objects,
 * so the two transports cannot disagree on args, scope or audit operation.
 * app/api/v1/__tests__/contract.test.ts proves the transport mapping on top.
 */

export const ReadInputSchema = z.object({
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

export const ListCapabilitiesInputSchema = z.object({
  domain: z.string().optional(),
});

export const WriteInputSchema = z.object({
  domain: z.string(),
  entity: z.string(),
  action: z.string(),
  id: z.string().optional(),
  patch: z.record(z.string(), z.unknown()).optional(),
});

export const WidgetManageInputSchema = z.object({
  action: z.enum(["list", "create", "update", "delete"]),
  id: z.string().optional(),
  patch: z.record(z.string(), z.unknown()).optional(),
});

export const SchedulerManageInputSchema = z.object({
  action: z.enum(["list", "create", "cancel", "pause"]),
  id: z.string().optional(),
  patch: z.record(z.string(), z.unknown()).optional(),
});

export const TOOL_INPUT_SCHEMAS = {
  list_capabilities: ListCapabilitiesInputSchema,
  read: ReadInputSchema,
  write: WriteInputSchema,
  widget_manage: WidgetManageInputSchema,
  scheduler_manage: SchedulerManageInputSchema,
} as const satisfies Record<AgentToolName, z.ZodObject>;

export type ParsedToolArgs = { [K in AgentToolName]: z.infer<(typeof TOOL_INPUT_SCHEMAS)[K]> };

export type ToolArgsValidation<T extends AgentToolName> = { ok: true; args: ParsedToolArgs[T] } | { ok: false; message: string };

/**
 * Validates raw args with the tool's schema. The failure message names only
 * the caller's own paths and zod's rule text (no DB value), so it is safe to
 * return verbatim, same rule as ToolInputError.
 */
export function validateToolArgs<T extends AgentToolName>(tool: T, args: unknown): ToolArgsValidation<T> {
  const parsed = TOOL_INPUT_SCHEMAS[tool].safeParse(args);
  if (parsed.success) return { ok: true, args: parsed.data as ParsedToolArgs[T] };
  return { ok: false, message: `Invalid arguments for ${tool}: ${z.prettifyError(parsed.error).replace(/\n+/g, " ")}` };
}

export interface OperationContext {
  /** The calling token's id. Only scheduler_manage reads it, to record which token authorizes a schedule. */
  tokenId: string | null;
}

/**
 * Builds the executeOperation spec for already-validated args (moved here
 * from app/api/mcp/route.ts's registerTool handlers, behaviour unchanged):
 * list_capabilities audits `{domain}` and passes the account context only
 * when no domain was named. Every other tool audits its args as given.
 */
export function buildOperationSpec<T extends AgentToolName>(tool: T, parsedArgs: ParsedToolArgs[T], ctx: OperationContext): OperationSpec {
  switch (tool) {
    case "list_capabilities": {
      const { domain } = parsedArgs as ParsedToolArgs["list_capabilities"];
      return {
        toolName: "list_capabilities",
        operation: resolveListCapabilitiesOperation(domain),
        requiredScope: "read",
        args: { domain },
        run: (userClient, userId) => listCapabilitiesTool(domain, { userClient, userId, now: new Date() }),
      };
    }
    case "read": {
      const args = parsedArgs as ReadArgs;
      return { toolName: "read", operation: resolveReadOperation(args), requiredScope: "read", args, run: (userClient, userId) => readTool(userClient, userId, args) };
    }
    case "write": {
      const args = parsedArgs as WriteArgs;
      return { toolName: "write", operation: resolveWriteOperation(args), requiredScope: "write", args, run: (userClient, userId, caller) => writeTool(userClient, userId, args, caller.tokenId) };
    }
    case "widget_manage": {
      const args = parsedArgs as WidgetManageArgs;
      return {
        toolName: "widget_manage",
        operation: resolveWidgetManageOperation(args),
        requiredScope: resolveWidgetManageScope(args.action),
        args,
        run: (userClient, userId) => widgetManageTool(userClient, userId, args),
      };
    }
    case "scheduler_manage": {
      const args = parsedArgs as SchedulerManageArgs;
      return {
        toolName: "scheduler_manage",
        operation: resolveSchedulerManageOperation(args),
        requiredScope: resolveSchedulerManageScope(args.action),
        args,
        run: (userClient, userId) => schedulerManageTool(userClient, userId, ctx.tokenId, args),
      };
    }
    default: {
      const never: never = tool as never;
      throw new Error(`No operation for tool ${String(never)}`);
    }
  }
}
