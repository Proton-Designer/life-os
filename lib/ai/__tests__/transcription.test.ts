import { describe, it, expect, vi, beforeEach } from "vitest";
import { transcribeWithOpenAI, transcribeWithGemini } from "../transcription";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("transcribeWithOpenAI", () => {
  it("returns the transcript text and real duration from a verbose_json response", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ text: "hello lecture", duration: 12.5 }), { status: 200 }));

    const res = await transcribeWithOpenAI("key", new Uint8Array([1, 2, 3]), "lec.mp3", "audio/mpeg");

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ text: "hello lecture", durationSeconds: 12.5 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://api.openai.com/v1/audio/transcriptions");
  });

  it("treats 401/403 as a clean rejected-key result, not a thrown error", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const res = await transcribeWithOpenAI("bad-key", new Uint8Array([1]), "lec.mp3", "audio/mpeg");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/rejected/i);
  });

  it("surfaces a non-2xx, non-auth HTTP error with the status code", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const res = await transcribeWithOpenAI("key", new Uint8Array([1]), "lec.mp3", "audio/mpeg");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("500");
  });

  it("rejects a response with no recognizable text field instead of returning an empty transcript", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ duration: 5 }), { status: 200 }));
    const res = await transcribeWithOpenAI("key", new Uint8Array([1]), "lec.mp3", "audio/mpeg");
    expect(res.ok).toBe(false);
  });

  it("times out cleanly instead of hanging forever", async () => {
    vi.useFakeTimers();
    try {
      // A real fetch() rejects with AbortError once its signal fires -- this
      // mock reproduces exactly that, rather than a promise that never
      // settles at all (which would hang the test even under fake timers).
      fetchMock.mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
          }),
      );
      const promise = transcribeWithOpenAI("key", new Uint8Array([1]), "lec.mp3", "audio/mpeg");
      await vi.advanceTimersByTimeAsync(90_000);
      const res = await promise;
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toMatch(/time/i);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("transcribeWithGemini", () => {
  function mockThreeStepSuccess(transcriptText = "hello from gemini") {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { "x-goog-upload-url": "https://upload.example/abc" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ file: { uri: "files/abc123", mimeType: "audio/mpeg" } }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: transcriptText }] } }] }), { status: 200 }),
      );
  }

  it("uploads (2-step) then generates content, returning the transcript with no provider-reported duration", async () => {
    mockThreeStepSuccess();

    const res = await transcribeWithGemini("key", new Uint8Array([1, 2, 3]), "audio/mpeg");

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ text: "hello from gemini", durationSeconds: null });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/upload/v1beta/files");
    expect(String(fetchMock.mock.calls[1]![0])).toBe("https://upload.example/abc");
    expect(String(fetchMock.mock.calls[2]![0])).toContain(":generateContent");
  });

  it("fails cleanly if the upload-start step doesn't return an upload URL", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // no x-goog-upload-url header
    const res = await transcribeWithGemini("key", new Uint8Array([1]), "audio/mpeg");
    expect(res.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1); // never proceeds to the finish-upload step
  });

  it("treats 401/403 on the generateContent call as a clean rejected-key result", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { "x-goog-upload-url": "https://upload.example/abc" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ file: { uri: "files/abc123" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));

    const res = await transcribeWithGemini("key", new Uint8Array([1]), "audio/mpeg");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/rejected/i);
  });

  it("rejects a response with no transcript text instead of returning an empty string", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { "x-goog-upload-url": "https://upload.example/abc" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ file: { uri: "files/abc123" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [] }), { status: 200 }));

    const res = await transcribeWithGemini("key", new Uint8Array([1]), "audio/mpeg");
    expect(res.ok).toBe(false);
  });
});
