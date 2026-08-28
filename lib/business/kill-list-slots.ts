import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { KillListSlotData } from "@/components/business/kill-list";

// cache() memoizes this per-request (React's request-scoped dedup, same
// pattern as getActiveWorkSession in active-session.ts) — AppShell (which
// feeds the app-wide Lock-In overlay) and the Business page both need
// today's kill list, and wrapping it here means only one of them pays the
// round trip when both run in the same request.
export const getKillListSlots = cache(
  async (userId: string, dateStr: string): Promise<[KillListSlotData, KillListSlotData, KillListSlotData]> => {
    const supabase = await createClient();
    const { data: killListRows } = await supabase
      .from("kill_list_items")
      .select("id, position, text, completed")
      .eq("user_id", userId)
      .eq("date", dateStr)
      .order("position", { ascending: true });

    return [0, 1, 2].map((position) => {
      const row = killListRows?.find((r) => r.position === position);
      return { id: row?.id ?? null, text: row?.text ?? "", completed: row?.completed ?? false };
    }) as [KillListSlotData, KillListSlotData, KillListSlotData];
  }
);
