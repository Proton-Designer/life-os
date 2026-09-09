"use server";

import { requireUser } from "@/lib/supabase/auth";
import { revalidatePath } from "next/cache";
import { setKillListItemCore, toggleKillListItemCore, saveBusinessWeeklyGoalCore, startWorkSessionCore, endWorkSessionCore } from "@/lib/business/actions-core";

/** THIN WRAPPER over setKillListItemCore (lib/business/actions-core.ts, L6/R5) — same core the MCP write tool calls. */
export async function setKillListItem(date: string, position: 0 | 1 | 2, text: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  await setKillListItemCore(supabase, userId, date, position, text);
  revalidatePath("/business");
  revalidatePath("/");
}

/** THIN WRAPPER over toggleKillListItemCore. */
export async function toggleKillListItem(id: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  await toggleKillListItemCore(supabase, userId, id);
  revalidatePath("/business");
  revalidatePath("/");
}

// getWeeklySignalNoiseRatio deliberately isn't re-exported from here: a plain
// `export { X } from ...` re-export inside a "use server" file breaks Next's
// server-action manifest generation in dev (Turbopack reports "the module has
// no exports at all" for every real export once a non-function re-export is
// present). It's not a Server Action anyway — import it directly from
// @/lib/business/sn-ratio (this page and Insights, Task 12.1, both do).

/**
 * THIN WRAPPER over saveBusinessWeeklyGoalCore — minimal weekly-goal save
 * for the Business domain screen — a plain upsert, no locking/carry-forward.
 * Task 11.1 (Weekly Planning) owns the real `saveWeeklyGoal` with that
 * logic and generalizes this card's UI pattern into
 * `components/shared/goal-card.tsx`, per the plan's own note that this
 * component is a precursor to that shared version.
 */
export async function saveBusinessWeeklyGoal(weekStartDate: string, headline: string, milestones: string[]): Promise<void> {
  const { supabase, userId } = await requireUser();
  await saveBusinessWeeklyGoalCore(supabase, userId, weekStartDate, headline, milestones);
  revalidatePath("/business");
}

/**
 * THIN WRAPPER over startWorkSessionCore. "At most one active session per
 * user" is an application-level invariant (enforced in the core, not a DB
 * constraint) — simplest correct approach for a single-user app, per the
 * design spec.
 */
export async function startWorkSession(kind: "deep_work" | "deep_study"): Promise<{ id: string; startedAt: string }> {
  const { supabase, userId } = await requireUser();
  const result = await startWorkSessionCore(supabase, userId, kind);
  revalidatePath("/business");
  revalidatePath("/");
  return result;
}

/** THIN WRAPPER over endWorkSessionCore. */
export async function endWorkSession(sessionId: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  await endWorkSessionCore(supabase, userId, sessionId);
  revalidatePath("/business");
  revalidatePath("/");
}
