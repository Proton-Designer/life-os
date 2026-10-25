/**
 * The driver loop for the ingestion step route. One poll used to do ONE stage or chunk and return, so a book with ~130
 * chunk-sized steps took ~130 minutes of one-minute ticks (a long book, hours) for a few minutes of real work. The route
 * now keeps going inside one invocation: claim -> stage -> advance, again and again, until it runs out of time budget or
 * hits something that is not a clean advance.
 *
 * What counts as a step outcome (`kind`), and what each does to the loop:
 *   advanced  the stage ran and the cursor moved (including onto `done` / `failed`): keep going, claim the next job.
 *   no_job    nothing eligible to claim: stop.
 *   stopped   the stage ran but another invocation had already moved the cursor (advance returned null): stop cleanly.
 *             Not an error: with overlapping polls, two callers can interleave on one job (advance releases the lease);
 *             `claim_ingestion_job`'s SKIP LOCKED + the cursor CAS make that safe, and this caller just steps aside.
 *   halt      anything else: a failed stage, the exhausted-attempts and circuit-breaker paths, a skip, a 501. Stops exactly
 *             where the single-shot route used to return.
 *
 * TIME: a new iteration starts only if `elapsed + the slowest iteration so far` still fits in the budget, so one slow stage
 * cannot push the invocation past the route's maxDuration. The clock is injected so the budget is testable.
 */
export type StepOutcome = { kind: "advanced" | "no_job" | "stopped" | "halt"; status: number; body: Record<string, unknown> };
export type StoppedBy = "no_job" | "stopped" | "halt" | "budget";
export type StepLoopResult = { status: number; body: Record<string, unknown>; steps: number; elapsedMs: number; stoppedBy: StoppedBy };

export const LOOP_BUDGET_MS = 240_000;

export async function runStepLoop(
  runStep: () => Promise<StepOutcome>,
  opts: { now?: () => number; budgetMs?: number } = {},
): Promise<StepLoopResult> {
  const now = opts.now ?? Date.now;
  const budgetMs = opts.budgetMs ?? LOOP_BUDGET_MS;
  const start = now();
  let steps = 0;
  let slowest = 0;
  let last: StepOutcome | null = null;
  let stoppedBy: StoppedBy;

  for (;;) {
    const iterationStart = now();
    const outcome = await runStep();
    slowest = Math.max(slowest, now() - iterationStart);

    if (outcome.kind === "no_job") {
      // Report the last real step if there was one; only a first-iteration "nothing to do" is the answer itself.
      last ??= outcome;
      stoppedBy = "no_job";
      break;
    }
    last = outcome;
    steps += 1;
    if (outcome.kind === "halt") {
      stoppedBy = "halt";
      break;
    }
    if (outcome.kind === "stopped") {
      stoppedBy = "stopped";
      break;
    }
    if (now() - start + slowest >= budgetMs) {
      stoppedBy = "budget";
      break;
    }
  }

  return { status: last.status, body: last.body, steps, elapsedMs: now() - start, stoppedBy };
}
