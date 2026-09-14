import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Dynamically imported inside each test that needs it, AFTER any vi.doMock
// and in the same tick as `await import("../route")` -- NOT a static
// top-level import. `afterEach` here calls `vi.resetModules()`, so a
// static import resolved once at file-load time would end up a DIFFERENT
// class instance than the one route.ts's own (dynamically re-resolved)
// import of deepseek-provider.ts sees on any test after the first reset --
// `instanceof` silently fails across that boundary. Matches this file's
// own existing pattern for createServiceRoleClient below, for the same reason.
async function loadGatewayCallFailedError() {
  const { GatewayCallFailedError } = await import("@/lib/self-mastery/ingestion/llm/deepseek-provider");
  return GatewayCallFailedError;
}

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
    // S6 (2026-09-14): the route now also writes a heartbeat (before the
    // claim, on every authenticated call) and syncs books.status='failed'
    // (the bug this pass closes — see route.ts's own header) — so this is
    // no longer the ONLY update the invocation makes. Asserting on the
    // specific writes that matter, not the total count, is also the more
    // robust shape: a future, unrelated addition to this route's
    // observability shouldn't have to keep re-deriving a magic length here.
    const ingestionJobsUpdate = mock.updateCalls.find((c) => c.table === "ingestion_jobs");
    expect(ingestionJobsUpdate?.values).toMatchObject({ stage: "failed" });
    expect((ingestionJobsUpdate?.values as { last_error: string }).last_error).toContain("embedder unreachable");

    // THE BUG THIS TEST NOW ALSO COVERS: before S6, ingestion_jobs.stage
    // went to 'failed' but books.status never did, so a user's own UI
    // (which reads books, never ingestion_jobs, directly) showed this book
    // stuck at "processing" forever with no signal anything went wrong.
    const booksUpdate = mock.updateCalls.find((c) => c.table === "books");
    expect(booksUpdate?.values).toMatchObject({ status: "failed" });
  });

  it("does NOT mark the job failed when attempts remain -- stays retryable, only the heartbeat is written", async () => {
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
    // No ingestion_jobs write (not exhausted yet) and no books write
    // (nothing succeeded to sync) -- only the unconditional heartbeat.
    expect(mock.updateCalls.some((c) => c.table === "ingestion_jobs")).toBe(false);
    expect(mock.updateCalls.some((c) => c.table === "books")).toBe(false);
    expect(mock.updateCalls.some((c) => c.table === "ingestion_driver_heartbeats")).toBe(true);
  });

  describe("books sync on successful advance (S6, 2026-09-14)", () => {
    it("syncs books.stage and an estimated progress_pct alongside a successful advance", async () => {
      vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({
        STAGE_HANDLERS: {
          verifying_grounding: vi.fn().mockResolvedValue({ nextStage: "generating_cards", nextChunkIndex: 0 }),
        },
      }));
      const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
      const mock = makeMockSupabase({
        claimedJob: { id: "job-1", stage: "verifying_grounding", cursor_chunk_index: 4, cursor_attempt: 1, book_id: "book-1" },
        rpcResults: { advance_ingestion_cursor: { data: { id: "job-1" }, error: null } },
      });
      vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

      const { POST } = await import("../route");
      const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
      expect(res.status).toBe(200);

      const booksUpdate = mock.updateCalls.find((c) => c.table === "books");
      expect(booksUpdate?.values).toMatchObject({ stage: "generating_cards" });
      expect(typeof (booksUpdate?.values as { progress_pct: number }).progress_pct).toBe("number");
    });

    it("does NOT touch books when the advance lands on 'done' -- finalizingStage already owns that terminal write", async () => {
      vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({
        STAGE_HANDLERS: {
          finalizing: vi.fn().mockResolvedValue({ nextStage: "done", nextChunkIndex: null }),
        },
      }));
      const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
      const mock = makeMockSupabase({
        claimedJob: { id: "job-1", stage: "finalizing", cursor_chunk_index: null, cursor_attempt: 1, book_id: "book-1" },
        rpcResults: { advance_ingestion_cursor: { data: { id: "job-1" }, error: null } },
      });
      vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

      const { POST } = await import("../route");
      const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
      expect(res.status).toBe(200);
      expect(mock.updateCalls.some((c) => c.table === "books")).toBe(false);
    });
  });

  /**
   * BUG-1 layer 1 (2026-09-14). GATE 5's tests above prove the
   * fail-the-book default; these prove the narrow, deliberately-scoped
   * exception: a per-position stage exhausting on a CONTENT-shaped failure
   * skips that one position instead, while an infrastructure/budget
   * failure (auth, spend-cap) still fails the book exactly as before, and
   * a genuine streak of skips still fails the book with the true reason.
   */
  describe("BUG-1 layer 1: skip-and-advance on a content-shaped exhaustion", () => {
    it("exhausted TIMEOUT at a per-position stage -> skipped, cursor advances, book NOT failed", async () => {
      const GatewayCallFailedError = await loadGatewayCallFailedError();
      vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({
        STAGE_HANDLERS: {
          extracting_lessons: vi.fn().mockRejectedValue(new GatewayCallFailedError("gateway call failed -- timeout", "timeout")),
        },
      }));
      const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
      const mock = makeMockSupabase({
        claimedJob: { id: "job-1", stage: "extracting_lessons", cursor_chunk_index: 0, cursor_attempt: 3, max_attempts: 3, book_id: "book-1" },
        rpcResults: {
          skip_ingestion_cursor_position: { data: { skipped_positions: 1, consecutive_skipped_positions: 1 }, error: null },
        },
      });
      vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

      const { POST } = await import("../route");
      const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.reason).toBe("chunk_skipped_after_exhausted_attempts");
      expect(body.nextChunkIndex).toBe(1);

      const skipCall = mock.rpcCalls.find((c) => c.fn === "skip_ingestion_cursor_position");
      expect(skipCall?.args).toMatchObject({
        p_job_id: "job-1",
        p_expected_stage: "extracting_lessons",
        p_expected_chunk_index: 0,
        p_expected_attempt: 3,
        p_next_stage: "extracting_lessons",
        p_next_chunk_index: 1,
      });
      // THE assertion this test exists for: the book must NOT be failed.
      expect(mock.updateCalls.some((c) => c.table === "ingestion_jobs" && (c.values as { stage?: string }).stage === "failed")).toBe(false);
      expect(mock.updateCalls.some((c) => c.table === "books" && (c.values as { status?: string }).status === "failed")).toBe(false);
      // books.stage/progress_pct still synced, same as a genuine advance.
      const booksUpdate = mock.updateCalls.find((c) => c.table === "books");
      expect(booksUpdate?.values).toMatchObject({ stage: "extracting_lessons" });
    });

    it("exhausted AUTH failure -> NOT silently skipped past -- book fails with the true (infrastructure) reason", async () => {
      const GatewayCallFailedError = await loadGatewayCallFailedError();
      vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({
        STAGE_HANDLERS: {
          extracting_lessons: vi.fn().mockRejectedValue(new GatewayCallFailedError("gateway call failed -- key rejected", "auth")),
        },
      }));
      const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
      const mock = makeMockSupabase({
        claimedJob: { id: "job-1", stage: "extracting_lessons", cursor_chunk_index: 0, cursor_attempt: 3, max_attempts: 3, book_id: "book-1" },
      });
      vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

      const { POST } = await import("../route");
      const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.reason).toBe("attempts_exhausted");
      // THE assertion this test exists for: auth is NEVER content-shaped --
      // skip_ingestion_cursor_position must never even be called.
      expect(mock.rpcCalls.some((c) => c.fn === "skip_ingestion_cursor_position")).toBe(false);
      const ingestionJobsUpdate = mock.updateCalls.find((c) => c.table === "ingestion_jobs");
      expect(ingestionJobsUpdate?.values).toMatchObject({ stage: "failed" });
      const booksUpdate = mock.updateCalls.find((c) => c.table === "books");
      expect(booksUpdate?.values).toMatchObject({ status: "failed" });
    });

    it("exhausted SPEND-CAP refusal -> NOT silently skipped past, even though errorKind is undefined on a capBlocked result", async () => {
      const GatewayCallFailedError = await loadGatewayCallFailedError();
      vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({
        STAGE_HANDLERS: {
          extracting_lessons: vi.fn().mockRejectedValue(new GatewayCallFailedError("gateway call failed -- spend cap reached", undefined, true)),
        },
      }));
      const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
      const mock = makeMockSupabase({
        claimedJob: { id: "job-1", stage: "extracting_lessons", cursor_chunk_index: 0, cursor_attempt: 3, max_attempts: 3, book_id: "book-1" },
      });
      vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

      const { POST } = await import("../route");
      const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.reason).toBe("attempts_exhausted");
      expect(mock.rpcCalls.some((c) => c.fn === "skip_ingestion_cursor_position")).toBe(false);
    });

    it("3 consecutive skips -> circuit breaker trips, book fails with the provider reason, not a generic one", async () => {
      const GatewayCallFailedError = await loadGatewayCallFailedError();
      vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({
        STAGE_HANDLERS: {
          extracting_lessons: vi.fn().mockRejectedValue(new GatewayCallFailedError("gateway call failed -- timeout", "timeout")),
        },
      }));
      const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
      const mock = makeMockSupabase({
        claimedJob: { id: "job-1", stage: "extracting_lessons", cursor_chunk_index: 2, cursor_attempt: 3, max_attempts: 3, book_id: "book-1" },
        // This is the 3rd consecutive skip -- the function's own return
        // value is what the route trusts, not a count it re-derives.
        rpcResults: {
          skip_ingestion_cursor_position: { data: { skipped_positions: 3, consecutive_skipped_positions: 3 }, error: null },
        },
      });
      vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

      const { POST } = await import("../route");
      const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.reason).toBe("circuit_breaker_tripped");
      const ingestionJobsUpdate = mock.updateCalls.find((c) => c.table === "ingestion_jobs");
      expect(ingestionJobsUpdate?.values).toMatchObject({ stage: "failed" });
      // TWO books writes happen here, in order: the skip's own stage/
      // progress_pct sync, then failBook's status='failed' write once the
      // breaker trips -- find the one that actually marks it failed, not
      // just the first books write.
      const booksFailUpdate = mock.updateCalls.find((c) => c.table === "books" && (c.values as { status?: string }).status === "failed");
      expect(booksFailUpdate?.values).toBeDefined();
      expect((booksFailUpdate?.values as { error_message: string }).error_message).toMatch(/AI provider/i);
    });

    it("2 consecutive skips (under the K=3 breaker) -> still just a skip, book stays alive", async () => {
      const GatewayCallFailedError = await loadGatewayCallFailedError();
      vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({
        STAGE_HANDLERS: {
          extracting_lessons: vi.fn().mockRejectedValue(new GatewayCallFailedError("gateway call failed -- timeout", "timeout")),
        },
      }));
      const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
      const mock = makeMockSupabase({
        claimedJob: { id: "job-1", stage: "extracting_lessons", cursor_chunk_index: 1, cursor_attempt: 3, max_attempts: 3, book_id: "book-1" },
        rpcResults: {
          skip_ingestion_cursor_position: { data: { skipped_positions: 2, consecutive_skipped_positions: 2 }, error: null },
        },
      });
      vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

      const { POST } = await import("../route");
      const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.reason).toBe("chunk_skipped_after_exhausted_attempts");
      expect(mock.updateCalls.some((c) => c.table === "books" && (c.values as { status?: string }).status === "failed")).toBe(false);
    });

    it("whole-book stage exhaustion (chunk_index null) -> unchanged fail-the-book behavior, never attempts a skip", async () => {
      const GatewayCallFailedError = await loadGatewayCallFailedError();
      vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({
        STAGE_HANDLERS: {
          chunking: vi.fn().mockRejectedValue(new GatewayCallFailedError("gateway call failed -- timeout", "timeout")),
        },
      }));
      const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
      const mock = makeMockSupabase({
        claimedJob: { id: "job-1", stage: "chunking", cursor_chunk_index: null, cursor_attempt: 3, max_attempts: 3, book_id: "book-1" },
      });
      vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

      const { POST } = await import("../route");
      const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.reason).toBe("attempts_exhausted");
      // THE assertion this test exists for: a content-shaped errorKind is
      // not enough on its own -- a whole-book stage (no chunk to skip past)
      // must never call skip_ingestion_cursor_position, timeout or not.
      expect(mock.rpcCalls.some((c) => c.fn === "skip_ingestion_cursor_position")).toBe(false);
      const ingestionJobsUpdate = mock.updateCalls.find((c) => c.table === "ingestion_jobs");
      expect(ingestionJobsUpdate?.values).toMatchObject({ stage: "failed" });
    });

    it("CODE-LEVEL HALF of the CAS guarantee: when skip_ingestion_cursor_position itself errors (the DB's own CAS refusing), falls back to failing the book rather than silently treating it as success -- the SQL-level refusal itself is proven in a rolled-back transaction at apply time, not re-proven here, same posture GATE 3 already established for advance_ingestion_cursor", async () => {
      const GatewayCallFailedError = await loadGatewayCallFailedError();
      vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({
        STAGE_HANDLERS: {
          extracting_lessons: vi.fn().mockRejectedValue(new GatewayCallFailedError("gateway call failed -- timeout", "timeout")),
        },
      }));
      const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
      const mock = makeMockSupabase({
        claimedJob: { id: "job-1", stage: "extracting_lessons", cursor_chunk_index: 0, cursor_attempt: 3, max_attempts: 3, book_id: "book-1" },
        rpcResults: {
          skip_ingestion_cursor_position: { data: null, error: { message: "skip_ingestion_cursor_position: job job-1 is not at an exhausted position" } },
        },
      });
      vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

      const { POST } = await import("../route");
      const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.reason).toBe("chunk_skip_failed");
      const ingestionJobsUpdate = mock.updateCalls.find((c) => c.table === "ingestion_jobs");
      expect(ingestionJobsUpdate?.values).toMatchObject({ stage: "failed" });
    });
  });

  describe("driver heartbeat (S6, 2026-09-14)", () => {
    it("writes the heartbeat on an authenticated call even when there is nothing to do", async () => {
      const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
      const mock = makeMockSupabase({ claimedJob: null });
      vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

      const { POST } = await import("../route");
      await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));

      expect(mock.updateCalls.some((c) => c.table === "ingestion_driver_heartbeats")).toBe(true);
    });

    it("does NOT write the heartbeat on a failed auth -- only an authenticated call proves the driver is alive", async () => {
      const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
      const mock = makeMockSupabase({ claimedJob: null });
      vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

      const { POST } = await import("../route");
      await POST(new Request("http://x", { method: "POST", headers: { authorization: "Bearer wrong" } }));

      expect(mock.updateCalls.some((c) => c.table === "ingestion_driver_heartbeats")).toBe(false);
    });
  });
});
