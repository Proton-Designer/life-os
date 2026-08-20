/**
 * Daily rep-goal progress — pure functions, no React, no I/O.
 * docs/superpowers/specs/2026-08-19-fitness-redesign.md §5 (the starter
 * plan's daily rep-target bars), docs/superpowers/plans/2026-08-20-fitness-redesign.md
 * Phase 2.
 */

export type RepGoalProgress = {
  done: number;
  target: number;
  fraction: number;
  complete: boolean;
};

/**
 * `done` is the sanitized raw logged total, never clamped to `target` — an
 * overshoot day (35 pull-ups against a 30 target) should read as 35, not
 * be silently capped. `fraction` IS clamped to [0, 1] since it drives a
 * progress bar, which has nowhere to put the overshoot visually.
 */
export function repGoalProgress(loggedRepsToday: number, dailyTarget: number): RepGoalProgress {
  const done = Number.isFinite(loggedRepsToday) && loggedRepsToday > 0 ? loggedRepsToday : 0;
  const target = Number.isFinite(dailyTarget) && dailyTarget > 0 ? dailyTarget : 0;
  const fraction = target > 0 ? Math.min(1, done / target) : 0;
  const complete = target > 0 && done >= target;
  return { done, target, fraction, complete };
}

/** 0=Sun … 6=Sat. */
export function isGoalActiveOn(activeDays: number[], dayOfWeek: number): boolean {
  return Array.isArray(activeDays) && activeDays.includes(dayOfWeek);
}
