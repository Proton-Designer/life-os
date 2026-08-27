import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { WorkSessionKind } from "@/lib/business/work-session-kind";

// cache() memoizes this per-request (React's request-scoped dedup, not a
// cross-request cache) — AppShell (which feeds the app-wide Lock-In overlay
// provider), Home's Focus module, and the Business page all need this exact
// query, and wrapping it here means only one of them pays the round trip.
// Request-scoped only, matches getAuthedUser()'s pattern in
// lib/supabase/auth.ts.
export const getActiveWorkSession = cache(
  async (userId: string): Promise<{ id: string; startedAt: string; kind: WorkSessionKind } | null> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("work_sessions")
      .select("id, started_at, kind")
      .eq("user_id", userId)
      .is("ended_at", null)
      .maybeSingle();
    return data ? { id: data.id, startedAt: data.started_at, kind: data.kind as WorkSessionKind } : null;
  }
);
