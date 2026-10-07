import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToDateString, effectiveDayString, localDateString } from "@/lib/date-utils";
import { assignRanks } from "@/lib/evening-close/rank-assignment";

/**
 * The plan stage's writes — cores extracted from app/(app)/close/plan-actions.ts
 * (P4-07, same R5/P4-06 rule: no `requireUser()`/`getProfile()` in here, so
 * the cookie-authed Server Actions and the MCP write tool share one
 * implementation). See that file's own header (still there, restated for
 * the wrappers) for the full "two target days" / "dump_source vocabulary
 * mapping" / "no estimated_minutes" reasoning — none of it changes here,
 * only the auth/timezone resolution moves to the caller.
 *
 * RETURN SHAPE PRESERVED EXACTLY (`{...}|{error:string}`), not migrated to
 * throw-based: the cookie-authed UI already pattern-matches on this shape
 * across several call sites, and changing it is a bigger, unrelated
 * behavior change. The MCP write-registry HANDLER (lib/mcp/write-registry.ts)
 * is the one place that translates `"error" in result` into a thrown
 * `ToolInputError` — every OTHER core in this codebase throws directly, but
 * this file's callers already depend on this shape, so adapting at the
 * boundary is less invasive than changing three already-shipped functions.
 */

export type PlanMode = "tonight" | "today";

/**
 * Pure now — `planningDateFor`'s auth+profile fetch moved to the caller
 * (both `app/(app)/close/plan-actions.ts` and the MCP write tool already
 * resolve `userId`/`timezone` once themselves). "tonight" (the ordinary
 * evening close) plans the user's LOCAL tomorrow; "today" (only
 * `/close/replan`) targets local today, no `+1` — see the original file's
 * header for the #29 bug this distinction fixes.
 */
export function planningDateForCore(mode: PlanMode, now: Date, timezone: string): string {
  // "today" (replan) is plain local today. "tonight" is the day AFTER the one being closed, and the
  // closed day rolls over at 4 AM (effectiveDayString): closing at 00:30 on Oct 5 closes Oct 4 and
  // plans Oct 5 -- not Oct 6.
  return mode === "today" ? localDateString(now, timezone) : addDaysToDateString(effectiveDayString(now, timezone), 1);
}

/** Persist one dumped line. Returns its id so the surface can star it. */
export async function dumpLineCore(supabase: SupabaseClient, userId: string, plannedDate: string, title: string): Promise<{ id: string } | { error: string }> {
  const trimmed = title.trim();
  if (trimmed.length === 0) return { error: "Nothing to add" };

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: userId,
      title: trimmed,
      planned_date: plannedDate,
      domain: null,
      // The engine calls this source `user`; the column calls it `note`. See
      // app/(app)/close/plan-actions.ts's own header for the full mapping.
      dump_source: "note",
      mit_rank: null,
      completed: false,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { id: data.id };
}

export type SeedSource = "worry" | "goal_milestone" | "school_risk";
export type SeedLine = { id: string; title: string; source: SeedSource };
/** Maps a seed's ORIGINAL id (a worry's own tasks.id, or a goal_milestones.id) to the real tasks.id it now lives at. Identity for worries. */
export type ClaimedSeed = { seedId: string; taskId: string };

/**
 * Turns a still-unclaimed seed line into a real dumped line, at commit time
 * only. See app/(app)/close/plan-actions.ts's own header for the full
 * WORRY/GOAL MILESTONE/SCHOOL_RISK reasoning (identity-preserving update vs.
 * fresh insert, and why the worry branch is scoped to
 * `dump_source='worry' AND completed=false`). NOT ATOMIC ACROSS SEEDS —
 * same as the original.
 */
export async function claimSeedLinesCore(
  supabase: SupabaseClient,
  userId: string,
  plannedDate: string,
  seeds: SeedLine[],
): Promise<{ claimed: ClaimedSeed[] } | { error: string }> {
  if (seeds.length === 0) return { claimed: [] };
  const claimed: ClaimedSeed[] = [];

  for (const seed of seeds) {
    if (seed.source === "worry") {
      const { data, error } = await supabase
        .from("tasks")
        .update({ planned_date: plannedDate })
        .eq("id", seed.id)
        .eq("user_id", userId)
        .eq("dump_source", "worry")
        .eq("completed", false)
        .select("id");
      if (error) return { error: error.message };
      if (data && data.length > 0) claimed.push({ seedId: seed.id, taskId: seed.id });
    } else {
      const { data, error } = await supabase
        .from("tasks")
        .insert({
          user_id: userId,
          title: seed.title,
          domain: null,
          dump_source: seed.source === "goal_milestone" ? "milestone" : "school",
          planned_date: plannedDate,
          mit_rank: null,
          completed: false,
        })
        .select("id")
        .single();
      if (error) return { error: error.message };
      claimed.push({ seedId: seed.id, taskId: data.id });
    }
  }

  return { claimed };
}

/**
 * Write the ranks. See app/(app)/close/plan-actions.ts's own header for the
 * full "clear stale ranks first" reasoning.
 *
 * ONE UPDATE PER RANKED ID, NOT A SINGLE MULTI-ROW UPSERT. The previous
 * version upserted a PARTIAL row (`{id, user_id, mit_rank}`) with
 * `onConflict: "id"`, believing that always resolves to the UPDATE branch
 * for an existing id. It doesn't: Postgres validates NOT NULL constraints
 * (title, planned_date, ...) on the CANDIDATE row before conflict
 * resolution even runs, so it failed on every plan whose task already had a
 * title — i.e. always, in real use. Found live in production (P4-07 04
 * verification, both teamb accounts): every real "Finish Plan" call was
 * failing with `null value in column "title" ... violates not-null
 * constraint`. Reproduced 3 ways — the real MCP write tool, the account's
 * own RLS-scoped client, and the service-role client with RLS bypassed
 * entirely — identical error every time, so this is core Postgres upsert
 * semantics, not an RLS quirk.
 *
 * A per-id UPDATE only ever sets the one column it names, so it can never
 * trip a NOT NULL check on a column it isn't touching. It's still safe
 * against `tasks_mit_rank_per_day_idx`: the clear above already nulled
 * every rank for this `plannedDate`, so no ranked id can collide with a
 * rank another row on this same day still holds. Each update is scoped to
 * (id, user_id, plannedDate) — both an ownership guard and, if an id
 * somehow doesn't belong to today's plan, the thing that makes a 0-row
 * update detectable rather than a silent no-op.
 */
export async function savePlanRanksCore(
  supabase: SupabaseClient,
  userId: string,
  plannedDate: string,
  starred: string[],
  crowned: string | null,
  /** Edit Plan's Save: an empty rank set means "nothing starred", so the day's old ranks are cleared. The MCP tool keeps its no-write no-op. */
  opts: { clearWhenEmpty?: boolean } = {},
): Promise<{ ok: true } | { error: string }> {
  let ranks;
  try {
    ranks = assignRanks({ starred, crowned });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid plan" };
  }
  if (ranks.length === 0 && !opts.clearWhenEmpty) return { ok: true };

  const { error: clearError } = await supabase
    .from("tasks")
    .update({ mit_rank: null })
    .eq("user_id", userId)
    .eq("planned_date", plannedDate)
    .not("mit_rank", "is", null);
  if (clearError) return { error: clearError.message };

  for (const { id, mitRank } of ranks) {
    const { data, error } = await supabase.from("tasks").update({ mit_rank: mitRank }).eq("id", id).eq("user_id", userId).eq("planned_date", plannedDate).select("id");
    if (error) {
      return { error: `Today's old ranks were cleared but the new plan didn't fully save (${error.message}). Try Finish again.` };
    }
    if (!data || data.length === 0) {
      return { error: `Today's old ranks were cleared but the new plan didn't fully save (no task "${id}" found on today's plan). Try Finish again.` };
    }
  }

  return { ok: true };
}
