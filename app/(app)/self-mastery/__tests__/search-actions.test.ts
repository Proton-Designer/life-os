import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const requireUserMock = vi.fn(async () => ({ supabase: {} as unknown as SupabaseClient, userId: "user-1" }));
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: () => requireUserMock(),
}));

const searchLibraryMock = vi.fn();
vi.mock("@/lib/self-mastery/semantic-search", () => ({
  searchLibrary: (...args: unknown[]) => searchLibraryMock(...args),
}));

const { searchSelfMasteryLibrary } = await import("../search-actions");

beforeEach(() => {
  requireUserMock.mockClear();
  searchLibraryMock.mockReset();
});

describe("searchSelfMasteryLibrary", () => {
  it("resolves the caller via requireUser and passes their id + the raw query through to searchLibrary", async () => {
    searchLibraryMock.mockResolvedValue({ mode: "text", hits: [] });
    await searchSelfMasteryLibrary("habit formation");
    expect(searchLibraryMock).toHaveBeenCalledWith(expect.anything(), "user-1", "habit formation");
  });

  it("returns whatever searchLibrary returns, unmodified", async () => {
    const result = { mode: "semantic" as const, hits: [{ chunkId: "c1", bookId: "b1", bookTitle: "T", excerpt: "e", pageStart: null, pageEnd: null, similarity: 0.9 }] };
    searchLibraryMock.mockResolvedValue(result);
    expect(await searchSelfMasteryLibrary("habits")).toEqual(result);
  });
});
