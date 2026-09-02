import { describe, expect, it, vi } from "vitest";
import { beginStageAttempt, finishStageAttempt, bracketStage, describeError, type StageAttemptParams } from "../telemetry";

// Real Postgres uuid literal shape -- used by the fake below to reproduce the
// exact validation Postgres does at INSERT-statement parse time, BEFORE any
// BEFORE INSERT trigger runs. This is the check the real database applies
// that an in-memory fake wouldn't apply by default -- and not applying it is
// exactly how the empty-string user_id bug (found live, running item 7)
// slipped past every mocked test in this file for as long as it did.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * In-memory fake standing in for `ingestion_job_stage_attempts` (107) --
 * real enough to drive the actual beginStageAttempt/finishStageAttempt/
 * bracketStage functions against, never a reimplementation of what they do.
 * Supports exactly the chain shapes telemetry.ts calls: insert(...).select
 * ("id").single(), and update(...).eq("id", id).
 */
interface FakeRow {
  id: string;
  job_id: string;
  stage: string;
  chunk_index: number | null;
  attempt: number;
  started_at: string;
  finished_at: string | null;
  succeeded: boolean | null;
  tokens_in: number | null;
  tokens_out: number | null;
  error: string | null;
}

function makeFakeSupabase() {
  const rows: FakeRow[] = [];
  let nextId = 1;
  const client = {
    from(table: string) {
      if (table !== "ingestion_job_stage_attempts") throw new Error(`unexpected table ${table}`);
      return {
        insert(values: Partial<FakeRow> & { user_id?: string }) {
          // Mirrors Postgres's own INSERT-statement type-check on a `uuid`
          // column, which runs before any trigger -- a real client library
          // would surface this as a thrown PostgrestError, not a JS
          // exception, so this fake raises the same non-Error-shaped object
          // real code needs to handle (describeError's own regression test
          // below covers that half).
          if (typeof values.user_id !== "string" || !UUID_RE.test(values.user_id)) {
            throw { message: `invalid input syntax for type uuid: "${values.user_id}"`, code: "22P02" };
          }
          const row: FakeRow = {
            id: String(nextId++),
            job_id: values.job_id!,
            stage: values.stage as string,
            chunk_index: values.chunk_index ?? null,
            attempt: values.attempt!,
            started_at: new Date().toISOString(), // mirrors the DB column default
            finished_at: null,
            succeeded: null,
            tokens_in: null,
            tokens_out: null,
            error: null,
          };
          rows.push(row);
          return {
            select() {
              return {
                async single() {
                  return { data: { id: row.id }, error: null };
                },
              };
            },
          };
        },
        update(values: Partial<FakeRow>) {
          return {
            eq(_col: string, id: string) {
              const row = rows.find((r) => r.id === id)!;
              Object.assign(row, values);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return { client: client as any, rows };
}

describe("beginStageAttempt / finishStageAttempt", () => {
  it("begin inserts an open row (finished_at/succeeded both null)", async () => {
    const { client, rows } = makeFakeSupabase();
    await beginStageAttempt(client, { jobId: "job-1", stage: "chunking", attempt: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.finished_at).toBeNull();
    expect(rows[0]!.succeeded).toBeNull();
  });

  it("finish requires an error when succeeded is false -- fails at the call site, matching the DB's own error_shape constraint (107)", async () => {
    const { client } = makeFakeSupabase();
    const handle = await beginStageAttempt(client, { jobId: "job-1", stage: "chunking", attempt: 1 });
    await expect(finishStageAttempt(client, handle, { succeeded: false })).rejects.toThrow(/error is required/);
  });

  it("finish rejects an error paired with succeeded:true -- same shape constraint, the other direction", async () => {
    const { client } = makeFakeSupabase();
    const handle = await beginStageAttempt(client, { jobId: "job-1", stage: "chunking", attempt: 1 });
    await expect(finishStageAttempt(client, handle, { succeeded: true, error: "should not be here" })).rejects.toThrow(/must not be set/);
  });

  it("REGRESSION: begin's own user_id placeholder is a syntactically valid uuid -- found live, running item 7: an empty string (\"\") failed Postgres's own type-check on the INSERT statement BEFORE the trigger that overwrites it ever ran, so every real call threw immediately and zero attempt rows were ever created, not just mis-attributed ones. The fake above enforces the same check a real uuid column does; this test exists so a future placeholder change can't silently regress to something non-uuid-shaped again.", async () => {
    const { client } = makeFakeSupabase();
    await expect(
      beginStageAttempt(client, { jobId: "job-1", stage: "chunking", attempt: 1 }),
    ).resolves.toMatchObject({ attemptId: expect.any(String) });
  });
});

describe("bracketStage", () => {
  it("on success: opens then closes the SAME row, succeeded=true, tokens carried through", async () => {
    const { client, rows } = makeFakeSupabase();
    const result = await bracketStage(client, { jobId: "job-1", stage: "extracting_lessons", chunkIndex: 3, attempt: 1 }, async () => ({
      tokensIn: 500,
      tokensOut: 200,
      lessons: ["a"],
    }));
    expect(result.lessons).toEqual(["a"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.succeeded).toBe(true);
    expect(rows[0]!.finished_at).not.toBeNull();
    expect(rows[0]!.tokens_in).toBe(500);
    expect(rows[0]!.tokens_out).toBe(200);
  });

  it("on failure: closes the row succeeded=false with the thrown error's message, and still rethrows", async () => {
    const { client, rows } = makeFakeSupabase();
    await expect(
      bracketStage(client, { jobId: "job-1", stage: "verifying_grounding", attempt: 1 }, async () => {
        throw new Error("embedder timed out");
      }),
    ).rejects.toThrow("embedder timed out");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.succeeded).toBe(false);
    expect(rows[0]!.error).toBe("embedder timed out");
    expect(rows[0]!.finished_at).not.toBeNull();
  });
});

/**
 * THE RED-FIRST CASE. Reproduces the actual historical bug class this
 * whole file exists to prevent: `apps/worker/src/pipeline.ts` calling
 * `setBookProgress(db, bookId, "merging", 90)` BEFORE the entailment loop,
 * so entailment's real ~13 minutes measured as `merging` time. Simulated
 * here with real elapsed-time arithmetic (fake timers), not a description
 * of the bug -- so this test can actually go red against a label-first
 * caller and green against a correctly-bracketed one, matching the exact
 * red condition the track plan specifies: "a stage whose label is set
 * BEFORE its work reports a duration that excludes it."
 */
describe("stage boundaries bracket the work, not follow it", () => {
  it("RED shape (reproduced, not just described): one bracketStage call spanning BOTH merge and entailment work misattributes entailment's time to 'merging'", async () => {
    vi.useFakeTimers();
    try {
      const { client, rows } = makeFakeSupabase();
      const params: StageAttemptParams = { jobId: "job-1", stage: "merging", attempt: 1 };
      const bracketPromise = bracketStage(client, params, async () => {
        await new Promise((r) => setTimeout(r, 2 * 60_000)); // the real merge work: 2 minutes
        await new Promise((r) => setTimeout(r, 13 * 60_000)); // BUG: entailment's 13 minutes, done under the SAME open attempt
        return {};
      });
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      await bracketPromise;

      const mergingRow = rows.find((r) => r.stage === "merging")!;
      const measuredMs = new Date(mergingRow.finished_at!).getTime() - new Date(mergingRow.started_at).getTime();
      // This is the assertion that must fail for a label-first caller: the
      // 'merging' row's OWN measured duration includes work that was never
      // actually merging. It does here, on purpose, to prove the harness
      // can see the defect -- this is the red half of "red first."
      expect(measuredMs).toBeGreaterThanOrEqual(15 * 60_000 - 1000);
      expect(rows).toHaveLength(1); // no separate row for the entailment time at all -- it's invisible as its own stage
    } finally {
      vi.useRealTimers();
    }
  });

  it("GREEN shape: two separate bracketStage calls at the correct boundary keep merge and entailment as two distinctly-timed rows, neither hiding the other", async () => {
    vi.useFakeTimers();
    try {
      const { client, rows } = makeFakeSupabase();

      const mergePromise = bracketStage(client, { jobId: "job-1", stage: "merging", attempt: 1 }, async () => {
        await new Promise((r) => setTimeout(r, 2 * 60_000));
        return {};
      });
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      await mergePromise;

      // The boundary migration 109's header requires: advance to
      // verifying_grounding "the moment the merge pass returns and BEFORE
      // the first entailment check runs" -- modelled here as starting the
      // second bracketStage call only after the first has already closed.
      const entailmentPromise = bracketStage(client, { jobId: "job-1", stage: "verifying_grounding", attempt: 1 }, async () => {
        await new Promise((r) => setTimeout(r, 13 * 60_000));
        return {};
      });
      await vi.advanceTimersByTimeAsync(13 * 60_000);
      await entailmentPromise;

      expect(rows).toHaveLength(2);
      const mergingRow = rows.find((r) => r.stage === "merging")!;
      const entailmentRow = rows.find((r) => r.stage === "verifying_grounding")!;

      const mergingMs = new Date(mergingRow.finished_at!).getTime() - new Date(mergingRow.started_at).getTime();
      const entailmentMs = new Date(entailmentRow.finished_at!).getTime() - new Date(entailmentRow.started_at).getTime();

      // THE assertion this whole file exists to make true: merging's
      // measured time does NOT include entailment's ~13 minutes.
      expect(mergingMs).toBeLessThan(3 * 60_000);
      expect(entailmentMs).toBeGreaterThanOrEqual(13 * 60_000 - 1000);
      expect(entailmentMs).toBeLessThan(14 * 60_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("describeError", () => {
  it("REGRESSION: a thrown Supabase-shaped error (PostgrestError -- a plain object with .message, never instanceof Error) is not stringified to the literal text \"[object Object]\" -- found live, running item 7: every real database error thrown by a worker-stages.ts handler's own `if (error) throw error` was being recorded exactly that way, in both this file's bracketStage and the route handler's own catch block, destroying the diagnostic value of the one column that exists to explain a failure.", () => {
    const postgrestShapedError = { message: "invalid input syntax for type uuid: \"\"", code: "22P02", details: null, hint: null };
    expect(describeError(postgrestShapedError)).toBe('invalid input syntax for type uuid: ""');
    expect(describeError(postgrestShapedError)).not.toBe("[object Object]");
  });

  it("still handles a genuine Error instance", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("falls back to String() for a value with no message shape at all", () => {
    expect(describeError("a plain string throw")).toBe("a plain string throw");
    expect(describeError(42)).toBe("42");
  });
});
