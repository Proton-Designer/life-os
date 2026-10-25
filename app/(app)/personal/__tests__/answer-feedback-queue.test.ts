import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

function cardClient(card: { prompt: string; answer: string } | null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: card, error: null }));
  return { from: vi.fn(() => chain) } as unknown as SupabaseClient;
}
let client = cardClient({ prompt: "What is X?", answer: "Y" });
vi.mock("@/lib/supabase/auth", () => ({ requireUser: async () => ({ supabase: client, userId: "user-1" }) }));
const gatewayMock = vi.fn();
vi.mock("@/lib/ai/gateway", () => ({ gatewayChat: (...a: unknown[]) => gatewayMock(...a) }));
const routeMock = vi.fn(async (..._a: unknown[]): Promise<string> => "queue");
vi.mock("@/lib/agent-jobs/route", () => ({ routeAiRequest: (...a: unknown[]) => routeMock(...a) }));
const enqueueMock = vi.fn(async (..._a: unknown[]) => "job-1");
vi.mock("@/lib/agent-jobs/core", () => ({ enqueueAgentJobCore: (...a: unknown[]) => enqueueMock(...a) }));
const stateMock = vi.fn();
vi.mock("@/lib/self-mastery/feedback-notes", () => ({
  getFeedbackState: (...a: unknown[]) => stateMock(...a),
  markFeedbackNotesSeen: vi.fn(async () => {}),
}));

const { getAnswerFeedback, getCardFeedbackState } = await import("../answer-feedback-actions");
const CARD = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  client = cardClient({ prompt: "What is X?", answer: "Y" });
  routeMock.mockReset().mockResolvedValue("queue");
  enqueueMock.mockClear();
  gatewayMock.mockReset();
});

describe("getAnswerFeedback — no key, connected agent (feedback later)", () => {
  it("saves the attempt as a job on the card, with the question and the correct answer for the agent, and never calls the model", async () => {
    expect(await getAnswerFeedback(CARD, "  my attempt ")).toEqual({ queued: true });
    expect(enqueueMock).toHaveBeenCalledWith(expect.anything(), {
      kind: "self_mastery.answer_feedback",
      subjectId: CARD,
      input: { prompt: "What is X?", answer: "Y", attempt: "my attempt" },
    });
    expect(gatewayMock).not.toHaveBeenCalled();
  });

  it("a blank attempt is nothing to compare: no job, no model call", async () => {
    expect(await getAnswerFeedback(CARD, "   ")).toBeNull();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("a card that is not the caller's (RLS returns no row) queues nothing", async () => {
    client = cardClient(null);
    expect(await getAnswerFeedback(CARD, "attempt")).toBeNull();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("a full queue is the normal 'no feedback' answer (null), never an error that could gate the session", async () => {
    enqueueMock.mockRejectedValueOnce(new Error("too many jobs"));
    expect(await getAnswerFeedback(CARD, "attempt")).toBeNull();
  });

  it("with a key the answer comes from the model exactly as before and nothing is queued", async () => {
    routeMock.mockResolvedValue("inline");
    gatewayMock.mockResolvedValue({ ok: true, content: "You got it.\nRATING: 4" });
    expect(await getAnswerFeedback(CARD, "attempt")).toEqual({ feedback: "You got it.", suggestedRating: 4 });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("the attempt is capped so a queued job stays small", async () => {
    await getAnswerFeedback(CARD, "a".repeat(5000));
    expect((enqueueMock.mock.calls[0]![1] as { input: { attempt: string } }).input.attempt).toHaveLength(2000);
  });
});

describe("getCardFeedbackState", () => {
  it("asks for the caller's notes on that card only", async () => {
    stateMock.mockResolvedValue({ notes: [], pending: true });
    expect(await getCardFeedbackState(CARD)).toEqual({ notes: [], pending: true });
    expect(stateMock).toHaveBeenCalledWith(expect.anything(), "user-1", { subjectType: "card", subjectId: CARD });
  });
});
