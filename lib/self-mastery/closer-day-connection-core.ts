import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasAnyAiKey } from "@/lib/ai/resolve-key";
import { briefSourceLabel } from "@/lib/morning-brief/brief-source";

import type { CloserDayConnectionResult } from "./closer-day-connection-types";

/**
 * Order: (1) a line an agent already wrote for this card and local day (migration 276); (2) with no AI key at all, the empty
 * state ("Connect an agent or add a key"), without any model call; (3) otherwise the in-app generator. Never throws for a read
 * failure: the closer card renders regardless, this is supplementary.
 */
export async function getCloserDayConnectionCore(
  supabase: SupabaseClient,
  userId: string,
  cardId: string,
  todayStr: string,
  generate: () => Promise<string | null>,
): Promise<CloserDayConnectionResult | null> {
  const { data: stored } = await supabase
    .from("card_day_connections")
    .select("connection_text, provider, model")
    .eq("user_id", userId)
    .eq("card_id", cardId)
    .eq("connection_date", todayStr)
    .maybeSingle();
  const row = stored as { connection_text: string; provider: string | null; model: string | null } | null;
  if (row?.connection_text) return { kind: "line", text: row.connection_text, sourceLabel: briefSourceLabel(row.provider, row.model) };

  if (!(await hasAnyAiKey(supabase, userId))) return { kind: "no_ai" };

  const text = await generate();
  return text ? { kind: "line", text, sourceLabel: null } : null;
}
