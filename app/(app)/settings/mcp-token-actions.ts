"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import {
  createAccessToken,
  listAccessTokens,
  revokeAccessToken,
  validateScopes,
  type McpScope,
  type McpTokenStatus,
} from "@/lib/mcp/tokens";
import { DEFAULT_TOKEN_EXPIRY, expiresAtForChoice, isTokenExpiryChoice } from "@/lib/mcp/token-expiry";
import { listScheduledActionsCore, pauseScheduledActionCore, cancelScheduledActionCore, type ScheduledActionItem } from "@/lib/scheduling/scheduler-core";
import { createConnectCodeCore } from "@/lib/mcp/connect-codes";
import { ToolNotFoundError } from "@/lib/mcp/tool-input-error";

/**
 * MCP personal-access-token management (L2, docs/ai-connector/PROGRAM-PLAN.md).
 *
 * THE ONE RULE THIS FILE ENFORCES, same as api-key-actions.ts: no function
 * here ever returns a token's raw value back OUT of a successful creation.
 * `McpTokenStatus` carries last4 and nothing secret — `createMcpToken`'s
 * result is the single exception, and only because creation is the one
 * moment the raw value is allowed to exist at all (see lib/mcp/tokens.ts).
 *
 * This layer does NOT stand up an MCP server — there is nothing yet that
 * reads these tokens to authenticate a request. It only has to prove a
 * token can be minted, listed, and revoked, from the UI, before any
 * protocol code exists.
 */

export type { McpTokenStatus };

export interface CreateMcpTokenResult {
  ok: boolean;
  message: string;
  token?: string;
  status?: McpTokenStatus;
}

export interface McpTokenActionResult {
  ok: boolean;
  message: string;
}

export async function getMcpTokenStatuses(): Promise<McpTokenStatus[]> {
  const { supabase, userId } = await requireUser();
  return listAccessTokens(supabase, userId);
}

/**
 * `expiry` (P4-12): "7" | "30" | "90" | "never", default "90". Validated here
 * because a Server Action is a public endpoint -- the form's own select is
 * not a guarantee. Stored as a Settings "pat".
 */
export async function createMcpToken(label: string, scopes: string[], expiry: string = DEFAULT_TOKEN_EXPIRY): Promise<CreateMcpTokenResult> {
  const scopeError = validateScopes(scopes);
  if (scopeError) return { ok: false, message: scopeError };
  if (!isTokenExpiryChoice(expiry)) return { ok: false, message: "Pick an expiry: 7, 30 or 90 days, or never." };

  const { supabase, userId } = await requireUser();
  const result = await createAccessToken(supabase, userId, label, scopes as McpScope[], {
    expiresAt: expiresAtForChoice(expiry),
    clientKind: "pat",
  });
  if (result.ok) {
    revalidatePath("/settings");
  }
  return result;
}

export async function revokeMcpToken(tokenId: string): Promise<McpTokenActionResult> {
  const { supabase, userId } = await requireUser();
  const result = await revokeAccessToken(supabase, userId, tokenId);
  if (result.ok) {
    revalidatePath("/settings");
  }
  return result;
}

/**
 * P4-21 — "recent 50 audit entries (RLS select)" per connected agent.
 * `mcp_audit_log` already has a `mcp_audit_log_select_own` policy
 * (migration 130), so this is a plain authed query — no new policy, no
 * service-role client. `args`/`user_id`/`tool_name` are deliberately left
 * off the returned shape: `resultSummary` (the audit mechanism's own
 * human-readable line, already attributed at write time) is what a user
 * actually wants to read here, not a raw payload dump.
 */
export interface McpAuditEntry {
  id: number;
  operation: string;
  outcome: string;
  resultSummary: string | null;
  transport: string;
  createdAt: string;
}

const RECENT_AUDIT_LIMIT = 50;

export async function getAuditEntriesForToken(tokenId: string): Promise<McpAuditEntry[]> {
  const { supabase, userId } = await requireUser();
  const { data, error } = await supabase
    .from("mcp_audit_log")
    .select("id, operation, outcome, result_summary, transport, created_at")
    .eq("user_id", userId)
    .eq("token_id", tokenId)
    .order("created_at", { ascending: false })
    .limit(RECENT_AUDIT_LIMIT);
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id,
    operation: r.operation,
    outcome: r.outcome,
    resultSummary: r.result_summary,
    transport: r.transport,
    createdAt: r.created_at,
  }));
}

export type { ScheduledActionItem };

export async function getScheduledActions(): Promise<ScheduledActionItem[]> {
  const { supabase, userId } = await requireUser();
  return listScheduledActionsCore(supabase, userId);
}

export async function pauseScheduledAction(id: string): Promise<McpTokenActionResult> {
  const { supabase, userId } = await requireUser();
  try {
    await pauseScheduledActionCore(supabase, userId, id);
  } catch (err) {
    return { ok: false, message: err instanceof ToolNotFoundError ? err.message : "Couldn't pause that scheduled action. Try again." };
  }
  revalidatePath("/settings");
  return { ok: true, message: "Paused." };
}

export async function cancelScheduledAction(id: string): Promise<McpTokenActionResult> {
  const { supabase, userId } = await requireUser();
  try {
    await cancelScheduledActionCore(supabase, userId, id);
  } catch (err) {
    return { ok: false, message: err instanceof ToolNotFoundError ? err.message : "Couldn't cancel that scheduled action. Try again." };
  }
  revalidatePath("/settings");
  return { ok: true, message: "Cancelled." };
}

/**
 * P4-21 — the "Text-based assistant" tab's one-click connect link.
 * Returns only the RAW CODE (never a full URL — the client builds
 * `${window.location.origin}/connect/<code>`, same precedent
 * class-share-section.tsx already set for share links) and an expiry
 * instant so the UI can show "expires in 10 min" without a client-side
 * clock guess. `scopes`/`tokenExpiry` are the user's OWN choice from the
 * form — never a blanket read+write default (Opus Lead ruling).
 */
export interface CreateAgentConnectLinkResult {
  ok: boolean;
  message: string;
  code?: string;
  expiresAt?: string;
}

export async function createAgentConnectLink(scopes: string[], tokenExpiry: string, label?: string): Promise<CreateAgentConnectLinkResult> {
  const scopeError = validateScopes(scopes);
  if (scopeError) return { ok: false, message: scopeError };
  if (!isTokenExpiryChoice(tokenExpiry)) return { ok: false, message: "Pick an expiry: 7, 30 or 90 days, or never." };

  const { supabase, userId } = await requireUser();
  return createConnectCodeCore(supabase, userId, scopes as McpScope[], tokenExpiry, label);
}
