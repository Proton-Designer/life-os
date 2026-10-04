import type { SupabaseClient } from "@supabase/supabase-js";
import { ToolInputError } from "./tool-input-error";
import { isDeenModeOn } from "@/lib/deen/deen-mode";

/**
 * Deen Mode (profiles.deen_mode) gate for the AI connector (user decision A2,
 * 2026-10-04): when the token owner's Deen Mode is OFF, the `deen` domain is
 * invisible to agents and every read/write/schedule/widget aimed at it is
 * REFUSED -- before any deen table is touched. Data is never deleted or
 * changed; OFF -> ON restores the connector exactly. `deen_mode` itself is
 * never MCP-writable (no profile write in write-registry exposes it).
 *
 * Fails CLOSED: a missing row, a missing column or a query error all read as
 * OFF. The profile is read with the caller's RLS-scoped client plus an
 * explicit user_id filter (same belt-and-suspenders as the rest of lib/mcp).
 */

export const DEEN_DOMAIN = "deen";

export const DEEN_OFF_MESSAGE =
  'The "deen" domain is unavailable: Deen Mode is off for this account. The account owner can turn it on in Settings -> Features.';

/** True only when the owner's profile has deen_mode === true. */
export async function readDeenMode(client: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await client.from("profiles").select("deen_mode").eq("user_id", userId).maybeSingle();
  if (error) return false;
  return isDeenModeOn(data as { deen_mode?: boolean | null } | null);
}

/** Throws the structured, caller-safe refusal when `domain` is `deen` and Deen Mode is off. Any other domain: no query, no effect. */
export async function assertDeenAvailable(client: SupabaseClient, userId: string, domain: unknown): Promise<void> {
  if (domain !== DEEN_DOMAIN) return;
  if (!(await readDeenMode(client, userId))) throw new ToolInputError(DEEN_OFF_MESSAGE);
}

/** settings.profile columns that exist only for prayer features -- hidden from agent reads while Deen Mode is off. */
export const DEEN_PROFILE_COLUMNS: ReadonlySet<string> = new Set([
  "prayer_calc_method",
  "asr_madhab",
  "location_lat",
  "location_lng",
  "location_label",
  "qada_owed",
  "traveling_mode",
]);
