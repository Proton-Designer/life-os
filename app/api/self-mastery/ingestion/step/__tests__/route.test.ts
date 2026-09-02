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
  describeError: (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : String(e)),
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
  const updateCalls: { table: string; values: unknown }[] = [];
  const from = vi.fn((table: string) => ({
    update: (values: unknown) => {
      updateCalls.push({ table, values });
      return { eq: vi.fn(() => Promise.resolve({ error: null })) };
    },
  }));
  return { rpc, rpcCalls, from, updateCalls };
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

  it("REGRESSION: treats claim_ingestion_job's real PostgREST shape for 'nothing found' (a composite ROW OF NULLS, not JS null) as no_eligible_job too -- found live running item 7 against an empty table, confirmed against the real REST endpoint: `{\"id\":null,\"stage\":null,...}` is what PostgREST actually returns, not `null`, and a bare `!job` check is dead code against it", async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    const allNullRow = {
      id: null, book_id: null, user_id: null, stage: null, cursor_attempt: null,
      max_attempts: null, leased_until: null, last_error: null, reingest: null,
      created_at: null, updated_at: null, cursor_chunk_index: null,
    };
    const mock = makeMockSupabase({ claimedJob: allNullRow });
    vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
    const body = await res.json();
    expect(res.status).toBe(200);
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

  /**
   * GATE 5: max_attempts enforced at the cursor. `claim_ingestion_job`'s own
   * WHERE clause (109, `cursor_attempt < max_attempts`) already makes an
   * exhausted position unclaimable -- Eng 1's, not re-proven here. What
   * these two tests prove: THIS route explicitly marks a job `failed`
   * (observable) the moment a failure exhausts its last attempt, rather
   * than leaving it to silently stop appearing with no signal why -- "must
   * stop being claimed" without "and something says so" is exactly the
   * self-chaining-driver trap the track plan names: a stuck chunk retries
   * until attempts run out, then just vanishes from view.
   */
  it("GATE 5, red case reproduced: on the LAST allowed attempt, a stage failure marks the job stage='failed' with last_error naming why", async () => {
    vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({
      STAGE_HANDLERS: {
        verifying_grounding: vi.fn().mockRejectedValue(new Error("embedder unreachable")),
      },
    }));
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    const mock = makeMockSupabase({
      // cursor_attempt=3, max_attempts=3 -- claim_ingestion_job already
      // incremented cursor_attempt to 3 for THIS attempt, so this is the
      // last one this position will ever get.
      claimedJob: { id: "job-1", stage: "verifying_grounding", cursor_chunk_index: 0, cursor_attempt: 3, max_attempts: 3, book_id: "book-1" },
    });
    vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.reason).toBe("attempts_exhausted");
    expect(mock.updateCalls).toHaveLength(1);
    expect(mock.updateCalls[0]!.table).toBe("ingestion_jobs");
    expect(mock.updateCalls[0]!.values).toMatchObject({ stage: "failed" });
    expect((mock.updateCalls[0]!.values as { last_error: string }).last_error).toContain("embedder unreachable");
  });

  it("does NOT mark the job failed when attempts remain -- stays retryable, no update issued", async () => {
    vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({
      STAGE_HANDLERS: {
        verifying_grounding: vi.fn().mockRejectedValue(new Error("transient failure")),
      },
    }));
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    const mock = makeMockSupabase({
      claimedJob: { id: "job-1", stage: "verifying_grounding", cursor_chunk_index: 0, cursor_attempt: 1, max_attempts: 3, book_id: "book-1" },
    });
    vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));

    const body = await res.json();
    expect(body.reason).toBe("stage_work_failed");
    expect(mock.updateCalls).toHaveLength(0);
  });
});
