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

// Awaitable at every step, like the real supabase-js query builder --
// `.eq()/.not()/.lt()` all return another `terminal(result)`, and the
// object itself resolves via `.then` whether or not the caller chains
// further (`await x.update(v).eq(id)` and `await x.update(v).eq(id).lt(...)`
// both work against the SAME mock shape). One generic chain covers both the
// stage/progress_pct `.update()` calls (2026-09-15's fix: progress_pct is
// now a SEPARATE, `.lt()`-guarded update from `stage` -- see route.ts's
// `syncBookProgress`) and `fetchStageTotal`'s `.select(...).eq().not()`
// count query. `onLt` fires on every `.lt()` call so tests can assert the
// route asked the DB for the monotonic guard -- the DB's own WHERE-clause
// enforcement isn't re-proven here, same "prove the handler can't bypass
// it, don't re-prove the function" posture this file already takes with
// `advance_ingestion_cursor`'s CAS guard.
function terminal<T>(
  result: T,
  onLt?: (column: string, value: unknown) => void,
): T & { lt: (column: string, value: unknown) => T; eq: () => T; not: () => T; then: (resolve: (value: T) => void) => void } {
  return {
    ...result,
    lt: vi.fn((column: string, value: unknown) => {
      onLt?.(column, value);
      return terminal(result, onLt);
    }),
    eq: vi.fn(() => terminal(result, onLt)),
    not: vi.fn(() => terminal(result, onLt)),
    then: (resolve: (value: T) => void) => resolve(result),
  } as T & { lt: (column: string, value: unknown) => T; eq: () => T; not: () => T; then: (resolve: (value: T) => void) => void };
}

function makeMockSupabase(opts: {
  claimedJob: Record<string, unknown> | null;
  /**
   * What successive claim_ingestion_job calls return, in order; once exhausted the queue is empty (null), like the real
   * table with nothing eligible. Defaults to `[claimedJob]`: the route now LOOPS (claim -> stage -> advance, again), so a
   * mock that handed out the same job forever would spin until the time budget. One job, claimed once, is the shape every
   * pre-loop test was written for.
   */
  claimSequence?: (Record<string, unknown> | null)[];
  rpcResults?: Record<string, { data: unknown; error: unknown }>;
  /** Keyed by table name ("source_chunks" | "lessons") -- fetchStageTotal's count query result. Defaults to `{count: null, error: null}` for any table not configured, which makes estimateBookProgressPct fall back to its static curve, same as before this file's own tests were updated for the 2026-09-15 fix. */
  countResults?: Record<string, { count: number | null; error: unknown }>;
}) {
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const claims = [...(opts.claimSequence ?? [opts.claimedJob])];
  const rpc = vi.fn((fn: string, args: unknown) => {
    rpcCalls.push({ fn, args });
    if (fn === "claim_ingestion_job") return Promise.resolve({ data: claims.length > 0 ? claims.shift() : null, error: null });
    const result = opts.rpcResults?.[fn];
    return Promise.resolve(result ?? { data: null, error: null });
  });
  const updateCalls: { table: string; values: unknown }[] = [];
  const ltCalls: { table: string; column: string; value: unknown }[] = [];
  const from = vi.fn((table: string) => ({
    update: (values: unknown) => {
      updateCalls.push({ table, values });
      return terminal({ error: null }, (column, value) => ltCalls.push({ table, column, value }));
    },
    select: () => terminal(opts.countResults?.[table] ?? { count: null, error: null }),
  }));
  return { rpc, rpcCalls, from, updateCalls, ltCalls };
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

  describe("deterministic AI blocks fail the book on the FIRST attempt with a specific, retryable message (2b)", () => {
    it.each([
      ["no_key", /Add an API key in Settings, then tap Try again/],
      ["monthly_cap", /month's AI budget/],
      ["global_cap", /shared AI budget/],
    ] as const)("%s: attempt 1 of 3 already marks the job and the book failed, and the loop halts", async (blockKind, message) => {
      const GatewayCallFailedError = await loadGatewayCallFailedError();
      vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({
        STAGE_HANDLERS: {
          extracting_lessons: vi.fn().mockRejectedValue(new GatewayCallFailedError("gateway call failed -- blocked", undefined, blockKind === "global_cap", blockKind === "no_key" || blockKind === "monthly_cap" ? blockKind : undefined)),
        },
      }));
      const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
      const mock = makeMockSupabase({
        claimedJob: { id: "job-1", stage: "extracting_lessons", cursor_chunk_index: 0, cursor_attempt: 1, max_attempts: 3, book_id: "book-1" },
      });
      vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

      const { POST } = await import("../route");
      const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));

      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({ ok: false, reason: "ai_blocked", blockKind, loop: { stoppedBy: "halt" } });
      expect(mock.updateCalls.find((c) => c.table === "ingestion_jobs")?.values).toMatchObject({ stage: "failed" });
      const bookUpdate = mock.updateCalls.find((c) => c.table === "books")?.values as { status: string; error_message: string };
      expect(bookUpdate.status).toBe("failed");
      expect(bookUpdate.error_message).toMatch(message);
    });

    it("a timeout is NOT a deterministic block: with attempts left it stays retryable, nothing marked failed", async () => {
      const GatewayCallFailedError = await loadGatewayCallFailedError();
      vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({
        STAGE_HANDLERS: { extracting_lessons: vi.fn().mockRejectedValue(new GatewayCallFailedError("gateway call failed -- timed out", "timeout")) },
      }));
      const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
      const mock = makeMockSupabase({ claimedJob: { id: "job-1", stage: "extracting_lessons", cursor_chunk_index: 0, cursor_attempt: 1, max_attempts: 3, book_id: "book-1" } });
      vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);
      const { POST } = await import("../route");
      const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
      expect((await res.json()).reason).toBe("stage_work_failed");
      expect(mock.updateCalls.find((c) => c.table === "ingestion_jobs")).toBeUndefined();
    });
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

      // TWO separate books writes as of the 2026-09-15 fix: `stage` is
      // written unconditionally, `progress_pct` is written separately and
      // ONLY if it's higher than what's already stored (syncBookProgress's
      // own atomic `.lt()` guard) -- see route.ts's own header.
      const booksUpdates = mock.updateCalls.filter((c) => c.table === "books");
      const stageUpdate = booksUpdates.find((c) => "stage" in (c.values as object));
      const progressUpdate = booksUpdates.find((c) => "progress_pct" in (c.values as object));
      expect(stageUpdate?.values).toMatchObject({ stage: "generating_cards" });
      expect(typeof (progressUpdate?.values as { progress_pct: number } | undefined)?.progress_pct).toBe("number");
    });

    /**
     * REGRESSION SUITE (2026-09-15, the Lead's fix). Book 3d7a3825 (203
     * source_chunks, 60 ranked lessons) sat visibly frozen at 55%/97% for
     * hours because progress was estimated from a static per-chunk curve
     * that saturates long before a real book's true position gets there --
     * see ingestion-progress.ts's own header. These prove the ROUTE side:
     * it fetches the real total and passes it through, and it never lets a
     * freshly computed value overwrite a higher one already stored.
     */
    it("THE REGRESSION GUARD: fetches the REAL total for a chunked stage and estimates progress from it, not the static fallback curve", async () => {
      vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({
        STAGE_HANDLERS: {
          extracting_lessons: vi.fn().mockResolvedValue({ nextStage: "extracting_lessons", nextChunkIndex: 100 }),
        },
      }));
      const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
      const mock = makeMockSupabase({
        claimedJob: { id: "job-1", stage: "extracting_lessons", cursor_chunk_index: 99, cursor_attempt: 1, book_id: "book-1" },
        rpcResults: { advance_ingestion_cursor: { data: { id: "job-1" }, error: null } },
        // Book 3d7a3825's own real shape: 203 source_chunks total.
        countResults: { source_chunks: { count: 203, error: null } },
      });
      vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

      const { POST } = await import("../route");
      const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
      expect(res.status).toBe(200);

      // fetchStageTotal queried source_chunks for THIS book, not lessons.
      expect(mock.from).toHaveBeenCalledWith("source_chunks");
      const progressUpdate = mock.updateCalls.find((c) => c.table === "books" && "progress_pct" in (c.values as object));
      // base 10 + round(45 * 100/203) = 32 -- the same number
      // ingestion-progress.test.ts's own regression guard asserts directly
      // against estimateBookProgressPct. Would be 55 (fully saturated) under
      // the old static curve at this position.
      expect((progressUpdate?.values as { progress_pct: number }).progress_pct).toBe(32);
    });

    it("THE REGRESSION GUARD: asks the DB to guard progress_pct with .lt(), so a redeploy mid-run can never overwrite a higher already-stored value", async () => {
      vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({
        STAGE_HANDLERS: {
          generating_cards: vi.fn().mockResolvedValue({ nextStage: "generating_cards", nextChunkIndex: 30 }),
        },
      }));
      const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
      const mock = makeMockSupabase({
        claimedJob: { id: "job-1", stage: "generating_cards", cursor_chunk_index: 29, cursor_attempt: 1, book_id: "book-1" },
        rpcResults: { advance_ingestion_cursor: { data: { id: "job-1" }, error: null } },
        // Book 3d7a3825's own real shape: 60 ranked lessons.
        countResults: { lessons: { count: 60, error: null } },
      });
      vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

      const { POST } = await import("../route");
      const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
      expect(res.status).toBe(200);

      // base 75 + round(22 * 30/60) = 86 -- would already have read 97 under
      // the old curve at this same position (saturates by lesson 11), which
      // is exactly the value a redeploy must not clobber.
      const ltCall = mock.ltCalls.find((c) => c.table === "books" && c.column === "progress_pct");
      expect(ltCall?.value).toBe(86);
      const progressUpdate = mock.updateCalls.find((c) => c.table === "books" && "progress_pct" in (c.values as object));
      expect((progressUpdate?.values as { progress_pct: number }).progress_pct).toBe(86);
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
      // 2b: a spend-cap refusal is a typed, deterministic block, so it now fails the book on the FIRST attempt as
      // "ai_blocked" (this test ran it at the last attempt and expected "attempts_exhausted"). What it exists to prove is
      // unchanged: the position is never skipped past, and the book fails with the real reason.
      expect(body).toMatchObject({ reason: "ai_blocked", blockKind: "global_cap" });
      expect(mock.updateCalls.find((c) => c.table === "ingestion_jobs")?.values).toMatchObject({ stage: "failed" });
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

  describe("one poll runs many steps (2a: claim -> stage -> advance, looped)", () => {
    const job = (id: string, stage: string, chunk: number | null, book = "book-1") => ({ id, stage, cursor_chunk_index: chunk, cursor_attempt: 1, max_attempts: 3, book_id: book });
    const advanceOk = { advance_ingestion_cursor: { data: { id: "x" }, error: null } };
    const call = async () => {
      const { POST } = await import("../route");
      const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
      return { res, body: (await res.json()) as Record<string, any> };
    };

    it("runs several stages in ONE call, each with its own advance, and reports the last step plus how the loop ended", async () => {
      const chunking = vi.fn().mockResolvedValue({ nextStage: "extracting_lessons", nextChunkIndex: 0 });
      const extracting = vi.fn().mockResolvedValue({ nextStage: "extracting_lessons", nextChunkIndex: 1 });
      vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({ STAGE_HANDLERS: { chunking, extracting_lessons: extracting } }));
      const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
      const mock = makeMockSupabase({
        claimedJob: null,
        claimSequence: [job("j1", "chunking", null), job("j1", "extracting_lessons", 0), job("j1", "extracting_lessons", 1)],
        rpcResults: advanceOk,
      });
      vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

      const { res, body } = await call();

      expect(res.status).toBe(200);
      expect(chunking).toHaveBeenCalledTimes(1);
      expect(extracting).toHaveBeenCalledTimes(2);
      const advances = mock.rpcCalls.filter((c) => c.fn === "advance_ingestion_cursor").map((c) => c.args);
      expect(advances).toHaveLength(3);
      expect(advances[0]).toMatchObject({ p_expected_stage: "chunking", p_next_stage: "extracting_lessons", p_next_chunk_index: 0 });
      expect(advances[2]).toMatchObject({ p_expected_stage: "extracting_lessons", p_expected_chunk_index: 1, p_next_chunk_index: 1 });
      // The books sync still happens once per successful advance (each iteration's writes are the old single-shot writes).
      expect(mock.updateCalls.filter((u) => u.table === "books")).toHaveLength(3 * 2);
      expect(body).toMatchObject({ ok: true, stage: "extracting_lessons", chunkIndex: 1, loop: { steps: 3, stoppedBy: "no_job" } });
    });

    it("heartbeat and sweep run ONCE per call, not once per step", async () => {
      const handler = vi.fn().mockResolvedValue({ nextStage: "merging", nextChunkIndex: null });
      vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({ STAGE_HANDLERS: { chunking: handler } }));
      const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
      const mock = makeMockSupabase({ claimedJob: null, claimSequence: [job("j1", "chunking", null), job("j2", "chunking", null, "book-2")], rpcResults: advanceOk });
      vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

      await call();

      const heartbeats = mock.updateCalls.filter((u) => u.table === "ingestion_driver_heartbeats");
      expect(heartbeats).toHaveLength(1);
      expect(handler).toHaveBeenCalledTimes(2); // and it carried on across jobs
    });

    it("keeps going past a job reaching 'done' and claims the next book, stopping only when nothing is eligible", async () => {
      const finalizing = vi.fn().mockResolvedValue({ nextStage: "done", nextChunkIndex: null });
      vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({ STAGE_HANDLERS: { finalizing } }));
      const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
      const mock = makeMockSupabase({ claimedJob: null, claimSequence: [job("j1", "finalizing", null), job("j2", "finalizing", null, "book-2")], rpcResults: advanceOk });
      vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

      const { body } = await call();

      expect(finalizing).toHaveBeenCalledTimes(2);
      expect(body.loop).toMatchObject({ steps: 2, stoppedBy: "no_job" });
    });

    it("the time budget stops the loop: with 100 s per step it runs two steps and leaves the rest for the next poll", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const slow = vi.fn(async () => {
          vi.setSystemTime(Date.now() + 100_000);
          return { nextStage: "extracting_lessons", nextChunkIndex: 1 };
        });
        vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({ STAGE_HANDLERS: { extracting_lessons: slow } }));
        const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
        const mock = makeMockSupabase({
          claimedJob: null,
          claimSequence: [job("j1", "extracting_lessons", 0), job("j1", "extracting_lessons", 1), job("j1", "extracting_lessons", 2), job("j1", "extracting_lessons", 3)],
          rpcResults: advanceOk,
        });
        vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

        const { body } = await call();

        expect(slow).toHaveBeenCalledTimes(2); // 100 s + slowest 100 s = 200 s < 240 s: go again; 200 s + 100 s >= 240 s: stop
        expect(body.loop).toMatchObject({ steps: 2, stoppedBy: "budget" });
        expect(mock.rpcCalls.filter((c) => c.fn === "claim_ingestion_job")).toHaveLength(2); // the third claim was never made
      } finally {
        vi.useRealTimers();
      }
    });

    it("a cursor another invocation already moved (advance CAS miss, data null) ends THIS loop cleanly: 200, stoppedBy 'stopped', no further claims", async () => {
      const handler = vi.fn().mockResolvedValue({ nextStage: "extracting_lessons", nextChunkIndex: 1 });
      vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({ STAGE_HANDLERS: { extracting_lessons: handler } }));
      const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
      const mock = makeMockSupabase({
        claimedJob: null,
        claimSequence: [job("j1", "extracting_lessons", 0), job("j1", "extracting_lessons", 1)],
        rpcResults: { advance_ingestion_cursor: { data: null, error: null } },
      });
      vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

      const { res, body } = await call();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({ ok: true, alreadyAdvanced: true, loop: { steps: 1, stoppedBy: "stopped" } });
      expect(mock.rpcCalls.filter((c) => c.fn === "claim_ingestion_job")).toHaveLength(1);
    });

    it("a stage failure in the middle of the loop stops it where the single-shot route returned: the earlier step stays advanced, the failure is reported as before", async () => {
      const ok = vi.fn().mockResolvedValue({ nextStage: "extracting_lessons", nextChunkIndex: 1 });
      const boom = vi.fn().mockRejectedValue(new Error("model exploded"));
      vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({ STAGE_HANDLERS: { chunking: ok, extracting_lessons: boom } }));
      const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
      const mock = makeMockSupabase({
        claimedJob: null,
        claimSequence: [job("j1", "chunking", null), job("j1", "extracting_lessons", 0), job("j1", "extracting_lessons", 0)],
        rpcResults: advanceOk,
      });
      vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);

      const { res, body } = await call();

      expect(res.status).toBe(500);
      expect(body).toMatchObject({ ok: false, reason: "stage_work_failed", error: "model exploded", loop: { steps: 2, stoppedBy: "halt" } });
      expect(mock.rpcCalls.filter((c) => c.fn === "advance_ingestion_cursor")).toHaveLength(1); // only the chunking step advanced
      expect(mock.rpcCalls.filter((c) => c.fn === "claim_ingestion_job")).toHaveLength(2); // no claim after the failure
    });

    describe("self-chaining: a budget stop kicks the driver through the database (migration 273)", () => {
      const kicks = (mock: ReturnType<typeof makeMockSupabase>) => mock.rpcCalls.filter((c) => c.fn === "kick_ingestion_driver");
      const kickOk = { kick_ingestion_driver: { data: true, error: null } };

      /** Two 100 s steps then the budget stops the loop (see the budget test above); `hopHeader`/env vary per case. */
      async function budgetRun(opts: { hopHeader?: string; rpcResults?: Record<string, { data: unknown; error: unknown }> } = {}) {
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
          const slow = vi.fn(async () => {
            vi.setSystemTime(Date.now() + 100_000);
            return { nextStage: "extracting_lessons", nextChunkIndex: 1 };
          });
          vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({ STAGE_HANDLERS: { extracting_lessons: slow } }));
          const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
          const mock = makeMockSupabase({
            claimedJob: null,
            claimSequence: [job("j1", "extracting_lessons", 0), job("j1", "extracting_lessons", 1), job("j1", "extracting_lessons", 2)],
            rpcResults: { ...advanceOk, ...kickOk, ...opts.rpcResults },
          });
          vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);
          const { POST } = await import("../route");
          const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}`, ...(opts.hopHeader ? { "x-ingestion-hop": opts.hopHeader } : {}) } }));
          return { mock, res, body: (await res.json()) as Record<string, any> };
        } finally {
          vi.useRealTimers();
        }
      }

      it("a budget stop asks the DB to kick the next hop, and says so in the response", async () => {
        const { mock, body } = await budgetRun();
        expect(body.loop).toMatchObject({ stoppedBy: "budget", chained: true, hop: 0 });
        expect(kicks(mock)).toHaveLength(1);
        expect(kicks(mock)[0]!.args).toEqual({ p_hop: 1 });
      });

      it("the hop number comes from the incoming x-ingestion-hop header and goes up by one", async () => {
        const { mock, body } = await budgetRun({ hopHeader: "5" });
        expect(kicks(mock)[0]!.args).toEqual({ p_hop: 6 });
        expect(body.loop).toMatchObject({ hop: 5, chained: true });
      });

      it("the chain stops at the hop cap: no kick at hop 30 (the cron resumes), and a hop above it is clamped", async () => {
        for (const hopHeader of ["30", "999"]) {
          vi.resetModules();
          const { mock, body } = await budgetRun({ hopHeader });
          expect(kicks(mock)).toHaveLength(0);
          expect(body.loop).toMatchObject({ stoppedBy: "budget", chained: false, hop: 30 });
        }
      });

      it("a malformed hop header counts as 0 rather than being trusted", async () => {
        const { mock } = await budgetRun({ hopHeader: "banana" });
        expect(kicks(mock)[0]!.args).toEqual({ p_hop: 1 });
      });

      it("the kill switch INGESTION_SELF_CHAIN=off never kicks", async () => {
        vi.stubEnv("INGESTION_SELF_CHAIN", "off");
        const { mock, body } = await budgetRun();
        expect(kicks(mock)).toHaveLength(0);
        expect(body.loop).toMatchObject({ stoppedBy: "budget", chained: false });
      });

      it("when the DB's rate guard declines (returns false) the response says chained:false and nothing breaks", async () => {
        const { body, res } = await budgetRun({ rpcResults: { kick_ingestion_driver: { data: false, error: null } } });
        expect(res.status).toBe(200);
        expect(body.loop).toMatchObject({ stoppedBy: "budget", chained: false });
      });

      it("a kick that errors never changes the response: same status and body, chained:false, the cron is the fallback", async () => {
        const { res, body } = await budgetRun({ rpcResults: { kick_ingestion_driver: { data: null, error: { message: "boom" } } } });
        expect(res.status).toBe(200);
        expect(body).toMatchObject({ ok: true, stage: "extracting_lessons", loop: { steps: 2, stoppedBy: "budget", chained: false } });
      });

      it.each([
        ["nothing eligible", [] as ReturnType<typeof job>[], "no_job"],
        ["a job reaching done", [job("j1", "finalizing", null)], "no_job"],
      ])("never kicks after a non-budget stop: %s", async (_name, claimSequence, stoppedBy) => {
        const finalizing = vi.fn().mockResolvedValue({ nextStage: "done", nextChunkIndex: null });
        vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({ STAGE_HANDLERS: { finalizing } }));
        const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
        const mock = makeMockSupabase({ claimedJob: null, claimSequence, rpcResults: { ...advanceOk, ...kickOk } });
        vi.mocked(createServiceRoleClient).mockReturnValue(mock as never);
        const { POST } = await import("../route");
        const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
        expect((await res.json()).loop.stoppedBy).toBe(stoppedBy);
        expect(kicks(mock)).toHaveLength(0);
      });

      it("never kicks after a stage failure or after a cursor another invocation moved", async () => {
        const boom = vi.fn().mockRejectedValue(new Error("model exploded"));
        vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({ STAGE_HANDLERS: { extracting_lessons: boom } }));
        const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
        const failing = makeMockSupabase({ claimedJob: job("j1", "extracting_lessons", 0), rpcResults: { ...advanceOk, ...kickOk } });
        vi.mocked(createServiceRoleClient).mockReturnValue(failing as never);
        const { POST } = await import("../route");
        const failed = await (await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }))).json();
        expect(failed.loop.stoppedBy).toBe("halt");
        expect(kicks(failing)).toHaveLength(0);

        vi.resetModules();
        const ok = vi.fn().mockResolvedValue({ nextStage: "extracting_lessons", nextChunkIndex: 1 });
        vi.doMock("@/lib/self-mastery/ingestion/worker-stages", () => ({ STAGE_HANDLERS: { extracting_lessons: ok } }));
        const { createServiceRoleClient: create2 } = await import("@/lib/supabase/service-role");
        const missed = makeMockSupabase({ claimedJob: job("j1", "extracting_lessons", 0), rpcResults: { advance_ingestion_cursor: { data: null, error: null }, ...kickOk } });
        vi.mocked(create2).mockReturnValue(missed as never);
        const { POST: POST2 } = await import("../route");
        const stopped = await (await POST2(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }))).json();
        expect(stopped.loop.stoppedBy).toBe("stopped");
        expect(kicks(missed)).toHaveLength(0);
      });
    });
  });
});
