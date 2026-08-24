import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// cache() memoizes this per-request (React's request-scoped dedup, not a
// cross-request cache) — AppShell's topbar Lock-In dot and Home's Focus
// module both need this exact query, and wrapping it here means only one of
// them pays the round trip. Request-scoped only, matches getAuthedUser()'s
// pattern in lib/supabase/auth.ts.
export const getActiveWorkSession = cache(
  async (
    userId: string
  ): Promise<{ id: string; startedAt: string; kind: "deep_work" | "deep_study" } | null> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("work_sessions")
      .select("id, started_at, kind")
      .eq("user_id", userId)
      .is("ended_at", null)
      .maybeSingle();
    return data ? { id: data.id, startedAt: data.started_at, kind: data.kind as "deep_work" | "deep_study" } : null;
  }
);
