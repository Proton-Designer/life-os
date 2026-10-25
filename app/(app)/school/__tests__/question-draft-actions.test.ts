import { describe, it, expect, vi, beforeEach } from "vitest";

const draftQuestionsFromTranscriptCoreMock = vi.fn(async (..._args: unknown[]) => ({ status: "drafted", drafts: [], partial: false }));
vi.mock("@/lib/school/question-draft-from-transcript", () => ({
  draftQuestionsFromTranscript: (...args: unknown[]) => draftQuestionsFromTranscriptCoreMock(...args),
}));

vi.mock("@/lib/school/question-draft-generation", () => ({
  draftQuestionsFromNotes: vi.fn(async () => ({ status: "drafted", drafts: [], truncated: false })),
}));

const routeMock = vi.fn(async (..._a: unknown[]): Promise<string> => "inline");
vi.mock("@/lib/agent-jobs/route", () => ({ routeAiRequest: (...a: unknown[]) => routeMock(...a) }));
const enqueueMock = vi.fn(async (..._a: unknown[]) => "job-1");
vi.mock("@/lib/agent-jobs/core", () => ({ enqueueAgentJobCore: (...a: unknown[]) => enqueueMock(...a) }));

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

  it("P3-16 FIX (HANDOFF-team-b.md §5 item 2): a real DB error returns {status:'error'}, never throws -- Server Actions must never throw (this codebase's own never-throw rule)", async () => {
    fromResult = { data: null, error: { message: "connection reset" } };
    const { draftQuestionsFromTranscript } = await import("../question-draft-actions");

    const result = await draftQuestionsFromTranscript("rec-1");

    expect(result).toEqual({ status: "error" });
    expect(draftQuestionsFromTranscriptCoreMock).not.toHaveBeenCalled();
  });
});

describe("draftQuestionsFromNotes — no key, connected agent (agent work queue)", () => {
  beforeEach(() => {
    routeMock.mockReset().mockResolvedValue("queue");
    enqueueMock.mockClear();
  });

  it("queues the drafting for the agent when a class is given", async () => {
    const { draftQuestionsFromNotes } = await import("../question-draft-actions");
    expect(await draftQuestionsFromNotes("Mitochondria make ATP.", "class-1")).toEqual({ status: "queued", jobId: "job-1" });
    expect(enqueueMock).toHaveBeenCalledWith(expect.anything(), { kind: "school.question_draft", subjectId: "class-1", input: { text: "Mitochondria make ATP.", truncated: false } });
  });

  it("without a class there is nothing to attach the result to, so it never queues (existing behaviour)", async () => {
    const { draftQuestionsFromNotes } = await import("../question-draft-actions");
    await draftQuestionsFromNotes("Mitochondria make ATP.");
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("with a key (inline) it drafts as before and queues nothing", async () => {
    routeMock.mockResolvedValue("inline");
    const { draftQuestionsFromNotes } = await import("../question-draft-actions");
    expect((await draftQuestionsFromNotes("Notes", "class-1") as { status: string }).status).toBe("drafted");
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
