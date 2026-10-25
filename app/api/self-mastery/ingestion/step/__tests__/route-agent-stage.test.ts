import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Book ingestion with no AI key (agent work queue): how the step route reacts to the stage planner (lib/self-mastery/ingestion/agent-stage.ts,
 * its own subject in agent-stage.test.ts). Proven here: PARK releases the job without running the handler or advancing, FAIL fails the book
 * retryably, ADVANCE moves the cursor through the normal bracketed advance without running the handler, and INLINE changes nothing.
 */

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/self-mastery/ingestion/telemetry", () => ({
  bracketStage: vi.fn((_c: unknown, _p: unknown, work: () => Promise<unknown>) => work()),
  describeError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
const SECRET = "test-ingestion-secret";

function terminal<T extends Record<string, unknown>>(result: T): T & { eq: () => unknown; lt: () => unknown; not: () => unknown; then: (r: (v: T) => void) => void } {
  const t: Record<string, unknown> = { ...result };
  t.eq = vi.fn(() => terminal(result));
  t.lt = vi.fn(() => terminal(result));
  t.not = vi.fn(() => terminal(result));
  t.then = (resolve: (v: T) => void) => resolve(result);
  return t as never;
}

function makeSupabase(claimedJob: Record<string, unknown>) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const claims = [claimedJob];
  const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    if (fn === "claim_ingestion_job") return Promise.resolve({ data: claims.length > 0 ? claims.shift() : null, error: null });
    if (fn === "advance_ingestion_cursor") return Promise.resolve({ data: { id: "job-1" }, error: null });
    return Promise.resolve({ data: { id: "job-1" }, error: null });
  });
  const updates: { table: string; values: Record<string, unknown> }[] = [];
  const from = vi.fn((table: string) => ({
    update: (values: Record<string, unknown>) => {
      updates.push({ table, values });
      return terminal({ error: null });
    },
    select: () => terminal({ count: null, error: null }),
  }));
  return { rpc, from, rpcCalls, updates };
}

const JOB = { id: "job-1", book_id: "book-1", user_id: "user-1", stage: "extracting_lessons", cursor_chunk_index: 0, cursor_attempt: 2, max_attempts: 3 };

async function run(plan: unknown, opts: { handler?: ReturnType<typeof vi.fn> } = {}) {
  const handler = opts.handler ?? vi.fn().mockResolvedValue({ nextStage: "extracting_lessons", nextChunkIndex: 1 });
  vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({ STAGE_HANDLERS: { extracting_lessons: handler } }));
  vi.doMock("@/lib/self-mastery/ingestion/agent-stage", () => ({
    planAgentStage: vi.fn(async () => {
      if (plan instanceof Error) throw plan;
      return plan;
    }),
  }));
  const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
  const mock = makeSupabase(JOB);
  vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);
  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
  return { res, body: await res.json(), mock, handler };
}

describe("POST /api/self-mastery/ingestion/step — the agent stage planner", () => {
  beforeEach(() => vi.stubEnv("SELF_MASTERY_INGESTION_SECRET", SECRET));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("PARK: the job is parked on exactly the position it claimed, the stage handler never runs, the cursor never advances, and it is not an error", async () => {
    const { res, body, mock, handler } = await run({ kind: "park", waitingFor: 12 });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, reason: "parked_for_agent", waitingFor: 12 });
    expect(handler).not.toHaveBeenCalled();
    expect(mock.rpcCalls.find((c) => c.fn === "park_ingestion_job")!.args).toEqual({
      p_job_id: "job-1",
      p_expected_stage: "extracting_lessons",
      p_expected_chunk_index: 0,
      p_expected_attempt: 2,
    });
    expect(mock.rpcCalls.some((c) => c.fn === "advance_ingestion_cursor")).toBe(false);
    expect(mock.updates.some((u) => u.table === "books" && u.values.status === "failed")).toBe(false);
  });

  it("FAIL: the book is failed with the planner's retryable message; no handler, no advance", async () => {
    const { res, body, mock, handler } = await run({ kind: "fail", bookMessage: "Your agent didn't finish a step of this book in time. Tap Try again.", jobMessage: "a step expired" });
    expect(res.status).toBe(500);
    expect(body).toMatchObject({ reason: "agent_step_failed", bookMarkedFailed: true });
    expect(handler).not.toHaveBeenCalled();
    expect(mock.updates).toContainEqual({ table: "ingestion_jobs", values: { stage: "failed", last_error: "a step expired" } });
    expect(mock.updates).toContainEqual({ table: "books", values: { status: "failed", error_message: "Your agent didn't finish a step of this book in time. Tap Try again." } });
    expect(mock.rpcCalls.some((c) => c.fn === "advance_ingestion_cursor")).toBe(false);
  });

  it("ADVANCE (the last step is done): the cursor moves to the planned stage through the normal advance, and the stage handler is NOT run", async () => {
    const { res, body, mock, handler } = await run({ kind: "advance", nextStage: "merging", nextChunkIndex: null });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, nextStage: "merging" });
    expect(handler).not.toHaveBeenCalled();
    expect(mock.rpcCalls.find((c) => c.fn === "advance_ingestion_cursor")!.args).toMatchObject({
      p_job_id: "job-1",
      p_expected_stage: "extracting_lessons",
      p_expected_chunk_index: 0,
      p_expected_attempt: 2,
      p_next_stage: "merging",
      p_next_chunk_index: null,
    });
  });

  it("INLINE (the owner's own key): the stage handler runs and advances exactly as before", async () => {
    const { handler, mock, body } = await run({ kind: "inline" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ nextStage: "extracting_lessons", nextChunkIndex: 1 });
    expect(mock.rpcCalls.some((c) => c.fn === "park_ingestion_job")).toBe(false);
  });

  it("a planning failure leaves the job for the next poll: nothing is parked, advanced or failed", async () => {
    const { res, body, mock } = await run(new Error("db blip"));
    expect(res.status).toBe(500);
    expect(body).toMatchObject({ reason: "agent_plan_failed" });
    expect(mock.rpcCalls.filter((c) => ["park_ingestion_job", "advance_ingestion_cursor"].includes(c.fn))).toHaveLength(0);
    expect(mock.updates.filter((u) => u.table === "ingestion_jobs" || u.table === "books")).toHaveLength(0);
  });
});
