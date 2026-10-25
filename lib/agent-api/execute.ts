import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { tokenHasScope, touchLastUsed, type McpScope } from "@/lib/mcp/tokens";
import { consumeRateLimit } from "@/lib/mcp/rate-limit";
import { writeAuditRow, type McpAuditOutcome, type McpAuditTransport } from "@/lib/mcp/audit";
import { mintSessionJwt, buildUserScopedClient } from "@/lib/mcp/session";
import { readMcpAuth, type AuthInfoLike } from "@/lib/mcp/auth-info";
import { ToolInputError, ToolNotFoundError } from "@/lib/mcp/tool-input-error";
import { enqueueWriteOkWebhookDeliveries } from "@/lib/mcp/webhook-dispatch";

/**
 * The transport-neutral operation core (P4-02; design in the overnight
 * run's p4-audit/instinct-and-rest.md §3.1). Every agent-facing call —
 * MCP today, REST (/api/v1) and the scheduler as adapters — composes the
 * same chain here, once: auth read → scope check → rate limit → session
 * mint → the operation's own logic → audit write, in that order. The
 * ordering IS the guarantee (see the audit comments below), so no adapter
 * re-derives it.
 *
 * What changed vs. the old `runMcpTool` body: nothing about the chain.
 * Only the RESULT is typed — `{ok:false, code, status, message}` instead of
 * MCP error text — so a transport with status codes can use it. The MCP
 * adapter (lib/mcp/tool-wrapper.ts) maps it straight back: success returns
 * the tool's own `CallToolResult` object untouched (`toolResult`), and each
 * failure's `message` is exactly the text runMcpTool always returned.
 *
 * Tools still produce MCP-shaped `CallToolResult`s (47+ result sites across
 * the registries); `data`/`text` are the neutral views of that result for
 * non-MCP transports, and `toolResult` is kept so the MCP path never
 * round-trips through a rebuild that could drift.
 */

/** Which adapter made the call. Read by the audit log's `transport` column (migration 215, P4-12): every audit row this core writes records it. */
export type AgentTransport = McpAuditTransport;

/** One tool's result plus a short audit line — the shape every tool function returns. Re-exported by tool-wrapper.ts as `RunMcpToolOutcome`. */
export interface ToolOutcome {
  result: CallToolResult;
  /** One short line for mcp_audit_log.result_summary — e.g. "returned 3 tasks". Never the full payload; that already exists in `result`/`args`. */
  summary: string;
}

/**
 * An already-resolved operation: which tool, the audit `operation` string
 * (e.g. "deen.prayer.log", computed from args BEFORE dispatch so an
 * args-only failure still logs what was attempted), the scope it needs,
 * the raw args (audited verbatim), and the function that runs it.
 */
export interface OperationSpec {
  toolName: string;
  operation: string;
  requiredScope: McpScope;
  args: unknown;
  // Untyped client on purpose: a registry-driven dispatcher's table name is
  // a runtime string, which the generated `Database` union can't type.
  run: (userClient: SupabaseClient, userId: string, caller: { tokenId: string }) => Promise<ToolOutcome>;
}

export type OperationErrorCode = "unauthenticated" | "insufficient_scope" | "rate_limited" | "invalid_input" | "not_found" | "audit_failed" | "internal";

export const OPERATION_ERROR_STATUS: Record<OperationErrorCode, number> = {
  unauthenticated: 401,
  insufficient_scope: 403,
  rate_limited: 429,
  invalid_input: 400,
  not_found: 404,
  audit_failed: 503,
  internal: 500,
};

export interface OperationSuccess {
  ok: true;
  /** The tool's `structuredContent`, or null when it returned none. */
  data: unknown;
  /** The tool's text content (text blocks joined with newlines). */
  text: string;
  summary: string;
  /** The tool's own result object, untouched — what the MCP adapter returns. */
  toolResult: CallToolResult;
}

export interface OperationFailure {
  ok: false;
  code: OperationErrorCode;
  status: number;
  /** Always safe to show the caller: static text, or a ToolInputError's own message. Never a raw internal error. */
  message: string;
  /** P4-14: only on `rate_limited` -- seconds until the window resets (REST sends it as Retry-After; the MCP text says it). */
  retryAfterSeconds?: number;
}

export type OperationResult = OperationSuccess | OperationFailure;

export const GENERIC_TOOL_ERROR_MESSAGE = "Something went wrong running that tool.";
export const AUDIT_FAILED_MESSAGE = "That may have worked, but it couldn't be recorded, so it's being reported as failed. Try again.";

function failure(code: OperationErrorCode, message: string): OperationFailure {
  return { ok: false, code, status: OPERATION_ERROR_STATUS[code], message };
}

/** Never throws (it runs inside the tool try-block, so a throw here would turn a real success into an audited error). */
function textOfResult(result: CallToolResult): string {
  if (!Array.isArray(result.content)) return "";
  return result.content
    .filter((block): block is Extract<CallToolResult["content"][number], { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export async function executeOperation(
  serviceClient: SupabaseClient,
  authInfo: AuthInfoLike | undefined,
  op: OperationSpec,
  // Recorded on every audit row below (mcp_audit_log.transport, migration 215).
  transport: AgentTransport,
): Promise<OperationResult> {
  const { toolName, operation, requiredScope, args } = op;
  const auth = readMcpAuth(authInfo);
  if (!auth) {
    // The transport's own auth layer (withMcpAuth for MCP) is supposed to
    // reject an unauthenticated call before any operation runs at all.
    // Reaching here with nothing to read is that guarantee failing, not a
    // normal permission denial -- and there is no userId to attribute an
    // audit row to (the column is NOT NULL), so none is written.
    return failure("unauthenticated", "Not authenticated.");
  }

  // A denial's own audit write is awaited and NOT caught: if it fails, this
  // rejects, exactly as runMcpTool always has.
  const deny = async (code: "insufficient_scope" | "rate_limited", message: string, retryAfterSeconds?: number): Promise<OperationFailure> => {
    await writeAuditRow(serviceClient, {
      userId: auth.userId,
      tokenId: auth.tokenId,
      toolName,
      operation,
      args,
      outcome: "denied",
      resultSummary: message,
      transport,
    });
    void touchLastUsed(serviceClient, auth.tokenId).catch(() => {});
    const denied = failure(code, message);
    return retryAfterSeconds !== undefined ? { ...denied, retryAfterSeconds } : denied;
  };

  if (!tokenHasScope(auth.scopes, requiredScope)) {
    return deny("insufficient_scope", `This token doesn't have "${requiredScope}" permission.`);
  }

  // P4-14: one atomic RPC (migration 220) -- per token AND per user, all or
  // nothing, and a denial consumes nothing. Scheduled fires draw on their own
  // lane so a busy interactive session can't make them fail; MCP and REST
  // share the interactive lane (one budget per token across both).
  const rateLimit = await consumeRateLimit(serviceClient, {
    tokenId: auth.tokenId,
    userId: auth.userId,
    lane: transport === "scheduler" ? "scheduler" : "interactive",
  });
  if (!rateLimit.ok) {
    return deny("rate_limited", rateLimit.message ?? "Rate limited.", rateLimit.retryAfterSeconds);
  }

  let outcome: McpAuditOutcome = "ok";
  let resultSummary = "";
  let result: OperationResult;
  try {
    const jwt = await mintSessionJwt(auth.userId);
    const userClient = buildUserScopedClient(jwt);
    const { result: toolResult, summary } = await op.run(userClient, auth.userId, { tokenId: auth.tokenId });
    resultSummary = summary;
    result = { ok: true, data: toolResult.structuredContent ?? null, text: textOfResult(toolResult), summary, toolResult };
  } catch (e) {
    outcome = "error";
    resultSummary = e instanceof Error ? e.message.slice(0, 500) : "Unknown error";
    // ToolInputError (lib/mcp/tool-input-error.ts) is the ONE exception to
    // the generic message — its message is written to be safe to hand back
    // verbatim (see that class's own doc comment on exactly what it may and
    // may not contain). ToolNotFoundError is its subclass, split out only
    // for the status code. Every other thrown value — a bare Error, a
    // Postgres error, anything else — stays behind the generic text.
    if (e instanceof ToolNotFoundError) result = failure("not_found", e.message);
    else if (e instanceof ToolInputError) result = failure("invalid_input", e.message);
    else result = failure("internal", GENERIC_TOOL_ERROR_MESSAGE);
  }

  // AUDIT WRITTEN BEFORE THE OPERATION RETURNS, unconditionally, for both the
  // ok and error paths above -- not an afterthought bolted on after `return`.
  // A process death between "wrote the row" and "sent the response" still
  // leaves the record; a process death between "ran the tool" and "wrote
  // the row" is exactly the gap this ordering closes, by making the write
  // happen first and awaiting it.
  //
  // A FAILURE OF THE AUDIT WRITE ITSELF overrides an otherwise-successful
  // result into an error response -- deliberately, even though the
  // underlying action may genuinely have already succeeded. The guardrail
  // this connector's accepted-risk tradeoff depends on is "every call is
  // audited"; a result we cannot confirm was recorded cannot be reported as
  // a clean success without quietly giving that guarantee up the one time
  // it would have mattered.
  try {
    await writeAuditRow(serviceClient, { userId: auth.userId, tokenId: auth.tokenId, toolName, operation, args, outcome, resultSummary, transport });
  } catch {
    return failure("audit_failed", AUDIT_FAILED_MESSAGE);
  }

  void touchLastUsed(serviceClient, auth.tokenId).catch(() => {}); // best-effort; never blocks or fails the call

  // P4-22: enqueue webhook deliveries for a successful write only --
  // best-effort, never blocks or fails the call, same posture as
  // touchLastUsed above. Never inline delivery: this only ever inserts a
  // queue row (or, for the common case of zero webhooks, one cheap select
  // and nothing else); the actual HTTP delivery happens later, out of this
  // request, via lib/mcp/webhook-dispatch.ts's processWebhookDeliveries.
  //
  // WRAPPED IN after(), NOT a bare unawaited `void promise.catch()` --
  // found live, during this task's own end-to-end verification: a bare
  // fire-and-forget promise is not reliably run to completion on Vercel
  // once the response has been sent (this function does a SELECT then an
  // INSERT, two round trips; zero deliveries were ever enqueued in a real
  // prod request despite the identical-shaped touchLastUsed call above it
  // succeeding, which is consistent with the runtime freezing shortly
  // after the response, before the second round trip lands).
  // `after()` (next/server, stable since Next 15) is Next's own answer to
  // this exact problem — it keeps the serverless function alive for
  // exactly this kind of post-response background work. Every current
  // caller of executeOperation (MCP route, REST routes, the cron-driven
  // scheduler runner) genuinely runs inside a real Next.js request scope,
  // which is `after()`'s own hard requirement -- confirmed by reading
  // every caller, not assumed.
  if (toolName === "write" && outcome === "ok") {
    after(() => enqueueWriteOkWebhookDeliveries(serviceClient, auth.userId, { operation, summary: resultSummary }).catch(() => {}));
  }

  return result;
}
