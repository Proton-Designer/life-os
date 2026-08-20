/**
 * Pure helpers for the Co-op Targets strip — no React, no I/O.
 * docs/superpowers/specs/2026-08-20-coop-redesign.md.
 *
 * "Target" vs "stretch goal" is never stored as its own flag — it's
 * derived from `position <= 3` (Opus Lead ruling 4), which is what lets
 * the completion cascade be a pure decrement and a manual reorder that
 * crosses the target/stretch boundary just work with no special case.
 */

export type CoopTargetRow = {
  id: string;
  title: string;
  deadline: string | null;
  position: number;
};

export const TARGET_SLOT_COUNT = 3;

export function splitTargetsAndStretch(rows: CoopTargetRow[]): {
  targets: CoopTargetRow[];
  stretchGoals: CoopTargetRow[];
} {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  return {
    targets: sorted.filter((r) => r.position <= TARGET_SLOT_COUNT),
    stretchGoals: sorted.filter((r) => r.position > TARGET_SLOT_COUNT),
  };
}

/** The position a brand-new target should take: the next open slot (1-3). Callers must check `targets.length < TARGET_SLOT_COUNT` first — this doesn't clamp. */
export function nextTargetPosition(targets: CoopTargetRow[]): number {
  return targets.length + 1;
}

/** The position a brand-new stretch goal should take: appended after every existing row, target or stretch. */
export function nextStretchPosition(allRows: CoopTargetRow[]): number {
  if (allRows.length === 0) return TARGET_SLOT_COUNT + 1;
  return Math.max(...allRows.map((r) => r.position)) + 1;
}

/** Clamps a move-up/move-down request to the bounds of the whole queue (both targets and stretch goals share one dense rank), or returns null if the move is a no-op at that edge. */
export function moveTargetPosition(
  currentPosition: number,
  direction: "up" | "down",
  queueLength: number
): number | null {
  const next = direction === "up" ? currentPosition - 1 : currentPosition + 1;
  if (next < 1 || next > queueLength) return null;
  return next;
}

export type DeadlineUrgency = "positive" | "warning" | "negative";

/**
 * "12 days left" rather than the raw date, for Target 1 specifically
 * (Opus Lead: "the pressure is how long is left, and the pressure is the
 * point of a target" — rows 2/3 keep the plain date). Compares calendar
 * days, not elapsed hours, so a deadline later today still reads "Due
 * today" regardless of what time it currently is.
 *
 * The returned `urgency` drives the badge colour (Opus Lead: green at "1
 * day left" or "3 days overdue" would be actively misleading, since green
 * reads as *fine* everywhere else in this app). Thresholds are a judgment
 * call, not a ruling: overdue or due today reads negative, 1-3 days left
 * is the warning window, 4+ days is genuinely fine.
 */
export function formatDaysLeft(deadlineDateStr: string, now: Date): { label: string; urgency: DeadlineUrgency } {
  const deadline = new Date(`${deadlineDateStr}T00:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const deadlineDay = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
  const diffDays = Math.round((deadlineDay.getTime() - today.getTime()) / 86_400_000);

  if (diffDays < 0) {
    return { label: `${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? "" : "s"} overdue`, urgency: "negative" };
  }
  if (diffDays === 0) return { label: "Due today", urgency: "negative" };
  if (diffDays <= 3) return { label: `${diffDays} day${diffDays === 1 ? "" : "s"} left`, urgency: "warning" };
  return { label: `${diffDays} days left`, urgency: "positive" };
}
