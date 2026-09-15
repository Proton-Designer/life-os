import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const resolveStoredUserKeyMock = vi.fn();
vi.mock("../resolve-key", () => ({
  resolveStoredUserKey: (...args: unknown[]) => resolveStoredUserKeyMock(...args),
}));

const checkEmbeddingSpendCapMock = vi.fn();
vi.mock("../embeddings-spend", () => ({
  checkEmbeddingSpendCap: (...args: unknown[]) => checkEmbeddingSpendCapMock(...args),
}));

const { embedWithOpenAI, embedWithGoogle, getUserEmbeddings, EMBEDDING_DIMENSIONS } = await import("../embeddings");
const { FakeUsageStore } = await import("./fake-usage-store");

const fakeClient = {} as unknown as SupabaseClient;

function jsonResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

describe("EMBEDDING_DIMENSIONS", () => {
  it("matches the existing source_chunks.embedding / lessons.embedding vector(384) columns", () => {
    expect(EMBEDDING_DIMENSIONS).toBe(384);
  });
});

describe("embedWithOpenAI()", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("requests the exact dimensions this schema's columns expect", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [{ embedding: [0.1], index: 0 }], usage: { prompt_tokens: 3 } }));
    await embedWithOpenAI("sk-key", ["hello"]);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.dimensions).toBe(384);
    expect(body.model).toBe("text-embedding-3-small");
  });

  it("returns embeddings sorted by the response's own index, not response order", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: [
          { embedding: [2], index: 1 },
          { embedding: [1], index: 0 },
        ],
        usage: { prompt_tokens: 6 },
      }),
    );
    const result = await embedWithOpenAI("sk-key", ["a", "b"]);
    expect(result).toEqual({ ok: true, embeddings: [[1], [2]], promptTokens: 6 });
  });

  it("a 401/403 reads as a rejected key, not a generic error", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, {}));
    const result = await embedWithOpenAI("bad-key", ["hello"]);
    expect(result).toEqual({ ok: false, message: "OpenAI rejected that key." });
  });

  it("a mismatched embedding count is a real failure, not silently truncated/padded", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [{ embedding: [0.1], index: 0 }], usage: { prompt_tokens: 3 } }));
    const result = await embedWithOpenAI("sk-key", ["a", "b"]);
    expect(result.ok).toBe(false);
  });

  it("a network failure (fetch throws) is caught, never an unhandled rejection", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const result = await embedWithOpenAI("sk-key", ["hello"]);
    expect(result).toEqual({ ok: false, message: "Couldn't reach OpenAI." });
  });
});

describe("embedWithGoogle()", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("requests the exact outputDimensionality this schema's columns expect, per input text", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { embeddings: [{ values: [0.1] }, { values: [0.2] }] }));
    await embedWithGoogle("g-key", ["a", "b"]);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.requests).toHaveLength(2);
    expect(body.requests[0].outputDimensionality).toBe(384);
  });

  it("never reports promptTokens -- Gemini's own response has no usage field", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { embeddings: [{ values: [0.1] }] }));
    const result = await embedWithGoogle("g-key", ["hello"]);
    expect(result).toEqual({ ok: true, embeddings: [[0.1]], promptTokens: null });
  });

  it("a 401/403 reads as a rejected key", async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, {}));
    const result = await embedWithGoogle("bad-key", ["hello"]);
    expect(result).toEqual({ ok: false, message: "Gemini rejected that key." });
  });
});

describe("getUserEmbeddings()", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    resolveStoredUserKeyMock.mockReset();
    checkEmbeddingSpendCapMock.mockReset().mockResolvedValue({ allowed: true, capUsd: 10, spentUsd: 0, estimatedCostUsd: 0.0001 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("empty input returns ok with an empty array -- no key lookup, no spend check, no fetch", async () => {
    const result = await getUserEmbeddings(fakeClient, "u1", []);
    expect(result).toEqual({ status: "ok", embeddings: [], provider: "openai" });
    expect(resolveStoredUserKeyMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no key for ANY provider -- status: no_key, never a thrown error", async () => {
    resolveStoredUserKeyMock.mockResolvedValue(null);
    const result = await getUserEmbeddings(fakeClient, "u1", ["hello"]);
    expect(result).toEqual({ status: "no_key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prefers OpenAI over Google when the user has BOTH keys -- fixed preference order", async () => {
    resolveStoredUserKeyMock.mockResolvedValue("some-key"); // both providers "have" a key
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [{ embedding: [0.1], index: 0 }], usage: { prompt_tokens: 3 } }));
    const result = await getUserEmbeddings(fakeClient, "u1", ["hello"], { store: new FakeUsageStore() });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.provider).toBe("openai");
    expect(resolveStoredUserKeyMock).toHaveBeenCalledWith(fakeClient, "u1", "openai");
  });

  it("falls back to Google when the user has ONLY a Google key", async () => {
    resolveStoredUserKeyMock.mockImplementation((_c: unknown, _u: string, provider: string) => Promise.resolve(provider === "google" ? "g-key" : null));
    fetchMock.mockResolvedValue(jsonResponse(200, { embeddings: [{ values: [0.1] }] }));
    const result = await getUserEmbeddings(fakeClient, "u1", ["hello"], { store: new FakeUsageStore() });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.provider).toBe("google");
  });

  it("checks the spend cap BEFORE calling the provider, and refuses without ever fetching when it's blocked", async () => {
    resolveStoredUserKeyMock.mockResolvedValue("sk-key");
    checkEmbeddingSpendCapMock.mockResolvedValue({ allowed: false, reason: "budget exceeded", capUsd: 1, spentUsd: 1, estimatedCostUsd: 0.01 });
    const result = await getUserEmbeddings(fakeClient, "u1", ["hello"]);
    expect(result).toEqual({ status: "unavailable", message: "budget exceeded" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs the REAL cost from OpenAI's own reported tokens, not the pre-flight estimate", async () => {
    resolveStoredUserKeyMock.mockResolvedValue("sk-key");
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [{ embedding: [0.1], index: 0 }], usage: { prompt_tokens: 1_000_000 } }));
    const store = new FakeUsageStore();
    await getUserEmbeddings(fakeClient, "u1", ["hello"], { store });
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]!.costUsd).toBeCloseTo(0.02, 5); // 1M tokens * $0.02/1M
    expect(store.entries[0]!.tokens.promptTokens).toBe(1_000_000);
  });

  it("logs the pre-flight ESTIMATE for Gemini, which never reports real usage -- never a fabricated real number", async () => {
    resolveStoredUserKeyMock.mockImplementation((_c: unknown, _u: string, provider: string) => Promise.resolve(provider === "google" ? "g-key" : null));
    fetchMock.mockResolvedValue(jsonResponse(200, { embeddings: [{ values: [0.1] }] }));
    const store = new FakeUsageStore();
    await getUserEmbeddings(fakeClient, "u1", ["hello"], { store });
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]!.tokens.promptTokens).toBeGreaterThan(0);
  });

  it("a provider error surfaces as status: unavailable with the provider's own message, never a throw", async () => {
    resolveStoredUserKeyMock.mockResolvedValue("sk-key");
    fetchMock.mockResolvedValue(jsonResponse(401, {}));
    const result = await getUserEmbeddings(fakeClient, "u1", ["hello"]);
    expect(result).toEqual({ status: "unavailable", message: "OpenAI rejected that key." });
  });
});
