import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { WorkSessionKind } from "@/lib/business/work-session-kind";
import { loadSessionObjectivesCore, type SessionObjective } from "@/lib/business/session-objectives";

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

export type ActiveWorkSessionDetail = {
  id: string;
  startedAt: string;
  kind: WorkSessionKind;
  goalMinutes: number | null;
  objectives: SessionObjective[];
};

/**
 * The RICH shape (146/Phase 3) — everything the Lock-In provider and
 * overlay need: goal, and objectives with live completion joined in
 * (loadSessionObjectivesCore, lib/business/session-objectives.ts). A
 * separate `cache()` entry from the lean `getActiveWorkSession` above, not
 * a replacement for it — callers that only need to know WHETHER a session
 * is active (layout.tsx, get-domain-snapshots.ts, get-user-domains.ts) have
 * no reason to pay for the objectives join, and changing their import would
 * be an unrelated, unreviewed behavior change to code this feature doesn't
 * touch. AppShell (the one caller that feeds the provider) uses this one
 * instead of the lean one.
 */
export const getActiveWorkSessionDetail = cache(
  async (userId: string): Promise<ActiveWorkSessionDetail | null> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("work_sessions")
      .select("id, started_at, kind, goal_minutes")
      .eq("user_id", userId)
      .is("ended_at", null)
      .eq("counts_toward_hours", true)
      .maybeSingle();
    if (!data) return null;

    const objectives = await loadSessionObjectivesCore(supabase, userId, data.id);
    return {
      id: data.id,
      startedAt: data.started_at,
      kind: data.kind as WorkSessionKind,
      goalMinutes: data.goal_minutes,
      objectives,
    };
  }
);
