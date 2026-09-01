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
      // Deep-work-class sessions ONLY. Once `kind` widens to admit 'learn'
      // (ULM's retrieval sessions), an active review would otherwise be
      // returned here and surface on Home's Focus module and the app-wide
      // Lock-In overlay as though it were Deep Work — and the cast below
      // would be a lie. Worse, a concurrent learn + deep_work session would
      // make .maybeSingle() throw, breaking AppShell, Home and Business at
      // once. Retrieval sessions are deliberately concurrent-safe: they do
      // not participate in the single-active-session model at all.
      .eq("counts_toward_hours", true)
      .maybeSingle();
    return data ? { id: data.id, startedAt: data.started_at, kind: data.kind as WorkSessionKind } : null;
  }
);
