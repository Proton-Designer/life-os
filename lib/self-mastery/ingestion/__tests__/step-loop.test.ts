import { describe, it, expect } from "vitest";
import { runStepLoop, type StepOutcome } from "../step-loop";

const out = (kind: StepOutcome["kind"], n = 0): StepOutcome => ({ kind, status: kind === "halt" ? 500 : 200, body: { n } });

/** A fake clock the steps advance themselves. */
function clock() {
  let t = 0;
  return { now: () => t, spend: (ms: number) => void (t += ms) };
}

describe("runStepLoop", () => {
  it("a first-iteration no_job is the answer itself", async () => {
    const r = await runStepLoop(async () => out("no_job"));
    expect(r).toMatchObject({ steps: 0, stoppedBy: "no_job", status: 200 });
  });

  it("keeps stepping until nothing is left, and reports the LAST real step, not the empty claim", async () => {
    const queue: StepOutcome[] = [out("advanced", 1), out("advanced", 2), out("no_job")];
    const r = await runStepLoop(async () => queue.shift()!);
    expect(r).toMatchObject({ steps: 2, stoppedBy: "no_job", body: { n: 2 } });
  });

  it("stops at once on a halt or a stopped (CAS miss) outcome and returns it", async () => {
    const halted = await runStepLoop(async () => out("halt", 9));
    expect(halted).toMatchObject({ steps: 1, stoppedBy: "halt", status: 500, body: { n: 9 } });
    const stopped = await runStepLoop(async () => out("stopped", 7));
    expect(stopped).toMatchObject({ steps: 1, stoppedBy: "stopped", status: 200 });
  });

  it("stops on the time budget, counting the slowest step so far so one slow stage cannot overrun it", async () => {
    const c = clock();
    let calls = 0;
    const r = await runStepLoop(
      async () => {
        calls += 1;
        c.spend(calls === 1 ? 100_000 : 1_000);
        return out("advanced", calls);
      },
      { now: c.now, budgetMs: 240_000 },
    );
    // After step 1: 100 s elapsed + slowest 100 s = 200 s < 240 s -> go again. After step 2: 101 s + 100 s = 201 s ... keeps
    // going while 'elapsed + slowest' fits: 100+1k*n+100k >= 240k at n = 40.
    expect(r.stoppedBy).toBe("budget");
    expect(calls).toBe(41);
    expect(r.elapsedMs).toBeLessThan(240_000);
  });

  it("a very fast loop is still bounded by the budget (never spins forever)", async () => {
    const c = clock();
    const r = await runStepLoop(async () => (c.spend(10_000), out("advanced")), { now: c.now, budgetMs: 60_000 });
    expect(r.stoppedBy).toBe("budget");
    expect(r.steps).toBe(5); // 50 s + 10 s >= 60 s
  });
});
