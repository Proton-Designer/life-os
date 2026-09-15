import { describe, it, expect, vi, beforeEach } from "vitest";

const draftQuestionsFromTranscriptCoreMock = vi.fn(async (..._args: unknown[]) => ({ status: "drafted", drafts: [], partial: false }));
vi.mock("@/lib/school/question-draft-from-transcript", () => ({
  draftQuestionsFromTranscript: (...args: unknown[]) => draftQuestionsFromTranscriptCoreMock(...args),
}));

vi.mock("@/lib/school/question-draft-generation", () => ({
  draftQuestionsFromNotes: vi.fn(async () => ({ status: "drafted", drafts: [], truncated: false })),
}));

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) => resolve(result);
  return chain;
}

let fromResult: { data: unknown; error: unknown } = { data: null, error: null };
const fromMock = vi.fn((_table: string) => makeChain(fromResult));
const requireUserMock = vi.fn(async () => ({ supabase: { from: fromMock }, userId: "user-1" }));
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: () => requireUserMock(),
}));

describe("draftQuestionsFromTranscript (question-draft-actions.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromResult = { data: null, error: null };
  });

  it("returns not_ready without calling the core drafter when no transcript row exists yet", async () => {
    fromResult = { data: null, error: null };
    const { draftQuestionsFromTranscript } = await import("../question-draft-actions");

    const result = await draftQuestionsFromTranscript("rec-1");

    expect(result).toEqual({ status: "not_ready" });
    expect(draftQuestionsFromTranscriptCoreMock).not.toHaveBeenCalled();
  });

  it("returns not_ready when the transcript exists but isn't completed yet", async () => {
    fromResult = { data: { status: "processing", transcript_text: null }, error: null };
    const { draftQuestionsFromTranscript } = await import("../question-draft-actions");

    const result = await draftQuestionsFromTranscript("rec-1");

    expect(result).toEqual({ status: "not_ready" });
    expect(draftQuestionsFromTranscriptCoreMock).not.toHaveBeenCalled();
  });

  it("scopes the transcript lookup to this user (eq user_id) -- never trusts recordingId alone", async () => {
    fromResult = { data: { status: "completed", transcript_text: "the lecture, verbatim" }, error: null };
    const { draftQuestionsFromTranscript } = await import("../question-draft-actions");

    await draftQuestionsFromTranscript("rec-1");

    expect(fromMock).toHaveBeenCalledWith("lecture_transcripts");
  });

  it("passes the real transcript text to the core drafter for a completed transcript", async () => {
    fromResult = { data: { status: "completed", transcript_text: "the lecture, verbatim" }, error: null };
    const { draftQuestionsFromTranscript } = await import("../question-draft-actions");

    await draftQuestionsFromTranscript("rec-1");

    expect(draftQuestionsFromTranscriptCoreMock).toHaveBeenCalledWith(expect.anything(), "user-1", "the lecture, verbatim");
  });

  it("throws on a real DB error rather than silently returning not_ready", async () => {
    fromResult = { data: null, error: { message: "connection reset" } };
    const { draftQuestionsFromTranscript } = await import("../question-draft-actions");

    await expect(draftQuestionsFromTranscript("rec-1")).rejects.toEqual({ message: "connection reset" });
  });
});
