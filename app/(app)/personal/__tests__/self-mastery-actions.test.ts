import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `uploadBook`'s key-side refusal (2026-09-15, the Lead's fix, Addition A's
 * sibling): the driver-heartbeat check alone (`isIngestionAvailable`) says
 * nothing about whether THIS user's own resolved AI provider has a usable
 * key behind it -- see `hasUsableIngestionKey`'s own header in
 * lib/ai/gateway.ts. `hasUsableIngestionKey` and `isIngestionAvailable` are
 * mocked here (they have their own dedicated tests); the thing THESE tests
 * must prove is that `uploadBook` actually consults them, in the right
 * order, and refuses BEFORE ever touching `books` -- an upload that reaches
 * the insert with no usable key is exactly the "strands at processing
 * forever" bug this whole gate exists to prevent, just via the key path.
 */

const requireUserMock = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: () => requireUserMock(),
}));

const isIngestionAvailableMock = vi.fn();
vi.mock("@/lib/self-mastery/ingestion-availability", () => ({
  isIngestionAvailable: () => isIngestionAvailableMock(),
  INGESTION_UNAVAILABLE_MESSAGE: "driver down message",
}));

const hasUsableIngestionKeyMock = vi.fn();
vi.mock("@/lib/ai/gateway", () => ({
  hasUsableIngestionKey: (...args: unknown[]) => hasUsableIngestionKeyMock(...args),
  ingestionNoKeyMessage: (providerLabel: string | undefined) =>
    providerLabel ? `Add an API key for ${providerLabel} in Settings to process books.` : "Add an AI provider key in Settings to process books.",
}));

function fakeFile(): File {
  return new File(["%PDF-1.4 fake"], "book.pdf", { type: "application/pdf" });
}

function formDataFor(file: File, title = "A Book"): FormData {
  const fd = new FormData();
  fd.set("file", file);
  fd.set("title", title);
  return fd;
}

describe("uploadBook", () => {
  let fromMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock = vi.fn(() => {
      throw new Error("uploadBook must not touch `books` when an earlier gate refuses");
    });
    requireUserMock.mockResolvedValue({ supabase: { from: fromMock } as unknown as SupabaseClient, userId: "user-1" });
  });

  it("THE REGRESSION GUARD: refuses with a provider-specific message and never touches `books` when the resolved provider has no usable key", async () => {
    isIngestionAvailableMock.mockResolvedValue(true);
    hasUsableIngestionKeyMock.mockResolvedValue({ usable: false, providerLabel: "Claude" });
    const { uploadBook } = await import("../self-mastery-actions");

    const result = await uploadBook(formDataFor(fakeFile()));

    expect(result).toEqual({ ok: false, message: "Add an API key for Claude in Settings to process books." });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the preference itself couldn't be resolved (no providerLabel)", async () => {
    isIngestionAvailableMock.mockResolvedValue(true);
    hasUsableIngestionKeyMock.mockResolvedValue({ usable: false, providerLabel: undefined });
    const { uploadBook } = await import("../self-mastery-actions");

    const result = await uploadBook(formDataFor(fakeFile()));

    expect(result).toEqual({ ok: false, message: "Add an AI provider key in Settings to process books." });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("the driver-down message wins over the key check -- hasUsableIngestionKey is never even called", async () => {
    isIngestionAvailableMock.mockResolvedValue(false);
    const { uploadBook } = await import("../self-mastery-actions");

    const result = await uploadBook(formDataFor(fakeFile()));

    expect(result).toEqual({ ok: false, message: "driver down message" });
    expect(hasUsableIngestionKeyMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("a usable key clears both gates and proceeds to touch `books`", async () => {
    isIngestionAvailableMock.mockResolvedValue(true);
    hasUsableIngestionKeyMock.mockResolvedValue({ usable: true, providerLabel: "DeepSeek" });
    // Past both gates, uploadBook reaches the real insert chain -- give it one
    // that fails cleanly rather than throwing, so this test only asserts the
    // gates were cleared (both mocks were consulted), not the full upload flow.
    fromMock = vi.fn(() => ({
      insert: () => ({ select: () => ({ single: () => ({ returns: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }) }),
    }));
    requireUserMock.mockResolvedValue({ supabase: { from: fromMock } as unknown as SupabaseClient, userId: "user-1" });
    const { uploadBook } = await import("../self-mastery-actions");

    const result = await uploadBook(formDataFor(fakeFile()));

    expect(hasUsableIngestionKeyMock).toHaveBeenCalledWith(expect.anything(), "user-1");
    expect(fromMock).toHaveBeenCalledWith("books");
    expect(result.ok).toBe(false); // the insert itself was made to fail above; only the gate-clearing is under test
  });
});
