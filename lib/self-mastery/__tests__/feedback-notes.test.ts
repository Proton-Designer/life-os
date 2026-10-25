import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
const { getFeedbackState, markFeedbackNotesSeen } = await import("../feedback-notes");

type Q = { table: string; eq: Record<string, unknown>; in?: [string, unknown[]]; is?: [string, unknown] };

function fake(tables: Record<string, unknown[]>) {
  const queries: Q[] = [];
  const rpcs: { fn: string; args: unknown }[] = [];
  const client = {
    from: (table: string) => {
      const q: Q = { table, eq: {} };
      queries.push(q);
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn((c: string, v: unknown) => ((q.eq[c] = v), chain));
      chain.in = vi.fn((c: string, v: unknown[]) => ((q.in = [c, v]), chain));
      chain.is = vi.fn((c: string, v: unknown) => ((q.is = [c, v]), chain));
      chain.order = vi.fn(() => chain);
      chain.limit = vi.fn(async () => ({ data: tables[table] ?? [], error: null }));
      return chain;
    },
    rpc: vi.fn(async (fn: string, args: unknown) => {
      rpcs.push({ fn, args });
      return { data: 1, error: null };
    }),
  } as unknown as SupabaseClient;
  return { client, queries, rpcs };
}

const note = (over: Record<string, unknown>) => ({ id: "n1", kind: "answer_feedback", attempt_text: "my answer", feedback_text: "You missed Y.", suggested_rating: 2, follow_up_questions: null, provider: "mcp", model: "Claude", seen_at: null, created_at: "2026-10-25T14:00:00Z", ...over });

describe("getFeedbackState", () => {
  it("reads the caller's notes for ONE card, plus whether an agent is still working on one, scoped by user and subject", async () => {
    const { client, queries } = fake({
      ai_feedback_notes: [note({})],
      agent_jobs: [{ id: "j1", status: "pending", created_at: "2026-10-25T15:00:00Z" }],
    });
    const state = await getFeedbackState(client, "u1", { subjectType: "card", subjectId: "card-1" });
    expect(queries.find((q) => q.table === "ai_feedback_notes")!.eq).toMatchObject({ user_id: "u1", card_id: "card-1" });
    expect(queries.find((q) => q.table === "agent_jobs")!.eq).toMatchObject({ user_id: "u1", subject_id: "card-1" });
    expect(state.pending).toBe(true);
    expect(state.notes).toEqual([
      { id: "n1", attempt: "my answer", feedback: "You missed Y.", suggestedRating: 2, followUpQuestions: [], sourceLabel: "Written by Claude via your connector", createdAt: "2026-10-25T14:00:00Z", isNew: true },
    ]);
  });

  it("a lesson's notes carry the follow-up questions; seen notes are not new", async () => {
    const { client, queries } = fake({
      ai_feedback_notes: [note({ kind: "teach_back", follow_up_questions: ["Why?"], suggested_rating: null, seen_at: "2026-10-25T16:00:00Z" })],
      agent_jobs: [],
    });
    const state = await getFeedbackState(client, "u1", { subjectType: "lesson", subjectId: "lesson-1" });
    expect(queries.find((q) => q.table === "ai_feedback_notes")!.eq).toMatchObject({ lesson_id: "lesson-1" });
    expect(state.pending).toBe(false);
    expect(state.notes[0]).toMatchObject({ followUpQuestions: ["Why?"], suggestedRating: null, isNew: false });
  });

  it("is display-only: a read error reads as nothing, never throws", async () => {
    const bad = { from: () => { throw new Error("db down"); } } as unknown as SupabaseClient;
    expect(await getFeedbackState(bad, "u1", { subjectType: "card", subjectId: "c" })).toEqual({ notes: [], pending: false });
  });
});

describe("markFeedbackNotesSeen", () => {
  it("marks each given note seen through the function, ignoring failures (display bookkeeping)", async () => {
    const { client, rpcs } = fake({});
    await markFeedbackNotesSeen(client, ["n1", "n2"]);
    expect(rpcs).toEqual([
      { fn: "mark_feedback_note_seen", args: { p_id: "n1" } },
      { fn: "mark_feedback_note_seen", args: { p_id: "n2" } },
    ]);
  });
});
