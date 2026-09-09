import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type McpAuditOutcome = "ok" | "error" | "denied";

export interface McpAuditEntry {
  userId: string;
  /** Null only for a call that somehow reached here with no resolvable token — should not happen past verifyAccessToken, kept nullable to match the column (migration 130's ON DELETE SET NULL). */
  tokenId: string | null;
  toolName: string;
  /** Whatever the caller sent, as given to the tool — untrusted input, logged as-is for the audit trail's own sake, not re-validated here. */
  args: unknown;
  outcome: McpAuditOutcome;
  resultSummary?: string | null;
}

/**
 * Writes one append-only audit row. THROWS on failure — does not swallow it
 * — because this IS the accepted-risk mitigation PROGRAM-PLAN.md names for
 * write-capable tools reading untrusted content: an audit write failure
 * must fail the whole tool call, not silently proceed unaudited. The caller
 * (lib/mcp/tool-wrapper.ts) is responsible for converting that into an
 * error response to the MCP client rather than catching and ignoring it.
 *
 * `supabase` must be the service-role client — migration 130 deliberately
 * grants the user's own RLS-scoped client SELECT only on this table, no
 * INSERT policy at all (see the migration's own header on why: "an audit
 * log the subject can edit is not an audit log").
 */
export async function writeAuditRow(supabase: SupabaseClient, entry: McpAuditEntry): Promise<void> {
  const { error } = await supabase.from("mcp_audit_log").insert({
    user_id: entry.userId,
    token_id: entry.tokenId,
    tool_name: entry.toolName,
    args: entry.args ?? {},
    outcome: entry.outcome,
    result_summary: entry.resultSummary ?? null,
  });
  if (error) {
    throw new Error(`mcp audit write failed (tool=${entry.toolName}, outcome=${entry.outcome}): ${error.message}`);
  }
}
