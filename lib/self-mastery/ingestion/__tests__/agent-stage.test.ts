import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeFakeDb, type FakeDb } from "./fake-db";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/gateway", () => ({ gatewayChat: vi.fn() }));
const hasAnyAiKeyMock = vi.fn();
vi.mock("@/lib/ai/resolve-key", () => ({ hasAnyAiKey: (...a: unknown[]) => hasAnyAiKeyMock(...a) }));
const hasConnectorMock = vi.fn();
vi.mock("@/lib/agent-jobs/core", () => ({ hasAgentConnector: (...a: unknown[]) => hasConnectorMock(...a) }));

const { planAgentStage, BOOK_STAGE_WINDOW } = await import("../agent-stage");

const BOOK = "b0000000-0000-4000-8000-000000000001";
const USER = "u0000000-0000-4000-8000-000000000001";
const job = (stage: string) => ({ id: "ij-1", book_id: BOOK, user_id: USER, stage, cursor_chunk_index: 0, cursor_attempt: 1 }) as never;
const chunk = (n: number) => ({ id: `chunk-${n}`, book_id: BOOK, text: `Passage ${n} text.`, page_start: n, page_end: n, section_id: null, sort_order: n });
const lesson = (n: number, over: Record<string, unknown> = {}) => ({ id: `lesson-${n}`, book_id: BOOK, title: `T${n}`, core_claim: `C${n}`, mechanism: `M${n}`, action_template: `A${n}`, provenance_quote: `Q${n}`, rank: n, ...over });
const stepJob = (stage: string, unit: string, status: string, extra: Record<string, unknown> = {}) => ({
  id: `aj-${stage}-${unit}`, user_id: USER, kind: "self_mastery.book_stage", subject_type: "book", subject_id: BOOK, dedupe_key: `${BOOK}:${stage}:${unit}`, status, error: null, ...extra,
});

function db(seed: Record<string, Record<string, unknown>[]>) {
  return makeFakeDb(
    { books: [{ id: BOOK, user_id: USER, reader_source: "pdf", progress_pct: 0 }], book_sections: [], source_chunks: [], lessons: [], agent_jobs: [], ...seed },
    { enqueue_book_stage_jobs: (a) => (a.p_units as unknown[]).length },
  );
}
const enqueued = (d: FakeDb) => d.rpcCalls.filter((c) => c.fn === "enqueue_book_stage_jobs");

beforeEach(() => {
  hasAnyAiKeyMock.mockReset().mockResolvedValue(false);
  hasConnectorMock.mockReset().mockResolvedValue(true);
});

describe("planAgentStage — which path a model stage takes", () => {
  it("a stage with no model call (chunking, merging...) is never planned", async () => {
    const d = db({});
    expect(await planAgentStage(d.client, job("merging"))).toEqual({ kind: "inline" });
    expect(await planAgentStage(d.client, job("chunking"))).toEqual({ kind: "inline" });
    expect(hasAnyAiKeyMock).not.toHaveBeenCalled();
  });

  it("with a key the owner's own key runs it, exactly as before (and any steps still queued for an agent are cancelled so they cannot apply late)", async () => {
    hasAnyAiKeyMock.mockResolvedValue(true);
    const d = db({ source_chunks: [chunk(1)], agent_jobs: [stepJob("extracting_lessons", "chunk-1", "pending")] });
    expect(await planAgentStage(d.client, job("extracting_lessons"))).toEqual({ kind: "inline" });
    expect(d.tables.agent_jobs![0]!.status).toBe("cancelled");
    expect(enqueued(d)).toHaveLength(0);
  });

  it("with no key and no connector it stays inline, so the existing fail-fast no-key message still applies", async () => {
    hasConnectorMock.mockResolvedValue(false);
    const d = db({ source_chunks: [chunk(1)] });
    expect(await planAgentStage(d.client, job("extracting_lessons"))).toEqual({ kind: "inline" });
    expect(enqueued(d)).toHaveLength(0);
  });
});

describe("planAgentStage — extracting_lessons with an agent", () => {
  it("queues one step per chunk (the chunk's own text as the input) and parks", async () => {
    const d = db({ source_chunks: [chunk(1), chunk(2), chunk(3)] });
    const plan = await planAgentStage(d.client, job("extracting_lessons"));
    expect(plan.kind).toBe("park");
    const call = enqueued(d)[0]!;
    expect(call.args).toMatchObject({ p_user_id: USER, p_book_id: BOOK, p_stage: "extracting_lessons" });
    const units = call.args.p_units as { unit_id: string; input: { text: string; source_chunk_id: string } }[];
    expect(units.map((u) => u.unit_id)).toEqual(["chunk-1", "chunk-2", "chunk-3"]);
    expect(units[0]!.input.text).toBe("Passage 1 text.");
    expect(units[0]!.input.source_chunk_id).toBe("chunk-1");
  });

  it("queues only a window ahead (never the whole book at once)", async () => {
    const d = db({ source_chunks: Array.from({ length: 50 }, (_, i) => chunk(i + 1)) });
    await planAgentStage(d.client, job("extracting_lessons"));
    expect((enqueued(d)[0]!.args.p_units as unknown[]).length).toBe(BOOK_STAGE_WINDOW);
  });

  it("does not queue a step twice: units that already have a live step are skipped, only the missing ones are added, and it parks", async () => {
    const d = db({
      source_chunks: [chunk(1), chunk(2), chunk(3)],
      agent_jobs: [stepJob("extracting_lessons", "chunk-1", "pending"), stepJob("extracting_lessons", "chunk-2", "claimed")],
    });
    const plan = await planAgentStage(d.client, job("extracting_lessons"));
    expect(plan.kind).toBe("park");
    expect((enqueued(d)[0]!.args.p_units as { unit_id: string }[]).map((u) => u.unit_id)).toEqual(["chunk-3"]);
  });

  it("the window slides as steps finish: with 25 chunks and the first 20 done, the next 5 are queued", async () => {
    const d = db({
      source_chunks: Array.from({ length: 25 }, (_, i) => chunk(i + 1)),
      agent_jobs: Array.from({ length: 20 }, (_, i) => stepJob("extracting_lessons", `chunk-${i + 1}`, "done")),
    });
    const plan = await planAgentStage(d.client, job("extracting_lessons"));
    expect(plan.kind).toBe("park");
    expect((enqueued(d)[0]!.args.p_units as { unit_id: string }[]).map((u) => u.unit_id)).toEqual(["chunk-21", "chunk-22", "chunk-23", "chunk-24", "chunk-25"]);
  });

  it("an out-of-order finish does not advance: chunk 3 done but chunk 1 still pending keeps waiting", async () => {
    const d = db({
      source_chunks: [chunk(1), chunk(2), chunk(3)],
      agent_jobs: [stepJob("extracting_lessons", "chunk-1", "pending"), stepJob("extracting_lessons", "chunk-2", "pending"), stepJob("extracting_lessons", "chunk-3", "done")],
    });
    expect((await planAgentStage(d.client, job("extracting_lessons"))).kind).toBe("park");
    expect(enqueued(d)).toHaveLength(0);
  });

  it("THE LAST-JOB ADVANCE: when every chunk's step is done the stage is over and the cursor moves to merging, as the inline stage does", async () => {
    const d = db({
      source_chunks: [chunk(1), chunk(2)],
      agent_jobs: [stepJob("extracting_lessons", "chunk-1", "done"), stepJob("extracting_lessons", "chunk-2", "done")],
    });
    expect(await planAgentStage(d.client, job("extracting_lessons"))).toEqual({ kind: "advance", nextStage: "merging", nextChunkIndex: null });
  });
});

describe("planAgentStage — lesson stages", () => {
  it("verifying_grounding walks the RANKED lessons only (a rejected, unranked lesson is not a step) and advances to generating_cards when all are done", async () => {
    const d = db({
      lessons: [lesson(1), lesson(2), lesson(3, { rank: null, status: "rejected" })],
      agent_jobs: [stepJob("verifying_grounding", "lesson-1", "done"), stepJob("verifying_grounding", "lesson-2", "done")],
    });
    expect(await planAgentStage(d.client, job("verifying_grounding"))).toEqual({ kind: "advance", nextStage: "generating_cards", nextChunkIndex: null });
  });

  it("generating_cards queues the lesson's own fields, and advances to finalizing at the end", async () => {
    const d = db({ lessons: [lesson(1)] });
    expect((await planAgentStage(d.client, job("generating_cards"))).kind).toBe("park");
    const unit = (enqueued(d)[0]!.args.p_units as { unit_id: string; input: { lesson: { title: string; core_claim: string } } }[])[0]!;
    expect(unit.input.lesson).toMatchObject({ title: "T1", core_claim: "C1" });
    const done = db({ lessons: [lesson(1)], agent_jobs: [stepJob("generating_cards", "lesson-1", "done")] });
    expect(await planAgentStage(done.client, job("generating_cards"))).toEqual({ kind: "advance", nextStage: "finalizing", nextChunkIndex: null });
  });

  it("a stage with no units at all (no lessons survived) advances immediately, like the inline stage", async () => {
    expect(await planAgentStage(db({}).client, job("verifying_grounding"))).toEqual({ kind: "advance", nextStage: "generating_cards", nextChunkIndex: null });
  });
});

describe("planAgentStage — when the agent cannot finish", () => {
  it.each([
    ["failed", { error: "The passage is garbled." }, /garbled/],
    ["cancelled", {}, /cancelled/i],
    ["expired", {}, /didn't finish|in time/i],
  ])("a %s step fails the book with a retryable message, never an endless wait", async (status, extra, message) => {
    const d = db({ source_chunks: [chunk(1), chunk(2)], agent_jobs: [stepJob("extracting_lessons", "chunk-1", status, extra)] });
    const plan = await planAgentStage(d.client, job("extracting_lessons"));
    expect(plan.kind).toBe("fail");
    if (plan.kind === "fail") {
      expect(plan.bookMessage).toMatch(message);
      expect(plan.bookMessage).toMatch(/Try again/);
    }
  });

  it("a unit that has a later live step is not failed by an older dead one (a retry re-queued it)", async () => {
    const d = db({
      source_chunks: [chunk(1)],
      agent_jobs: [stepJob("extracting_lessons", "chunk-1", "expired"), stepJob("extracting_lessons", "chunk-1", "pending")],
    });
    expect((await planAgentStage(d.client, job("extracting_lessons"))).kind).toBe("park");
  });
});
