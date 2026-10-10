import { isPlanArea, isValidDuration, type PlanArea } from "@/lib/plan/plan-behavior";

/**
 * The pure half of "attach a plan line to a domain" -- what changes on the task row, and which side effects the
 * domain's own data needs, given what the line was and what the person now wants. No Supabase, no Date: the core
 * (plan-details-core.ts) runs the result. Kept pure because the rules are the product (spec 2026-10-06) and are
 * easy to get subtly wrong:
 *
 *   School    the line IS a School task for the plan day: tasks.domain = 'school', due_date = the plan day. That is
 *             all it takes for the School page's task list and Home to list it. Leaving School undoes both.
 *   Business  "Add to Kill List" (preselected) mirrors the line into that day's Kill List. Unchecking it later
 *             removes the pairing and the (uncompleted) Kill List row it created; the line stays a Business task.
 *   Work      entering Work puts the line in the current target's Backlog, once -- re-saving the plan does not add
 *             it again, because the side effect fires only on the transition INTO Work.
 *   other     Faith / Fitness / Self-Mastery / Personal growth have no task list: the area is recorded for insight
 *             and nothing else changes.
 */

export type PlanLineInput = {
  id: string;
  area: PlanArea | null;
  /** Business only: mirror into the Kill List. Ignored for every other area. */
  addToKillList: boolean;
  /** "HH:MM" 24h, or null. */
  startTime: string | null;
  durationMinutes: number | null;
  /** The person's manual position, 0-based. */
  order: number;
  /** Free-text criteria for the line (what done means), or null. Trimmed; empty is sent as null. */
  criteria: string | null;
};

export const MAX_CRITERIA_LENGTH = 2000;

export type PlanLinePrev = {
  area: string | null;
  domain: string | null;
  dueDate: string | null;
  killListItemId: string | null;
};

export type PlanLineEffects = {
  /** Columns to write on the tasks row. */
  patch: Record<string, unknown>;
  /** Put this line in the current Work target's Backlog (once). */
  enterWorkBacklog: boolean;
  /** Mirror this line's title into the Kill List. */
  wantKillList: boolean;
  /** A Kill List row this line created earlier that should now be removed. */
  dropKillListItemId: string | null;
};

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** Returns an error message for a malformed line, or null. */
export function validatePlanLine(line: PlanLineInput): string | null {
  if (line.area !== null && !isPlanArea(line.area)) return "Pick one of your domains.";
  if (line.startTime !== null && !HHMM.test(line.startTime)) return "Enter a valid time.";
  if (line.durationMinutes !== null && !isValidDuration(line.durationMinutes)) return "A timer is between 1 minute and 24 hours.";
  if (!Number.isInteger(line.order) || line.order < 0 || line.order > 999) return "Bad order.";
  if (line.criteria !== null && (line.criteria.trim().length === 0 || line.criteria.length > MAX_CRITERIA_LENGTH)) return `Criteria can be up to ${MAX_CRITERIA_LENGTH} characters.`;
  return null;
}

export function planLineEffects(prev: PlanLinePrev, next: PlanLineInput, plannedDate: string): PlanLineEffects {
  const patch: Record<string, unknown> = {
    plan_area: next.area,
    planned_start_time: next.startTime,
    planned_duration_minutes: next.durationMinutes,
    plan_order: next.order,
    plan_criteria: next.criteria === null ? null : next.criteria.trim(),
  };

  if (next.area === "school") {
    patch.domain = "school";
    patch.due_date = plannedDate;
    patch.due_time = null;
  } else if (prev.area === "school") {
    // Left School: it is no longer a School task. Only undo what Plan did (the row was School because of this line).
    patch.domain = null;
    patch.due_date = null;
  }

  const wantKillList = next.area === "business" && next.addToKillList;
  const dropKillListItemId = !wantKillList && prev.killListItemId !== null ? prev.killListItemId : null;
  if (dropKillListItemId !== null) patch.kill_list_item_id = null;

  return { patch, enterWorkBacklog: next.area === "work" && prev.area !== "work", wantKillList, dropKillListItemId };
}
