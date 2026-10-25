import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { McpScope } from "./tokens";
import type { AuthInfoLike } from "./auth-info";
import { executeOperation, type ToolOutcome } from "@/lib/agent-api/execute";

/**
 * The MCP adapter over the transport-neutral operation core
 * (lib/agent-api/execute.ts, P4-02). Every MCP tool handler — and the
 * scheduler runner, which fires through the same path — still calls
 * `runMcpTool` with the same arguments it always has; the chain itself
 * (scope check, rate limit, session mint, the tool's own logic, audit
 * write, in that order) now lives in `executeOperation`, once, so the REST
 * adapter can compose exactly the same guarantees.
 *
 * This file's only job is the mapping back to MCP: a success returns the
 * tool's own `CallToolResult` object untouched, and a typed failure becomes
 * `{content:[{type:"text", text: message}], isError: true}` — byte-for-byte
 * the response runMcpTool produced before the extraction.
 *
 * Results are typed as the SDK's own `CallToolResult`, not a hand-rolled
 * lookalike: `registerTool`'s callback return type is a union with
 * `InputRequiredResult` (the multi-round-trip elicitation shape), and a
 * locally-defined type that is merely *structurally close* to
 * `CallToolResult` fails to satisfy that union in a way that reports as a
 * missing `InputRequiredResult` field — a confusing error for a tool that
 * was never trying to be one. Using the SDK's type directly sidesteps it.
 */

/** Kept under its original name so every tool and test importing it is untouched. */
export type RunMcpToolOutcome = ToolOutcome;

export async function runMcpTool(
  serviceClient: SupabaseClient,
  authInfo: AuthInfoLike | undefined,
  toolName: string,
  operation: string,
  requiredScope: McpScope,
  args: unknown,
  // Untyped on purpose: TOOL-ARCHITECTURE.md's `read`/`write` dispatch over
  // a registry-driven table/column set (lib/mcp/registry.ts) cannot be
  // statically typed against the generated `Database` union — the table
  // name is a runtime string, not a literal this client's types can know
  // about.
  fn: (userClient: SupabaseClient, userId: string, caller: { tokenId: string }) => Promise<RunMcpToolOutcome>,
): Promise<CallToolResult> {
  const outcome = await executeOperation(serviceClient, authInfo, { toolName, operation, requiredScope, args, run: fn }, "mcp");
  return outcome.ok ? outcome.toolResult : errorResult(outcome.message);
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
