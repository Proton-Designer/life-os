/**
 * Daily Log — merges the surviving item archetypes into one ordered list
 * with completion state. Pure function, no React, no I/O — the repo's
 * lib/checkins/schedule.ts pattern. docs/superpowers/plans/2026-08-22-fitness-system.md,
 * type contract part 1, and the "every archetype and its tap behaviour"
 * table.
 *
 * `daily_check` (protein/steps) and `body_metric` (weight/waist) were
 * removed from this list entirely (2026-08-25/26 batch 2, item 3 —
 * Ayman: "dont turn them into daily tasks, just keep them there, when i
 * want to do it I will"). Weight and waist are still loggable, just no
 * longer as a daily task here — see CycleProgressPanel/BodyModule, which
 * now own a standalone log affordance independent of any window or task
 * list.
 *
 * Protein/steps have no surviving affordance anywhere — `toggleDailyCheck`
 * and `ensureDailyCheckHabits` (app/(app)/fitness/actions.ts) ARE deleted
 * (Opus Lead review, 2026-08-26), unlike the general shared `habit_logs`/
 * `custom_habits` tables themselves. The first pass at this removal left
 * them in place reasoning "the tables are shared" — true, but beside the
 * point: the two `custom_habits` ROWS those actions find-or-created ("Hit
 * protein target", "8,000+ steps") were still live, unarchived, and read
 * as a denominator by lib/home/get-domain-snapshots.ts and
 * get-domain-pulse.ts — with the only UI that could ever complete them
 * gone, Home's fitness pulse would have shown 0/2 forever. Those two rows
 * are archived (never hard-deleted — they carry real logs) on both
 * accounts; deleting the dead action code is what stops anything from
 * ever recreating them.
 *
 * `buildDailyLog` returns every item with its completion state attached;
 * `pendingDailyLog` filters to only what's still outstanding — separate
 * functions, same split as lib/checkins/schedule.ts's
 * resolveAllocationSlots (resolves everything) vs pendingQueue (filters to
 * actionable), so a caller that wants the full picture (e.g. a future
 * history view) isn't forced through the filter.
 *
 * Micro items list individually (each exercise its own row); routine
 * sessions list as a whole, never exploded into their exercises — spec's
 * explicit distinction. Ordering here (micro totals, micro frequencies,
 * sessions, benchmark) is insertion order, matching "micro first,
 * sessions after" from the plan's logic-gap resolution #5.
 */

export type DailyLogItem =
  | { kind: "micro_total"; exerciseId: string; name: string; logged: number; target: number; notes: string | null }
  | { kind: "micro_freq"; exerciseId: string; name: string; bouts: number; target: number; notes: string | null }
  | { kind: "session"; sessionId: string; name: string; durationMinutes: number; startTime: string | null; confirmed: boolean }
  | { kind: "benchmark"; cycleNumber: number; dueBy: string };

export type MicroTotalInput = { exerciseId: string; name: string; target: number; loggedToday: number; notes: string | null };
export type MicroFreqInput = { exerciseId: string; name: string; target: number; boutsToday: number; notes: string | null };
export type SessionInput = {
  sessionId: string;
  name: string;
  durationMinutes: number;
  startTime: string | null;
  confirmedToday: boolean;
};
/** null when not in the benchmark window (lib/fitness/cycle.ts's isInBenchmarkWindow) — nothing to show. */
export type BenchmarkInput = { cycleNumber: number; dueBy: string } | null;

export type DailyLogInputs = {
  microTotals: MicroTotalInput[];
  microFreqs: MicroFreqInput[];
  sessions: SessionInput[];
  benchmark: BenchmarkInput;
};

function sanitizeNonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** A target of 0 or less is meaningless (nothing to complete) — sanitizes to 0 rather than producing a divide-by-zero-shaped bug downstream. */
function sanitizeTarget(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function buildDailyLog(inputs: DailyLogInputs): DailyLogItem[] {
  const items: DailyLogItem[] = [];

  for (const g of inputs?.microTotals ?? []) {
    items.push({
      kind: "micro_total",
      exerciseId: g.exerciseId,
      name: g.name,
      logged: sanitizeNonNegative(g.loggedToday),
      target: sanitizeTarget(g.target),
      notes: g.notes ?? null,
    });
  }

  for (const g of inputs?.microFreqs ?? []) {
    items.push({
      kind: "micro_freq",
      exerciseId: g.exerciseId,
      name: g.name,
      bouts: sanitizeNonNegative(g.boutsToday),
      target: sanitizeTarget(g.target),
      notes: g.notes ?? null,
    });
  }

  for (const s of inputs?.sessions ?? []) {
    items.push({
      kind: "session",
      sessionId: s.sessionId,
      name: s.name,
      durationMinutes: sanitizeNonNegative(s.durationMinutes),
      startTime: s.startTime ?? null,
      confirmed: !!s.confirmedToday,
    });
  }

  if (inputs?.benchmark) {
    items.push({ kind: "benchmark", cycleNumber: inputs.benchmark.cycleNumber, dueBy: inputs.benchmark.dueBy });
  }

  return items;
}

/**
 * Whether the target's already been met/exceeded and the row would
 * disappear from the pending view. benchmark is never "complete" in this
 * sense — showing up IS the pending state.
 */
export function isDailyLogItemComplete(item: DailyLogItem): boolean {
  switch (item.kind) {
    case "micro_total":
      return item.target > 0 && item.logged >= item.target;
    case "micro_freq":
      return item.target > 0 && item.bouts >= item.target;
    case "session":
      return item.confirmed;
    case "benchmark":
      return false;
  }
}

/** "Once that fills that's when the log goes away" (Ayman) — the filtered view Daily Log actually renders. */
export function pendingDailyLog(items: DailyLogItem[]): DailyLogItem[] {
  return (items ?? []).filter((item) => !isDailyLogItemComplete(item));
}
