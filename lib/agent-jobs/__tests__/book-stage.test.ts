import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeFakeDb } from "@/lib/self-mastery/ingestion/__tests__/fake-db";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/gateway", () => ({ gatewayChat: vi.fn() }));
vi.mock("../stage-for-job", () => ({ stageItemsForJob: vi.fn() }));

const { applyBookStageResult, bookStageInstructions, bookStageOutputSchema, validateBookStageResult } = await import("../book-stage");
const { ApplyRejected } = await import("../kinds");

const BOOK = "b0000000-0000-4000-8000-000000000001";
const USER = "u0000000-0000-4000-8000-000000000001";
const QUOTE = "Habits are the compound interest of self-improvement.";
const CHUNK_TEXT = `Chapter one. ${QUOTE} Small changes seem to make no difference until you cross a critical threshold.`;

const extractInput = { stage: "extracting_lessons", text: CHUNK_TEXT, location: "page 12", page_start: 12, page_end: 13, source_chunk_id: "chunk-1", paged: true };
const cardsInput = { stage: "generating_cards", text: "t", lesson_id: "lesson-1", lesson: { title: "Compound habits", core_claim: "Tiny gains accumulate into large results over time.", mechanism: "Gains build on earlier gains, so growth is exponential.", action_template: "Improve one thing by 1% today.", provenance_quote: QUOTE } };
const verifyInput = { stage: "verifying_grounding", text: QUOTE, lesson_id: "lesson-1", lesson: { title: "x", core_claim: "Tiny gains accumulate.", mechanism: "m", action_template: "a", provenance_quote: QUOTE } };

const goodExtract = { lessons: [{ title: "Let tiny gains compound", core_claim: "Repeated slight improvements add up to a large payoff much later.", mechanism: "Each gain builds on the previous one, so progress accelerates.", action_template: "Pick one habit and improve it by a little each day.", provenance_quote: QUOTE }] };

function world(extra: Record<string, Record<string, unknown>[]> = {}, stage = "extracting_lessons") {
  const unpark = vi.fn(async () => ({ data: 1, error: null }));
  const user = { rpc: unpark } as unknown as SupabaseClient;
  const db = makeFakeDb({
    books: [{ id: BOOK, user_id: USER }],
    ingestion_jobs: [{ id: "ij-1", book_id: BOOK, stage }],
    source_chunks: [{ id: "chunk-1", book_id: BOOK, section_id: "sec-1" }],
    lessons: [{ id: "lesson-1", book_id: BOOK, status: "archived", rank: 0 }],
    cards: [],
    card_states: [],
    ...extra,
  });
  return { db, user, unpark };
}
const job = (input: Record<string, unknown>) => ({ id: "aj-1", subjectId: BOOK, input });

beforeEach(() => vi.clearAllMocks());

describe("validateBookStageResult — the stage's own parser and gates", () => {
  it("extract: a grounded lesson passes; a quote that is not in the passage is dropped, and when NOTHING passes the agent is told why", () => {
    const ok = validateBookStageResult(extractInput, goodExtract);
    expect(ok.ok).toBe(true);
    const bad = validateBookStageResult(extractInput, { lessons: [{ ...goodExtract.lessons[0]!, provenance_quote: "A sentence that is nowhere in the passage at all." }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/provenance_quote.*verbatim/i);
  });

  it("extract: an empty lessons array is a legitimate answer (no extractable lesson in this passage)", () => {
    expect(validateBookStageResult(extractInput, { lessons: [] })).toMatchObject({ ok: true });
  });

  it("extract: a claim that just copies the quote is rejected (the in-app claim-not-quote gate)", () => {
    const res = validateBookStageResult(extractInput, { lessons: [{ ...goodExtract.lessons[0]!, core_claim: QUOTE }] });
    expect(res.ok).toBe(false);
  });

  it.each([
    [{}, /lessons/],
    [{ lessons: "x" }, /lessons/],
    ["not json", /JSON/],
    [[], /lessons|object/i],
  ])("a schema-invalid extract result %j is rejected with the reason", (result, reason) => {
    const res = validateBookStageResult(extractInput, result);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(reason);
  });

  it("cards: needs the four prompt fields as strings", () => {
    expect(validateBookStageResult(cardsInput, { free_recall_prompt: "a", application_prompt: "b", application_answer: "c", why_prompt: "d" }).ok).toBe(true);
    const bad = validateBookStageResult(cardsInput, { free_recall_prompt: "a" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/application_prompt/);
  });

  it("verify: the verdict must be one of the three", () => {
    expect(validateBookStageResult(verifyInput, { passage_point: "p", verdict: "SUPPORTS", reason: "r" }).ok).toBe(true);
    expect(validateBookStageResult(verifyInput, { verdict: "MAYBE", reason: "r" }).ok).toBe(false);
  });
});

describe("applyBookStageResult", () => {
  it("extract: writes the stage's archived lessons for that chunk (delete-then-insert), then unparks the ingestion job", async () => {
    const { db, user, unpark } = world();
    const out = await applyBookStageResult(db.client, user, USER, job(extractInput), goodExtract);
    expect(out.stored).toMatchObject({ applied: true, stage: "extracting_lessons" });
    const written = db.tables.lessons!.filter((l) => l.source_chunk_id === "chunk-1");
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ book_id: BOOK, status: "archived", section_id: "sec-1", page_ref: 12, extracted_by: "model" });
    expect(unpark).toHaveBeenCalledWith("unpark_ingestion_for_book", { p_book_id: BOOK });
  });

  it("IDEMPOTENT per unit: applying the same job twice leaves exactly one set of rows (the retry after a failed complete)", async () => {
    const { db, user } = world();
    await applyBookStageResult(db.client, user, USER, job(extractInput), goodExtract);
    await applyBookStageResult(db.client, user, USER, job(extractInput), goodExtract);
    expect(db.tables.lessons!.filter((l) => l.source_chunk_id === "chunk-1")).toHaveLength(1);
  });

  it("cards: writes the lesson's cards and a card_states row per card, promotes the lesson, and applying twice does not duplicate", async () => {
    const { db, user } = world({}, "generating_cards");
    const result = { free_recall_prompt: "What is this lesson about?", application_prompt: "You skip a day of practice; what do you do?", application_answer: "Do a tiny version of it today.", why_prompt: "Why does it work?" };
    await applyBookStageResult(db.client, user, USER, job(cardsInput), result);
    expect(db.tables.cards!.length).toBeGreaterThanOrEqual(2);
    expect(db.tables.card_states!.length).toBe(db.tables.cards!.length);
    expect(db.tables.cards!.every((c) => c.lesson_id === "lesson-1")).toBe(true);
    expect(db.tables.lessons![0]!.status).toBe("active");
    const n = db.tables.cards!.length;
    await applyBookStageResult(db.client, user, USER, job(cardsInput), result);
    expect(db.tables.cards!.length).toBe(n);
  });

  it("verify: a non-SUPPORTS verdict rejects the lesson and drops its rank; SUPPORTS leaves it alone", async () => {
    const a = world({}, "verifying_grounding");
    await applyBookStageResult(a.db.client, a.user, USER, job(verifyInput), { passage_point: "p", verdict: "CONTRADICTS", reason: "opposite" });
    expect(a.db.tables.lessons![0]).toMatchObject({ status: "rejected", rank: null });
    const b = world({}, "verifying_grounding");
    await applyBookStageResult(b.db.client, b.user, USER, job(verifyInput), { passage_point: "p", verdict: "SUPPORTS", reason: "ok" });
    expect(b.db.tables.lessons![0]).toMatchObject({ status: "archived", rank: 0 });
  });

  it("a schema-invalid result throws ApplyRejected with the reason and writes nothing (the agent can fix and resubmit)", async () => {
    const { db, user, unpark } = world();
    await expect(applyBookStageResult(db.client, user, USER, job(extractInput), { lessons: "nope" })).rejects.toBeInstanceOf(ApplyRejected);
    expect(db.tables.lessons!.filter((l) => l.source_chunk_id === "chunk-1")).toHaveLength(0);
    expect(unpark).not.toHaveBeenCalled();
  });

  it("STALE: if the pipeline has moved past this stage (a key was added, or the book was retried) the result is accepted but applies nothing", async () => {
    const { db, user } = world({}, "merging");
    const out = await applyBookStageResult(db.client, user, USER, job(extractInput), goodExtract);
    expect(out.stored).toMatchObject({ applied: false, stale: true });
    expect(db.tables.lessons!.filter((l) => l.source_chunk_id === "chunk-1")).toHaveLength(0);
  });

  it("STALE: a unit that no longer exists (the book was re-chunked) applies nothing", async () => {
    const { db, user } = world({ source_chunks: [] });
    const out = await applyBookStageResult(db.client, user, USER, job(extractInput), goodExtract);
    expect(out.stored).toMatchObject({ applied: false, stale: true });
  });

  it("another person's book: the book must belong to the job's owner, else nothing is written", async () => {
    const { db, user } = world({ books: [{ id: BOOK, user_id: "someone-else" }] });
    await expect(applyBookStageResult(db.client, user, USER, job(extractInput), goodExtract)).rejects.toThrow();
    expect(db.tables.lessons!.filter((l) => l.source_chunk_id === "chunk-1")).toHaveLength(0);
  });
});

describe("instructions given to the agent", () => {
  it.each([extractInput, cardsInput, verifyInput])("name the task and the exact output shape for stage %#", (input) => {
    const text = bookStageInstructions(input);
    expect(text.length).toBeGreaterThan(200);
    expect(text).toContain("untrusted_input");
    expect(bookStageOutputSchema(input)).toMatch(/\{/);
  });

  it("the extract instructions carry the same verbatim-quote rule the in-app prompt has, and do NOT contain the passage text itself", () => {
    const text = bookStageInstructions(extractInput);
    expect(text).toMatch(/copied verbatim/);
    expect(text).not.toContain("Small changes seem to make no difference");
  });
});
