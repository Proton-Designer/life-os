/**
 * What a planned task does when its Start button is pressed -- one pure rule, shared by Home's plan list (which
 * button to draw) and the Server Action that performs it (what to do), so the two can never disagree.
 *
 * A plan line carries up to three optional things the person chose: a DOMAIN (`area`), a START TIME, and a TIMER
 * (`durationMinutes`). The matrix (the owner's spec, 2026-10-06):
 *
 *   Business + timer          -> a timed Deep Work session (goal = the timer)
 *   Business + start time     -> an elapsed Deep Work session (no goal)
 *   School (anything)         -> a Deep Study session (timed if a timer was set, otherwise elapsed)
 *   any other + timer         -> an inline countdown beside the task
 *   any other + start time    -> an inline elapsed timer beside the task
 *   no start time, no timer   -> Complete only (a tick that finishes it)
 *
 * School always offers Start: a School task has nothing else to do but study, and "Deep Study" is the session that
 * counts it toward the day's hours. Business and everything else offer Start only when the person timed the task,
 * because a Business line with no time is a Kill List line -- finishing it is the action.
 *
 * Pure: no React, no Supabase, no Date. Tested in __tests__/plan-behavior.test.ts.
 */

/** The user_domains keys a plan line can be attached to (mirrors DomainKey in app/(app)/onboarding/actions.ts). */
export type PlanArea = "business" | "school" | "work" | "body" | "faith" | "learning" | "personal_growth";

export const PLAN_AREAS: readonly PlanArea[] = ["business", "school", "work", "body", "faith", "learning", "personal_growth"];

/** What the person sees on the chip. "body" reads as Fitness and "learning" as Self-Mastery everywhere else in the app. */
export const PLAN_AREA_LABEL: Record<PlanArea, string> = {
  business: "Business",
  school: "School",
  work: "Work",
  body: "Fitness",
  faith: "Faith",
  learning: "Self-Mastery",
  personal_growth: "Personal growth",
};

export function isPlanArea(value: unknown): value is PlanArea {
  return typeof value === "string" && (PLAN_AREAS as readonly string[]).includes(value);
}

export type PlanTiming = { startTime: string | null; durationMinutes: number | null };

export type StartBehavior =
  | { kind: "deep_work"; goalMinutes: number | null }
  | { kind: "deep_study"; goalMinutes: number | null }
  | { kind: "inline_timer"; goalMinutes: number | null }
  | { kind: "complete_only" };

export function startBehavior(area: string | null, timing: PlanTiming): StartBehavior {
  const goalMinutes = timing.durationMinutes;
  const timed = goalMinutes !== null || timing.startTime !== null;
  if (area === "school") return { kind: "deep_study", goalMinutes };
  if (!timed) return { kind: "complete_only" };
  if (area === "business") return { kind: "deep_work", goalMinutes };
  return { kind: "inline_timer", goalMinutes };
}

/** "1h 30m" / "45m" / "2h". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export const DURATION_PRESETS: readonly number[] = [15, 30, 45, 60, 90, 120, 180];

/** The most a single timer can be (a day): mirrors the column's CHECK. */
export const MAX_DURATION_MINUTES = 1440;

export function isValidDuration(minutes: unknown): minutes is number {
  return typeof minutes === "number" && Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_DURATION_MINUTES;
}

export type OrderablePlanItem = { id: string; startTime: string | null; planOrder: number | null; mitRank: number | null; createdAt?: string };

/**
 * Timeline order: timed lines by start time (a 5:00 AM line before a 9:00 AM one), then the untimed ones. Ties --
 * two lines at the same time, or both untimed -- fall to the person's own manual order, then the crown/star rank
 * (the crown is rank 1), then creation order. Lines with no manual order sort after those that have one.
 */
export function orderPlanItems<T extends OrderablePlanItem>(items: readonly T[]): T[] {
  const n = (v: number | null) => (v === null ? Number.POSITIVE_INFINITY : v);
  return [...items].sort((a, b) => {
    if (a.startTime !== b.startTime) {
      if (a.startTime === null) return 1;
      if (b.startTime === null) return -1;
      return a.startTime < b.startTime ? -1 : 1;
    }
    if (n(a.planOrder) !== n(b.planOrder)) return n(a.planOrder) < n(b.planOrder) ? -1 : 1;
    if (n(a.mitRank) !== n(b.mitRank)) return n(a.mitRank) < n(b.mitRank) ? -1 : 1;
    return (a.createdAt ?? "") < (b.createdAt ?? "") ? -1 : (a.createdAt ?? "") > (b.createdAt ?? "") ? 1 : 0;
  });
}

/** Seconds left on a countdown (never below 0), or seconds elapsed on a count-up. `startedAtMs` is a real instant, so plain epoch math is correct here. */
export function timerReadout(startedAtMs: number, durationMinutes: number | null, nowMs: number): { seconds: number; mode: "down" | "up"; done: boolean } {
  const elapsed = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  if (durationMinutes === null) return { seconds: elapsed, mode: "up", done: false };
  const left = Math.max(0, durationMinutes * 60 - elapsed);
  return { seconds: left, mode: "down", done: left === 0 };
}

/** "1:05:09" / "12:03". */
export function formatClockSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
