import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { Database } from "@/lib/supabase/database.types";
import { tokenHasScope, touchLastUsed, type McpScope } from "./tokens";
import { checkRateLimit } from "./rate-limit";
import { writeAuditRow, type McpAuditOutcome } from "./audit";
import { mintSessionJwt, buildUserScopedClient } from "./session";
import { readMcpAuth, type AuthInfoLike } from "./auth-info";

/**
 * The single composition point every MCP tool handler calls through —
 * scope check, rate limit, session mint, the tool's own logic, and the
 * audit write, in that order, for every tool (read or write) this
 * connector will ever register. L3's brief named each piece as something
 * to prove; this is where they actually compose, once, so no future tool
 * re-derives the ordering (and the ordering IS the guarantee — see the
 * audit-write comment below).
 *
 * Results are typed as the SDK's own `CallToolResult`, not a hand-rolled
 * lookalike: `registerTool`'s callback return type is a union with
 * `InputRequiredResult` (the multi-round-trip elicitation shape), and a
 * locally-defined type that is merely *structurally close* to
 * `CallToolResult` fails to satisfy that union in a way that reports as a
 * missing `InputRequiredResult` field — a confusing error for a tool that
 * was never trying to be one. Using the SDK's type directly sidesteps it.
 */

export interface RunMcpToolOutcome {
  result: CallToolResult;
  /** One short line for mcp_audit_log.result_summary — e.g. "returned 3 tasks". Never the full payload; that already exists in `result`/`args`. */
  summary: string;
}

export async function runMcpTool(
  serviceClient: SupabaseClient,
  authInfo: AuthInfoLike | undefined,
  toolName: string,
  requiredScope: McpScope,
  args: unknown,
  fn: (userClient: SupabaseClient<Database>, userId: string) => Promise<RunMcpToolOutcome>,
): Promise<CallToolResult> {
  const auth = readMcpAuth(authInfo);
  if (!auth) {
    // withMcpAuth (app/api/mcp/route.ts) is supposed to reject an
    // unauthenticated call before any tool handler runs at all. Reaching
    // here with nothing to read is that guarantee failing, not a normal
    // permission denial -- and there is no userId to attribute an audit
    // row to (the column is NOT NULL), so none is written.
    return errorResult("Not authenticated.");
  }

  const deny = async (message: string): Promise<CallToolResult> => {
    await writeAuditRow(serviceClient, {
      userId: auth.userId,
      tokenId: auth.tokenId,
      toolName,
      args,
      outcome: "denied",
      resultSummary: message,
    });
    void touchLastUsed(serviceClient, auth.tokenId).catch(() => {});
    return errorResult(message);
  };

  if (!tokenHasScope(auth.scopes, requiredScope)) {
    return deny(`This token doesn't have "${requiredScope}" permission.`);
  }

  const rateLimit = await checkRateLimit(serviceClient, auth.tokenId);
  if (!rateLimit.ok) {
    return deny(rateLimit.message ?? "Rate limited.");
  }

  let outcome: McpAuditOutcome = "ok";
  let resultSummary = "";
  let toolResult: CallToolResult;
  try {
    const jwt = await mintSessionJwt(auth.userId);
    const userClient = buildUserScopedClient(jwt);
    const { result, summary } = await fn(userClient, auth.userId);
    toolResult = result;
    resultSummary = summary;
  } catch (e) {
    outcome = "error";
    resultSummary = e instanceof Error ? e.message.slice(0, 500) : "Unknown error";
    toolResult = errorResult("Something went wrong running that tool.");
  }

  // AUDIT WRITTEN BEFORE THE TOOL RETURNS, unconditionally, for both the ok
  // and error paths above -- not an afterthought bolted on after `return`.
  // A process death between "wrote the row" and "sent the response" still
  // leaves the record; a process death between "ran the tool" and "wrote
  // the row" is exactly the gap this ordering closes, by making the write
  // happen first and awaiting it.
  //
  // A FAILURE OF THE AUDIT WRITE ITSELF overrides an otherwise-successful
  // result into an error response -- deliberately, even though the
  // underlying tool action (for a future write tool) may genuinely have
  // already succeeded. The guardrail this connector's accepted-risk
  // tradeoff depends on is "every call is audited"; a result we cannot
  // confirm was recorded cannot be reported as a clean success without
  // quietly giving that guarantee up the one time it would have mattered.
  try {
    await writeAuditRow(serviceClient, { userId: auth.userId, tokenId: auth.tokenId, toolName, args, outcome, resultSummary });
  } catch {
    return errorResult("That may have worked, but it couldn't be recorded, so it's being reported as failed. Try again.");
  }

  void touchLastUsed(serviceClient, auth.tokenId).catch(() => {}); // best-effort; never blocks or fails the call
  return toolResult;
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
