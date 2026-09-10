"use server";

import { requireUser, getProfile } from "@/lib/supabase/auth";
import { revalidatePath } from "next/cache";
import {
  setKillListItemCore,
  toggleKillListItemCore,
  saveBusinessWeeklyGoalCore,
  startWorkSessionCore,
  endWorkSessionCore,
  toggleSessionObjectiveCore,
  type StartWorkSessionInput,
  type StartWorkSessionResult,
} from "@/lib/business/actions-core";
import {
  getClassTasksDueSoonCore,
  toKillListObjectiveOptions,
  getUserClassesCore,
  type ObjectiveTaskOption,
  type KillListObjectiveOption,
  type SessionClassOption,
} from "@/lib/business/session-setup-data";
import { getKillListSlots } from "@/lib/business/kill-list-slots";
import { getActiveWorkSessionDetail, type ActiveWorkSessionDetail } from "@/lib/business/active-session";
import { localDateString } from "@/lib/date-utils";

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
 *
 * Takes the full StartWorkSessionInput as of 146/Phase 3 (goal, class,
 * objectives) rather than a bare `kind` — the setup dialog collects all of
 * it before Start is ever pressed. `kind` alone (no goal) still works for
 * callers with no setup step (the MCP `work_session.start` tool).
 */
export async function startWorkSession(input: StartWorkSessionInput): Promise<StartWorkSessionResult> {
  const { supabase, userId } = await requireUser();
  const result = await startWorkSessionCore(supabase, userId, input);
  revalidatePath("/business");
  revalidatePath("/");
  return result;
}

/**
 * THIN WRAPPER over endWorkSessionCore. `endedAtIso`, when given, is
 * lib/business/session-goal.ts's `goalEndsAtIso` (a goal-reached auto-end)
 * or an explicit `now()` ISO string (an objectives-complete auto-end) —
 * omitted for a manual "End Session" tap. See endWorkSessionCore's own
 * header for why this must never be a value this file invents itself.
 */
export async function endWorkSession(sessionId: string, endedAtIso?: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  await endWorkSessionCore(supabase, userId, sessionId, endedAtIso);
  revalidatePath("/business");
  revalidatePath("/");
}

/** THIN WRAPPER over toggleSessionObjectiveCore (146/Phase 3). */
export async function toggleSessionObjective(objectiveId: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  await toggleSessionObjectiveCore(supabase, userId, objectiveId);
  revalidatePath("/business");
  revalidatePath("/");
  revalidatePath("/school");
}

/**
 * THIN WRAPPER over getActiveWorkSessionDetail. Called by the provider
 * right after `startWorkSession` succeeds, to populate `session.objectives`
 * with real row ids (needed for toggleSessionObjective to have anything to
 * reference) and joined labels/completion — cheaper and more correct than
 * reconstructing that client-side from fragments the setup dialog happened
 * to have on hand, and it's the same read path AppShell itself uses for
 * `initialSession`, so there is exactly one definition of what a session's
 * full detail looks like.
 */
export async function getActiveSessionDetail(): Promise<ActiveWorkSessionDetail | null> {
  const { userId } = await requireUser();
  return getActiveWorkSessionDetail(userId);
}

/**
 * THIN WRAPPER over getClassTasksDueSoonCore — the Deep Study setup
 * dialog's on-demand fetch once a class is picked (146/
 * session-setup-dialog.tsx). Imported directly into that "use client" file
 * rather than threaded down as a prop from a Server Component — same
 * pattern as app/(app)/close/plan-actions.ts's dumpLine (AGENTS.md: a
 * Server Action reference survives the RSC boundary; importing removes the
 * hazard rather than testing for it).
 */
export async function getClassTasksDueSoon(classId: string): Promise<ObjectiveTaskOption[]> {
  const { supabase, userId } = await requireUser();
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(new Date(), timezone);
  return getClassTasksDueSoonCore(supabase, userId, classId, todayStr);
}

/**
 * The Deep Work setup dialog's on-demand fetch of today's kill list,
 * narrowed to incomplete items (146/session-setup-dialog.tsx). Deliberately
 * NOT threaded down from app-shell.tsx as a prop: getKillListSlots is
 * already gated there to fetch only when a Deep Work session is already
 * active (app-shell.tsx's own comment — avoiding a round trip on every
 * navigation), which is the opposite of when the setup dialog needs it
 * (before a session exists). Fetching here, on dialog open, costs one
 * round trip at the one moment it's actually needed — same shape as
 * getClassTasksDueSoon above.
 */
export async function getSessionKillListObjectives(): Promise<KillListObjectiveOption[]> {
  const { userId } = await requireUser();
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(new Date(), timezone);
  const slots = await getKillListSlots(userId, dateStr);
  return toKillListObjectiveOptions(slots);
}

/**
 * The Deep Study setup dialog's class picker, fetched on-demand
 * (getUserClassesCore's own comment explains why: not threaded down from
 * app-shell.tsx, same reasoning as the kill-list fetch above it).
 */
export async function getSessionClasses(): Promise<SessionClassOption[]> {
  const { supabase, userId } = await requireUser();
  return getUserClassesCore(supabase, userId);
}
