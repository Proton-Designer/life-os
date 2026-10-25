import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/gateway", () => ({ gatewayChat: vi.fn() }));
vi.mock("../stage-for-job", () => ({ stageItemsForJob: vi.fn(async () => "batch-1") }));

const core = await import("../core");
const { AGENT_JOB_KIND_DEFS, AGENT_JOB_KINDS } = await import("../kinds");
const { ToolInputError } = await import("@/lib/mcp/tool-input-error");

const CARD = "11111111-1111-4111-8111-111111111111";
const LESSON = "44444444-4444-4444-8444-444444444444";
const JOB = "22222222-2222-4222-8222-222222222222";

function fake(rpcs: Record<string, unknown>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: rpcs[fn] ?? null, error: null };
    }),
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("the feedback kinds exist", () => {
  it("answer_feedback and teach_back_grade are registered kinds with a subject type", () => {
    expect(AGENT_JOB_KINDS).toEqual(expect.arrayContaining(["self_mastery.answer_feedback", "self_mastery.teach_back_grade"]));
    expect(AGENT_JOB_KIND_DEFS["self_mastery.answer_feedback"].subjectType).toBe("card");
    expect(AGENT_JOB_KIND_DEFS["self_mastery.teach_back_grade"].subjectType).toBe("lesson");
  });
});

describe("answer feedback — submit", () => {
  const begin = { id: JOB, kind: "self_mastery.answer_feedback", subject_type: "card", subject_id: CARD, input: { prompt: "What is X?", answer: "Y", attempt: "Z" } };

  it("a valid result becomes a note built from the JOB (the agent supplies only feedback and rating), then the job completes", async () => {
    const { client, calls } = fake({ begin_agent_job_submit: begin, apply_agent_feedback_note: 1, complete_agent_job: 1 });
    await core.submitAgentJobCore(client, "u1", { id: JOB, result: { feedback: "You had the idea but missed Y.", suggestedRating: 2 }, tokenId: "tok" });
    expect(calls.map((c) => c.fn)).toEqual(["begin_agent_job_submit", "apply_agent_feedback_note", "complete_agent_job"]);
    expect(calls[1]!.args).toEqual({ p_job_id: JOB, p_feedback: "You had the idea but missed Y.", p_rating: 2, p_follow_ups: null });
  });

  it("the agent cannot name a card, a lesson or a user: extra fields are ignored and never reach the database", async () => {
    const { client, calls } = fake({ begin_agent_job_submit: begin, apply_agent_feedback_note: 1, complete_agent_job: 1 });
    await core.submitAgentJobCore(client, "u1", { id: JOB, result: { feedback: "ok", suggestedRating: null, card_id: "other", user_id: "other" }, tokenId: "tok" });
    expect(Object.keys(calls[1]!.args).sort()).toEqual(["p_feedback", "p_follow_ups", "p_job_id", "p_rating"]);
  });

  it.each([
    [{ feedback: "", suggestedRating: 3 }, /feedback/],
    [{ feedback: "x".repeat(601), suggestedRating: 3 }, /feedback/],
    [{ feedback: "ok", suggestedRating: 7 }, /suggestedRating/],
    [{ feedback: "ok", suggestedRating: "good" }, /suggestedRating/],
    ["not json", /JSON/],
    [[], /result|expected/i],
  ])("a schema-invalid result %j is rejected with the reason and nothing is written", async (result, reason) => {
    const { client, calls } = fake({ begin_agent_job_submit: begin, reject_agent_job_submit: 1 });
    await expect(core.submitAgentJobCore(client, "u1", { id: JOB, result, tokenId: "tok" })).rejects.toThrow(reason);
    expect(calls.map((c) => c.fn)).toEqual(["begin_agent_job_submit", "reject_agent_job_submit"]);
  });

  it("a rating is a suggestion only: it may be null, and nothing here touches reviews", async () => {
    const { client, calls } = fake({ begin_agent_job_submit: begin, apply_agent_feedback_note: 1, complete_agent_job: 1 });
    await core.submitAgentJobCore(client, "u1", { id: JOB, result: { feedback: "Good recall.", suggestedRating: null }, tokenId: "tok" });
    expect(calls.map((c) => c.fn).some((f) => /review|grade|card_state/.test(f))).toBe(false);
  });

  it("another user's job (begin returns null) is not found; the note function is never called", async () => {
    const { client, calls } = fake({ begin_agent_job_submit: null });
    await expect(core.submitAgentJobCore(client, "u1", { id: JOB, result: { feedback: "x", suggestedRating: 1 }, tokenId: "tok" })).rejects.toThrow(/No claimed job/);
    expect(calls.map((c) => c.fn)).toEqual(["begin_agent_job_submit"]);
  });

  it("if the database says there was no applying feedback job (0), the submit is handed back, not completed", async () => {
    const { client, calls } = fake({ begin_agent_job_submit: begin, apply_agent_feedback_note: 0, reject_agent_job_submit: 1 });
    await expect(core.submitAgentJobCore(client, "u1", { id: JOB, result: { feedback: "x", suggestedRating: 1 }, tokenId: "tok" })).rejects.toThrow(ToolInputError);
    expect(calls.map((c) => c.fn)).not.toContain("complete_agent_job");
  });
});

describe("teach-back grade — submit", () => {
  const begin = { id: JOB, kind: "self_mastery.teach_back_grade", subject_type: "lesson", subject_id: LESSON, input: { lesson: { title: "T" }, explanation: "my explanation" } };

  it("valid: feedback plus 1 to 3 follow-up questions", async () => {
    const { client, calls } = fake({ begin_agent_job_submit: begin, apply_agent_feedback_note: 1, complete_agent_job: 1 });
    await core.submitAgentJobCore(client, "u1", { id: JOB, result: { gapFeedback: "You missed the mechanism.", followUpQuestions: ["What causes it?", "When does it fail?"] }, tokenId: "tok" });
    expect(calls[1]!.args).toEqual({ p_job_id: JOB, p_feedback: "You missed the mechanism.", p_rating: null, p_follow_ups: ["What causes it?", "When does it fail?"] });
  });

  it.each([
    [{ gapFeedback: "ok", followUpQuestions: [] }, /followUpQuestions/],
    [{ gapFeedback: "ok", followUpQuestions: ["a", "b", "c", "d"] }, /followUpQuestions/],
    [{ gapFeedback: "", followUpQuestions: ["a"] }, /gapFeedback/],
    [{ followUpQuestions: ["a"] }, /gapFeedback/],
  ])("schema-invalid %j is rejected", async (result, reason) => {
    const { client } = fake({ begin_agent_job_submit: begin, reject_agent_job_submit: 1 });
    await expect(core.submitAgentJobCore(client, "u1", { id: JOB, result, tokenId: "tok" })).rejects.toThrow(reason);
  });
});

describe("enqueue — subjects and sizes", () => {
  it("sends the kind's own subject type, and bounds the person's text by the kind's field", async () => {
    const { client, calls } = fake({ enqueue_agent_job: JOB });
    await core.enqueueAgentJobCore(client, { kind: "self_mastery.answer_feedback", subjectId: CARD, input: { prompt: "Q", answer: "A", attempt: "my attempt" } });
    expect(calls[0]!.args).toMatchObject({ p_kind: "self_mastery.answer_feedback", p_subject_type: "card", p_subject_id: CARD, p_input_chars: 10 });
    await expect(core.enqueueAgentJobCore(client, { kind: "self_mastery.teach_back_grade", subjectId: LESSON, input: { lesson: {}, explanation: "x".repeat(4001) } })).rejects.toThrow(/4000/);
  });
});

describe("migration 280", () => {
  const sql = readFileSync("supabase/migrations/280_agent_feedback_and_idempotent_apply.sql", "utf8");
  it("makes the apply idempotent per job (unique batch per user+job) and keeps the 128 KB input bound", () => {
    expect(sql).toMatch(/staging_batches_user_agent_job_key[\s\S]*\(user_id, agent_job_id\)/);
    expect(sql).toMatch(/131072/);
  });
  it("builds the note from the job row, as the caller, with no user id and no card/lesson parameter", () => {
    const fn = sql.slice(sql.indexOf("function public.apply_agent_feedback_note"), sql.indexOf("function public.mark_feedback_note_seen"));
    expect(fn).toContain("auth.uid()");
    expect(fn).not.toMatch(/p_user_id|p_card_id|p_lesson_id/);
    expect(fn).toMatch(/status = 'applying'/);
    expect(fn).toMatch(/on conflict \(user_id, agent_job_id\)/);
  });
  it("notes are tenancy-tied to the same user's card / lesson and RLS select-own", () => {
    expect(sql).toMatch(/foreign key \(user_id, card_id\) references public\.cards \(user_id, id\)/);
    expect(sql).toMatch(/foreign key \(user_id, lesson_id\) references public\.lessons \(user_id, id\)/);
    expect(sql).toMatch(/ai_feedback_notes_select_own/);
  });
  it("the new kinds are in the kind CHECK; card and lesson are subject types", () => {
    expect(sql).toContain("'self_mastery.answer_feedback'");
    expect(sql).toContain("'self_mastery.teach_back_grade'");
    expect(sql).toMatch(/subject_type is null or subject_type in \('class', 'card', 'lesson'\)/);
  });
});
