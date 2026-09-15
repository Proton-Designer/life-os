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
