"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { isWhoopConfigured } from "@/lib/whoop/config";
import { getWhoopConnectionStatusCore, disconnectWhoopCore, type WhoopConnectionStatus } from "@/lib/whoop/connection-core";

/**
 * P3-18 -- Whoop is env-gated: connecting itself happens via the
 * redirect-based /api/whoop/authorize route (a real browser navigation,
 * not a Server Action -- OAuth2's authorization-code flow needs a full
 * page redirect to Whoop's own consent screen), so there is no
 * `connectWhoop` action here. This file only reads/clears the resulting
 * connection.
 *
 * Both exports here are marked `excluded: credential` in the MCP parity
 * manifest per the Lead's ruling -- connection status/disconnect for a
 * wearable-data credential should not be agent-triggerable.
 */

export interface WhoopSettingsStatus extends WhoopConnectionStatus {
  configured: boolean;
}

export async function getWhoopSettingsStatus(): Promise<WhoopSettingsStatus> {
  const configured = isWhoopConfigured();
  if (!configured) return { configured: false, connected: false, accessTokenLast4: null, connectedAt: null, scope: null };
  const { supabase, userId } = await requireUser();
  const status = await getWhoopConnectionStatusCore(supabase, userId);
  return { configured: true, ...status };
}

export interface WhoopActionResult {
  ok: boolean;
  message: string;
}

export async function disconnectWhoop(): Promise<WhoopActionResult> {
  const { supabase, userId } = await requireUser();
  try {
    await disconnectWhoopCore(supabase, userId);
  } catch {
    return { ok: false, message: "Couldn't disconnect. Try again." };
  }
  revalidatePath("/settings");
  return { ok: true, message: "Disconnected." };
}
