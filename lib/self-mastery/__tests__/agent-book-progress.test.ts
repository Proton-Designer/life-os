import { describe, expect, it, vi } from "vitest";
import { makeFakeDb } from "@/lib/self-mastery/ingestion/__tests__/fake-db";

vi.mock("server-only", () => ({}));
const { getAgentBookProgress } = await import("../agent-book-progress");
const { estimateAgentSteps, AGENT_STEPS_PER_RUN, agentEstimateMessage } = await import("../agent-estimate");

const BOOK = "b1";
const USER = "u1";
const step = (stage: string, unit: string, status: string) => ({ user_id: USER, subject_id: BOOK, kind: "self_mastery.book_stage", dedupe_key: `${BOOK}:${stage}:${unit}`, status });

describe("getAgentBookProgress", () => {
  it("a parked book reports the current stage's steps: done of total", async () => {
    const d = makeFakeDb({
      ingestion_jobs: [{ book_id: BOOK, user_id: USER, stage: "extracting_lessons", waiting_on_agent_since: "2026-10-25T12:00:00Z" }],
      source_chunks: [1, 2, 3, 4, 5].map((n) => ({ id: `c${n}`, book_id: BOOK })),
      agent_jobs: [step("extracting_lessons", "c1", "done"), step("extracting_lessons", "c2", "done"), step("extracting_lessons", "c3", "pending"), step("generating_cards", "x", "done")],
    });
    expect(await getAgentBookProgress(d.client, USER, BOOK)).toEqual({ stage: "extracting_lessons", stageLabel: "Finding lessons", done: 2, total: 5, parked: true });
  });

  it("lesson stages count the ranked lessons as the total", async () => {
    const d = makeFakeDb({
      ingestion_jobs: [{ book_id: BOOK, user_id: USER, stage: "generating_cards", waiting_on_agent_since: "x" }],
      lessons: [{ id: "l1", book_id: BOOK, rank: 0 }, { id: "l2", book_id: BOOK, rank: 1 }, { id: "l3", book_id: BOOK, rank: null }],
      agent_jobs: [step("generating_cards", "l1", "done")],
    });
    expect(await getAgentBookProgress(d.client, USER, BOOK)).toMatchObject({ done: 1, total: 2, stageLabel: "Building your deck" });
  });

  it("a book that is not using an agent (no parked marker, no steps) reports nothing, so no key holder ever sees this", async () => {
    const d = makeFakeDb({ ingestion_jobs: [{ book_id: BOOK, user_id: USER, stage: "extracting_lessons", waiting_on_agent_since: null }], source_chunks: [{ id: "c1", book_id: BOOK }], agent_jobs: [] });
    expect(await getAgentBookProgress(d.client, USER, BOOK)).toBeNull();
  });

  it("is scoped to the caller: another user's steps and jobs are invisible", async () => {
    const d = makeFakeDb({ ingestion_jobs: [{ book_id: BOOK, user_id: "someone-else", stage: "extracting_lessons", waiting_on_agent_since: "x" }], agent_jobs: [] });
    expect(await getAgentBookProgress(d.client, USER, BOOK)).toBeNull();
  });

  it("display-only: an error reads as nothing", async () => {
    const bad = { from: () => { throw new Error("db"); } } as never;
    expect(await getAgentBookProgress(bad, USER, BOOK)).toBeNull();
  });
});

describe("estimateAgentSteps — an honest, rounded estimate before the book is read", () => {
  it("a long text book needs about a chunk per 12,000 characters plus two steps per selected lesson", () => {
    const { steps } = estimateAgentSteps({ bytes: 1_500_000, filename: "book.txt" }); // ~125 chunks, ~60 lessons x 2
    expect(steps).toBeGreaterThan(200);
    expect(steps).toBeLessThan(300);
    expect(steps % 10).toBe(0);
  });
  it("a short book is a handful of steps and fits in one run", () => {
    const e = estimateAgentSteps({ bytes: 60_000, filename: "short.md" });
    expect(e.steps).toBeLessThanOrEqual(30);
    expect(e.runs).toBe(1);
    expect(agentEstimateMessage(e)).toMatch(/one run/);
  });
  it("runs = steps / the steps an agent does per run, rounded up, and the message says both numbers", () => {
    const e = estimateAgentSteps({ bytes: 2_500_000, filename: "big.pdf" });
    expect(e.runs).toBe(Math.ceil(e.steps / AGENT_STEPS_PER_RUN));
    expect(agentEstimateMessage(e)).toContain(`About ${e.steps} steps`);
    expect(agentEstimateMessage(e)).toContain(`about ${AGENT_STEPS_PER_RUN} per run`);
    expect(agentEstimateMessage(e)).toMatch(/over about \d+ runs/);
  });
  it("the lesson count is capped like the pipeline caps it (60), so a huge file does not promise thousands of steps", () => {
    const small = estimateAgentSteps({ bytes: 20_000_000, filename: "x.txt" });
    expect(small.steps).toBeLessThan(2000);
  });
  it("EPUB and PDF sizes map to fewer characters per byte than plain text", () => {
    expect(estimateAgentSteps({ bytes: 1_000_000, filename: "a.pdf" }).steps).not.toBe(estimateAgentSteps({ bytes: 1_000_000, filename: "a.txt" }).steps);
  });
});
