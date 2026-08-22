/**
 * Daily Log — merges all six item archetypes into one ordered list with
 * completion state. Pure function, no React, no I/O — the repo's
 * lib/checkins/schedule.ts pattern. docs/superpowers/plans/2026-08-22-fitness-system.md,
 * type contract part 1, and the "every archetype and its tap behaviour"
 * table.
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
 * sessions, daily checks, body metrics, benchmark) is insertion order,
 * matching "micro first, sessions after" from the plan's logic-gap
 * resolution #5.
 */

export type DailyLogItem =
  | { kind: "micro_total"; exerciseId: string; name: string; logged: number; target: number; notes: string | null }
  | { kind: "micro_freq"; exerciseId: string; name: string; bouts: number; target: number; notes: string | null }
  | { kind: "session"; sessionId: string; name: string; durationMinutes: number; startTime: string | null; confirmed: boolean }
  | { kind: "daily_check"; checkKind: "protein" | "steps"; done: boolean }
  | { kind: "body_metric"; metric: "weight" | "waist"; lastValue: number | null; lastDate: string | null }
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
export type DailyCheckInput = { checkKind: "protein" | "steps"; done: boolean };
/** `dueToday` is the caller's own "should this show up at all" decision (e.g. waist's 14-day re-arm) — buildDailyLog only ever surfaces a body_metric row when it's true. */
export type BodyMetricInput = { metric: "weight" | "waist"; lastValue: number | null; lastDate: string | null; dueToday: boolean };
/** null when not in the benchmark window (lib/fitness/cycle.ts's isInBenchmarkWindow) — nothing to show. */
export type BenchmarkInput = { cycleNumber: number; dueBy: string } | null;

export type DailyLogInputs = {
  microTotals: MicroTotalInput[];
  microFreqs: MicroFreqInput[];
  sessions: SessionInput[];
  dailyChecks: DailyCheckInput[];
  bodyMetrics: BodyMetricInput[];
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

  for (const c of inputs?.dailyChecks ?? []) {
    items.push({ kind: "daily_check", checkKind: c.checkKind, done: !!c.done });
  }

  for (const m of inputs?.bodyMetrics ?? []) {
    if (!m.dueToday) continue;
    items.push({ kind: "body_metric", metric: m.metric, lastValue: m.lastValue ?? null, lastDate: m.lastDate ?? null });
  }

  if (inputs?.benchmark) {
    items.push({ kind: "benchmark", cycleNumber: inputs.benchmark.cycleNumber, dueBy: inputs.benchmark.dueBy });
  }

  return items;
}

/**
 * Whether the target's already been met/exceeded and the row would
 * disappear from the pending view. body_metric is never "complete" in
 * this sense — presence already means due (buildDailyLog filtered it) —
 * and benchmark is the same: showing up IS the pending state.
 */
export function isDailyLogItemComplete(item: DailyLogItem): boolean {
  switch (item.kind) {
    case "micro_total":
      return item.target > 0 && item.logged >= item.target;
    case "micro_freq":
      return item.target > 0 && item.bouts >= item.target;
    case "session":
      return item.confirmed;
    case "daily_check":
      return item.done;
    case "body_metric":
    case "benchmark":
      return false;
  }
}

/** "Once that fills that's when the log goes away" (Ayman) — the filtered view Daily Log actually renders. */
export function pendingDailyLog(items: DailyLogItem[]): DailyLogItem[] {
  return (items ?? []).filter((item) => !isDailyLogItemComplete(item));
}
