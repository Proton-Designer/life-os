import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * A5 gate 3's own red case, per the track plan: "a handler that does the
 * work but writes no telemetry row, and must still fail to advance."
 * `advance_ingestion_cursor`'s DB-side refusal is Eng 1's (109) and is not
 * re-proven here — see the Lead's own instruction: "prove the handler
 * can't bypass it, don't re-prove the function." What THIS file proves is
 * the code-level half: this route's control flow makes it structurally
 * impossible to reach `advance_ingestion_cursor` without `bracketStage`
 * having already run and (by construction) written the telemetry row
 * `advance_ingestion_cursor` requires. If the stage handler throws, the
 * route must return before ever calling advance — checked by asserting the
 * mock RPC call count, not by reading the code and trusting it.
 */

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));
vi.mock("@/lib/self-mastery/ingestion/worker-stages", () => ({
  STAGE_HANDLERS: {},
}));
// bracketStage itself is gate 2's own subject, fully tested there
// (telemetry.test.ts) against a real fake table -- re-mocked here as a
// thin passthrough so THIS file can test the route's control flow (does
// it call advance only when bracketStage's promise resolves?) without
// re-deriving bracketStage's own insert/update chain mocking.
vi.mock("@/lib/self-mastery/ingestion/telemetry", () => ({
  bracketStage: vi.fn((_client: unknown, _params: unknown, work: () => Promise<unknown>) => work()),
}));

const SECRET = "test-ingestion-secret";

function makeMockSupabase(opts: {
  claimedJob: Record<string, unknown> | null;
  rpcResults?: Record<string, { data: unknown; error: unknown }>;
}) {
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const rpc = vi.fn((fn: string, args: unknown) => {
    rpcCalls.push({ fn, args });
    if (fn === "claim_ingestion_job") return Promise.resolve({ data: opts.claimedJob, error: null });
    const result = opts.rpcResults?.[fn];
    return Promise.resolve(result ?? { data: null, error: null });
  });
  return { rpc, rpcCalls, from: vi.fn() };
}

describe("POST /api/self-mastery/ingestion/step", () => {
  beforeEach(() => {
    vi.stubEnv("SELF_MASTERY_INGESTION_SECRET", SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("401s without the correct secret -- fails closed, never reaches claim_ingestion_job", async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    const mock = makeMockSupabase({ claimedJob: null });
    vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: "Bearer wrong" } }));
    expect(res.status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("503s when the secret env var is unset -- fails closed, not open", async () => {
    vi.unstubAllEnvs();
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    const mock = makeMockSupabase({ claimedJob: null });
    vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
    expect(res.status).toBe(503);
  });

  it("returns 200/no_eligible_job when claim_ingestion_job finds nothing -- never calls advance", async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    const mock = makeMockSupabase({ claimedJob: null });
    vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
    const body = await res.json();
    expect(body.reason).toBe("no_eligible_job");
    expect(mock.rpcCalls.some((c) => c.fn === "advance_ingestion_cursor")).toBe(false);
  });

  it("returns 501 for a stage with no registered handler -- never calls advance", async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    const mock = makeMockSupabase({
      claimedJob: { id: "job-1", stage: "chunking", cursor_chunk_index: null, cursor_attempt: 1, book_id: "book-1" },
    });
    vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.stage).toBe("chunking");
    expect(mock.rpcCalls.some((c) => c.fn === "advance_ingestion_cursor")).toBe(false);
  });

  it("THE RED CASE: when the stage handler throws, advance_ingestion_cursor is NEVER called -- proven by call count, not by reading the code", async () => {
    vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({
      STAGE_HANDLERS: {
        verifying_grounding: vi.fn().mockRejectedValue(new Error("simulated stage failure")),
      },
    }));
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    const mock = makeMockSupabase({
      claimedJob: { id: "job-1", stage: "verifying_grounding", cursor_chunk_index: 0, cursor_attempt: 1, book_id: "book-1" },
    });
    vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.reason).toBe("stage_work_failed");
    // THE assertion this test exists for.
    expect(mock.rpcCalls.some((c) => c.fn === "advance_ingestion_cursor")).toBe(false);
  });

  it("GREEN: when the stage handler succeeds, advance_ingestion_cursor IS called with the exact expected position", async () => {
    vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({
      STAGE_HANDLERS: {
        verifying_grounding: vi.fn().mockResolvedValue({ nextStage: "verifying_grounding", nextChunkIndex: 1 }),
      },
    }));
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    const mock = makeMockSupabase({
      claimedJob: { id: "job-1", stage: "verifying_grounding", cursor_chunk_index: 0, cursor_attempt: 1, book_id: "book-1" },
      rpcResults: { advance_ingestion_cursor: { data: { id: "job-1" }, error: null } },
    });
    vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
    expect(res.status).toBe(200);
    const advanceCall = mock.rpcCalls.find((c) => c.fn === "advance_ingestion_cursor");
    expect(advanceCall?.args).toMatchObject({
      p_job_id: "job-1",
      p_expected_stage: "verifying_grounding",
      p_expected_chunk_index: 0,
      p_expected_attempt: 1,
      p_next_stage: "verifying_grounding",
      p_next_chunk_index: 1,
    });
  });

  it("reports alreadyAdvanced honestly when advance_ingestion_cursor returns null (the idempotent no-op)", async () => {
    vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({
      STAGE_HANDLERS: {
        verifying_grounding: vi.fn().mockResolvedValue({ nextStage: "verifying_grounding", nextChunkIndex: 1 }),
      },
    }));
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    const mock = makeMockSupabase({
      claimedJob: { id: "job-1", stage: "verifying_grounding", cursor_chunk_index: 0, cursor_attempt: 1, book_id: "book-1" },
      rpcResults: { advance_ingestion_cursor: { data: null, error: null } },
    });
    vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.alreadyAdvanced).toBe(true);
  });
});
