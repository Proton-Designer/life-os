import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptSecret, last4 } from "@/lib/ai/encryption";
import type { WhoopTokenSet } from "@/lib/whoop/client";

/**
 * P3-18 -- R5 extraction, same reasoning as canvas/connection-core.ts:
 * the OAuth callback route (cookie-authed, requireUser()) and, someday, a
 * refresh/data-sync job would share this exact save/read shape. Only the
 * save half is used tonight (no sync job built -- see OPEN_QUESTIONS.md).
 *
 * NEVER returns encrypted_access_token/encrypted_refresh_token, or their
 * decrypted values, from `getWhoopConnectionStatusCore` -- only a last4
 * display hint, per the Lead's explicit ruling.
 */

export interface WhoopConnectionStatus {
  connected: boolean;
  accessTokenLast4: string | null;
  connectedAt: string | null;
  scope: string | null;
}

export async function saveWhoopConnectionCore(supabase: SupabaseClient, userId: string, tokens: WhoopTokenSet): Promise<void> {
  const { error } = await supabase.from("whoop_connections").upsert(
    {
      user_id: userId,
      encrypted_access_token: encryptSecret(tokens.accessToken),
      encrypted_refresh_token: encryptSecret(tokens.refreshToken),
      access_token_last4: last4(tokens.accessToken),
      token_expires_at: tokens.expiresAt,
      scope: tokens.scope,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}

export async function getWhoopConnectionStatusCore(supabase: SupabaseClient, userId: string): Promise<WhoopConnectionStatus> {
  const { data } = await supabase.from("whoop_connections").select("access_token_last4, connected_at, scope").eq("user_id", userId).maybeSingle();
  if (!data) return { connected: false, accessTokenLast4: null, connectedAt: null, scope: null };
  return { connected: true, accessTokenLast4: data.access_token_last4, connectedAt: data.connected_at, scope: data.scope };
}

export async function disconnectWhoopCore(supabase: SupabaseClient, userId: string): Promise<void> {
  const { error } = await supabase.from("whoop_connections").delete().eq("user_id", userId);
  if (error) throw error;
}
