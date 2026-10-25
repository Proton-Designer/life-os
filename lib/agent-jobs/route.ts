import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasAnyAiKey } from "@/lib/ai/resolve-key";
import { hasAgentConnector } from "./core";

export type AiRequestRoute = "inline" | "queue" | "none";

/**
 * Where a request-triggered AI feature goes (design note §6): with a key it runs inline exactly as before; with no key but a live
 * write-capable connector it is queued for the person's agent; with neither there is nothing that could ever do it, so the caller
 * keeps its existing "add a key" outcome and no job is created.
 */
export async function routeAiRequest(supabase: SupabaseClient, userId: string, now: Date): Promise<AiRequestRoute> {
  if (await hasAnyAiKey(supabase, userId)) return "inline";
  return (await hasAgentConnector(supabase, userId, now)) ? "queue" : "none";
}
