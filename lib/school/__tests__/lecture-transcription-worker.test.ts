import { beforeEach, describe, expect, it, vi } from "vitest";
import { processOneTranscriptionJob } from "../lecture-transcription-worker";

const resolveStoredUserKeyMock = vi.fn(async (_client: unknown, _userId: unknown, _provider: string) => null as string | null);
vi.mock("@/lib/ai/resolve-key", () => ({
  resolveStoredUserKey: (...args: [unknown, unknown, string]) => resolveStoredUserKeyMock(...args),
}));

type SpendCapResult =
  | { allowed: true; capUsd: number; spentUsd: number; estimatedCostUsd: number }
  | { allowed: false; reason: string; capUsd: number; spentUsd: number; estimatedCostUsd: number; contextFailure?: false }
  | { allowed: false; reason: string; contextFailure: true };
const checkTranscriptionSpendCapMock = vi.fn(
  async (..._args: unknown[]): Promise<SpendCapResult> => ({ allowed: true, capUsd: 10, spentUsd: 0, estimatedCostUsd: 0.01 }),
);
vi.mock("@/lib/ai/transcription-spend", () => ({
  checkTranscriptionSpendCap: (...args: unknown[]) => checkTranscriptionSpendCapMock(...args),
}));

const transcribeWithOpenAIMock = vi.fn(async (..._args: unknown[]) => ({ ok: true as const, data: { text: "openai transcript", durationSeconds: 120 } }));
const transcribeWithGeminiMock = vi.fn(async (..._args: unknown[]) => ({ ok: true as const, data: { text: "gemini transcript", durationSeconds: null } }));
vi.mock("@/lib/ai/transcription", () => ({
  transcribeWithOpenAI: (...args: unknown[]) => transcribeWithOpenAIMock(...args),
  transcribeWithGemini: (...args: unknown[]) => transcribeWithGeminiMock(...args),
  OPENAI_MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024,
}));

const recordUsageMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/ai/usage-log", () => ({
  recordUsage: (...args: unknown[]) => recordUsageMock(...args),
}));

const CLAIMED_JOB = { id: "job-1", recording_id: "rec-1", claimed_at: "2026-09-15T00:00:00Z" };

function audioBlob() {
  return new Blob(["fake-audio-bytes"], { type: "audio/mpeg" });
}

type FakeResult = { data: unknown; error: unknown };

function makeChain(result: FakeResult) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "update", "eq", "maybeSingle", "select"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: FakeResult) => void) => resolve(result);
  return chain;
}

function makeServiceClient(opts: {
  claimResult?: FakeResult;
  recordingResult?: FakeResult;
  updateResult?: FakeResult;
  downloadResult?: { data: Blob | null; error: unknown };
}) {
  const rpcMock = vi.fn(async () => opts.claimResult ?? { data: CLAIMED_JOB, error: null });
  const fromMock = vi.fn((table: string) => {
    if (table === "lecture_recordings") return makeChain(opts.recordingResult ?? { data: null, error: null });
    if (table === "lecture_transcripts") return makeChain(opts.updateResult ?? { data: [{ id: "row-1" }], error: null });
    throw new Error(`unexpected table in test: ${table}`);
  });
  const downloadMock = vi.fn(async () => opts.downloadResult ?? { data: audioBlob(), error: null });
  return {
    client: { rpc: rpcMock, from: fromMock, storage: { from: () => ({ download: downloadMock }) } } as never,
    rpcMock,
    fromMock,
    downloadMock,
  };
}

const RECORDING_OPENAI_SIZED = { data: { user_id: "user-1", storage_path: "user-1/class-1/123-lec.mp3", size_bytes: 1024 }, error: null };

describe("processOneTranscriptionJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveStoredUserKeyMock.mockResolvedValue(null);
    checkTranscriptionSpendCapMock.mockResolvedValue({ allowed: true, capUsd: 10, spentUsd: 0, estimatedCostUsd: 0.01 });
    transcribeWithOpenAIMock.mockResolvedValue({ ok: true, data: { text: "openai transcript", durationSeconds: 120 } });
    transcribeWithGeminiMock.mockResolvedValue({ ok: true, data: { text: "gemini transcript", durationSeconds: null } });
  });

  it("returns {processed:false} and touches nothing else when nothing is claimable", async () => {
    const { client, fromMock } = makeServiceClient({ claimResult: { data: null, error: null } });
    const result = await processOneTranscriptionJob(client);
    expect(result).toEqual({ processed: false });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("fails cleanly when the recording no longer exists", async () => {
    const { client } = makeServiceClient({ recordingResult: { data: null, error: null } });
    const result = await processOneTranscriptionJob(client);
    expect(result).toEqual({ processed: true, status: "failed", recordingId: "rec-1", reason: expect.stringContaining("no longer exists") });
  });

  it("fails with a clear message when the user has neither an OpenAI nor a Gemini key", async () => {
    resolveStoredUserKeyMock.mockResolvedValue(null);
    const { client } = makeServiceClient({ recordingResult: RECORDING_OPENAI_SIZED });
    const result = await processOneTranscriptionJob(client);
    expect(result).toMatchObject({ status: "failed", reason: expect.stringContaining("needs an OpenAI or Gemini key".replace("n", "N")) });
    expect(transcribeWithOpenAIMock).not.toHaveBeenCalled();
    expect(transcribeWithGeminiMock).not.toHaveBeenCalled();
  });

  it("fails when the spend cap blocks the call, before any download or provider call", async () => {
    resolveStoredUserKeyMock.mockImplementation(async (_c: unknown, _u: unknown, provider: string) => (provider === "openai" ? "sk-openai" : null));
    checkTranscriptionSpendCapMock.mockResolvedValue({ allowed: false, reason: "Over budget this month.", capUsd: 1, spentUsd: 1, estimatedCostUsd: 0.5 });
    const { client, downloadMock } = makeServiceClient({ recordingResult: RECORDING_OPENAI_SIZED });

    const result = await processOneTranscriptionJob(client);

    expect(result).toMatchObject({ status: "failed", reason: "Over budget this month." });
    expect(downloadMock).not.toHaveBeenCalled();
    expect(transcribeWithOpenAIMock).not.toHaveBeenCalled();
  });

  it("fails cleanly when the audio download fails", async () => {
    resolveStoredUserKeyMock.mockImplementation(async (_c: unknown, _u: unknown, provider: string) => (provider === "openai" ? "sk-openai" : null));
    const { client } = makeServiceClient({ recordingResult: RECORDING_OPENAI_SIZED, downloadResult: { data: null, error: { message: "not found" } } });

    const result = await processOneTranscriptionJob(client);

    expect(result).toMatchObject({ status: "failed", reason: expect.stringContaining("read the audio file") });
    expect(transcribeWithOpenAIMock).not.toHaveBeenCalled();
  });

  // tracking-app-a9 review, point 2: a THROWN error from the provider call
  // (not a returned {ok:false}) must still become a clean fail(), not an
  // uncaught rejection out of processOneTranscriptionJob.
  it("converts a thrown provider error into a clean fail(), not an unhandled rejection", async () => {
    resolveStoredUserKeyMock.mockImplementation(async (_c: unknown, _u: unknown, provider: string) => (provider === "openai" ? "sk-openai" : null));
    transcribeWithOpenAIMock.mockRejectedValueOnce(new Error("unexpected network throw"));
    const { client } = makeServiceClient({ recordingResult: RECORDING_OPENAI_SIZED });

    const result = await processOneTranscriptionJob(client);

    expect(result).toEqual({ processed: true, status: "failed", recordingId: "rec-1", reason: "unexpected network throw" });
  });

  it("still throws (does not swallow) a DB error reading the recording -- only the provider-call section is wrapped", async () => {
    const { client } = makeServiceClient({ recordingResult: { data: null, error: { message: "connection reset" } } });
    await expect(processOneTranscriptionJob(client)).rejects.toEqual({ message: "connection reset" });
  });

  it("completes successfully via OpenAI and records usage with the real reported duration", async () => {
    resolveStoredUserKeyMock.mockImplementation(async (_c: unknown, _u: unknown, provider: string) => (provider === "openai" ? "sk-openai" : null));
    const { client } = makeServiceClient({ recordingResult: RECORDING_OPENAI_SIZED });

    const result = await processOneTranscriptionJob(client);

    expect(result).toEqual({ processed: true, status: "completed", recordingId: "rec-1" });
    expect(recordUsageMock).toHaveBeenCalledTimes(1);
    expect(recordUsageMock.mock.calls[0]![0]).toMatchObject({ provider: "openai", keySource: "user", succeeded: true });
  });

  // tracking-app-a9 review, point 1: Gemini's own generateContent timeout is
  // derived from the REMAINING function-time budget, not a flat constant.
  it("computes Gemini's timeout from the remaining function-time budget (280s minus elapsed minus a 30s safety buffer)", async () => {
    resolveStoredUserKeyMock.mockImplementation(async (_c: unknown, _u: unknown, provider: string) => (provider === "google" ? "gk-google" : null));
    const dateNowSpy = vi.spyOn(Date, "now");
    dateNowSpy.mockReturnValueOnce(1_000_000); // startedAt
    dateNowSpy.mockReturnValueOnce(1_050_000); // 50s elapsed by the time the budget is computed
    const { client } = makeServiceClient({ recordingResult: RECORDING_OPENAI_SIZED });

    await processOneTranscriptionJob(client);

    expect(transcribeWithGeminiMock).toHaveBeenCalledTimes(1);
    // 280_000 - 50_000 elapsed - 30_000 safety buffer = 200_000
    expect(transcribeWithGeminiMock.mock.calls[0]![3]).toBe(200_000);
    dateNowSpy.mockRestore();
  });

  it("fails immediately, without ever calling transcribeWithGemini, when too little time is left in the run", async () => {
    resolveStoredUserKeyMock.mockImplementation(async (_c: unknown, _u: unknown, provider: string) => (provider === "google" ? "gk-google" : null));
    const dateNowSpy = vi.spyOn(Date, "now");
    dateNowSpy.mockReturnValueOnce(1_000_000); // startedAt
    dateNowSpy.mockReturnValueOnce(1_255_000); // 255s elapsed -- only 25s of nominal budget left, under the 30s buffer alone
    const { client } = makeServiceClient({ recordingResult: RECORDING_OPENAI_SIZED });

    const result = await processOneTranscriptionJob(client);

    expect(result).toMatchObject({ status: "failed", reason: expect.stringContaining("Not enough time left") });
    expect(transcribeWithGeminiMock).not.toHaveBeenCalled();
    dateNowSpy.mockRestore();
  });
});
