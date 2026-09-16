import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashToken, createAccessToken, validateScopes, type McpScope, type McpTokenStatus } from "@/lib/mcp/tokens";
import { expiresAtForChoice, isTokenExpiryChoice, type TokenExpiryChoice } from "@/lib/mcp/token-expiry";

/**
 * P4-21 — single-use, one-click "connect your agent" codes (migration
 * 207, agent_connect_codes). A Settings-generated link
 * (`/connect/<raw code>`) that an agent opens (GET) or POSTs to instead
 * of a long-lived token being pasted directly into a chat transcript.
 *
 * BEARER CREDENTIAL, SAME DISCIPLINE AS A PAT (Opus Lead ruling): 32
 * random bytes, stored as a SHA-256 hash only (reuses `hashToken` from
 * tokens.ts — same shape, one implementation), shown once in the URL,
 * never logged, never echoed in an error message.
 *
 * GET-OR-POST, WHICHEVER FIRES FIRST, BOTH BURN THE CODE (resolved
 * against the source spec, see the task's own board Log): this is the
 * ONE shared exchange function `app/connect/[code]/route.ts` calls from
 * both its GET and POST handlers, so the burn-on-first-hit guarantee
 * lives in exactly one place regardless of which verb consumes the code.
 */

const CONNECT_CODE_TTL_MS = 10 * 60 * 1000;

function generateConnectCode(): string {
  return randomBytes(32).toString("base64url");
}

export interface CreateConnectCodeResult {
  ok: boolean;
  message: string;
  /** The RAW code — exists on this result exactly once, at creation, same posture as createAccessToken's own `token` field. */
  code?: string;
  expiresAt?: string;
}

export async function createConnectCodeCore(
  supabase: SupabaseClient,
  userId: string,
  scopes: McpScope[],
  tokenExpiry: TokenExpiryChoice,
  label?: string,
): Promise<CreateConnectCodeResult> {
  const scopeError = validateScopes(scopes);
  if (scopeError) return { ok: false, message: scopeError };
  if (!isTokenExpiryChoice(tokenExpiry)) return { ok: false, message: "Invalid token expiry." };

  const rawCode = generateConnectCode();
  const expiresAt = new Date(Date.now() + CONNECT_CODE_TTL_MS).toISOString();
  const { error } = await supabase.from("agent_connect_codes").insert({
    user_id: userId,
    code_hash: hashToken(rawCode),
    scopes,
    token_expiry_choice: tokenExpiry,
    label: label?.trim() || null,
    expires_at: expiresAt,
  });
  if (error) return { ok: false, message: "Couldn't create a connect link. Try again." };
  return { ok: true, message: "Connect link created.", code: rawCode, expiresAt };
}

export type ExchangeConnectCodeResult =
  | { ok: true; token: string; status: McpTokenStatus }
  /**
   * Opus Lead ruling: "Unknown, expired and already-used codes must all
   * return the SAME response with no wording or timing difference" — a
   * SINGLE reason on purpose, never a discriminated one the route could
   * accidentally render differently per case. Any distinguishing detail
   * (which case, whose code) stays server-side only, never in this
   * return value.
   */
  | { ok: false };

/**
 * `serviceClient` MUST be a service-role client — the agent hitting
 * `/connect/[code]` is never authenticated as the owning user at all, so
 * there is no RLS-scoped client to use here (same posture as
 * app/api/mcp/oauth/token/route.ts's own code exchange).
 *
 * Burns the code via a CONDITIONAL UPDATE guarded on `used_at IS NULL`
 * (the same "a retry lands on a safe branch" idiom staging-core.ts's own
 * confirm path uses) — a genuine race between two near-simultaneous
 * GET+POST hits on the same code can only ever mint ONE token, never two.
 */
export async function exchangeConnectCodeCore(serviceClient: SupabaseClient, rawCode: string): Promise<ExchangeConnectCodeResult> {
  const codeHash = hashToken(rawCode);
  const { data: row, error } = await serviceClient
    .from("agent_connect_codes")
    .select("id, user_id, scopes, token_expiry_choice, label, expires_at, used_at")
    .eq("code_hash", codeHash)
    .maybeSingle();
  if (error || !row) return { ok: false };
  if (row.used_at !== null) return { ok: false };
  if (new Date(row.expires_at).getTime() <= Date.now()) return { ok: false };

  const { data: burned, error: burnError } = await serviceClient
    .from("agent_connect_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (burnError || !burned) return { ok: false };

  const mintResult = await createAccessToken(serviceClient, row.user_id, row.label ?? "Connected agent", row.scopes as McpScope[], {
    expiresAt: expiresAtForChoice(row.token_expiry_choice as TokenExpiryChoice),
    clientKind: "agent",
  });
  if (!mintResult.ok || !mintResult.token || !mintResult.status) return { ok: false };

  await serviceClient.from("agent_connect_codes").update({ minted_token_id: mintResult.status.id }).eq("id", row.id);

  return { ok: true, token: mintResult.token, status: mintResult.status };
}
