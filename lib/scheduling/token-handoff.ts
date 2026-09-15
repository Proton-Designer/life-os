import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * P4-11 — hand a user's scheduled actions from one access token to its
 * legitimate successor.
 *
 * `mcp_scheduled_actions.token_id` is the credential a schedule fires under;
 * the runner re-checks it at every fire (`getLiveTokenById`,
 * lib/mcp/scheduler-runner.ts) and PAUSES the row if it is revoked. An OAuth
 * refresh (app/api/mcp/oauth/token/route.ts) rotates the access token and
 * revokes the old one, so without this every schedule a Claude.ai/ChatGPT
 * connector created died at the client's first refresh.
 *
 * CALL IT ONLY FOR A LEGITIMATE ROTATION, and before revoking the old token.
 * Never from refresh-token reuse detection: that is a theft signal, and the
 * stolen chain's schedules must stay denied.
 *
 * Scoped by `user_id` as well as `token_id` (service-role client, so the
 * filter is the tenancy guard; the composite FK from migration 150 would also
 * refuse a cross-user token). Returns how many rows moved. Throws on a DB
 * error so the caller can fail the rotation closed.
 */
export async function repointScheduledActionsToken(
  serviceClient: SupabaseClient,
  userId: string,
  oldTokenId: string,
  newTokenId: string,
): Promise<number> {
  const { data, error } = await serviceClient
    .from("mcp_scheduled_actions")
    .update({ token_id: newTokenId })
    .eq("user_id", userId)
    .eq("token_id", oldTokenId)
    .select("id");
  if (error) throw new Error(`Could not move scheduled actions to the refreshed token: ${error.message}`);
  return data?.length ?? 0;
}
