import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

// Same "thenable chain" shape as lib/school/__tests__/get-class-cards.test.ts's
// own fake — every chained method returns the chain itself, and it resolves
// to a fixed { data, error } regardless of which methods were actually
// called. Results are keyed by table name since each function under test
// only ever touches ONE table per call (classes in prepare, lecture_recordings
// everywhere else) — no cross-call ordering to fake.
function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "insert", "delete", "eq", "single", "maybeSingle"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) => resolve(result);
  return chain;
}

let fromResults: Record<string, { data: unknown; error: unknown }> = {};
const fromMock = vi.fn((table: string) => makeChain(fromResults[table] ?? { data: null, error: null }));

const createSignedUploadUrlMock = vi.fn(async (_path: string) => ({
  data: { path: "unused", token: "upload-token-abc" },
  error: null as { message: string } | null,
}));
const listMock = vi.fn(
  async (_dir: string, _opts: { search: string }) =>
    ({ data: [] as { name: string; metadata: Record<string, unknown> | null }[], error: null as { message: string } | null })
);
const removeMock = vi.fn(async (_paths: string[]) => ({ error: null as { message: string } | null }));
const createSignedUrlMock = vi.fn(async () => ({ data: { signedUrl: "https://signed.example/x" }, error: null as { message: string } | null }));

const requireUserMock = vi.fn(async () => ({
  supabase: {
    from: fromMock,
    storage: {
      from: () => ({
        createSignedUploadUrl: createSignedUploadUrlMock,
        list: listMock,
        remove: removeMock,
        createSignedUrl: createSignedUrlMock,
      }),
    },
  },
  userId: "user-1",
}));
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: () => requireUserMock(),
}));

describe("lecture-actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromResults = { classes: { data: { id: "class-1" }, error: null } };
    createSignedUploadUrlMock.mockResolvedValue({ data: { path: "unused", token: "upload-token-abc" }, error: null });
    listMock.mockResolvedValue({ data: [], error: null });
    removeMock.mockResolvedValue({ error: null });
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null });
  });

  describe("prepareLectureUpload", () => {
    it("verifies class ownership, then mints a signed upload url under <user>/<class>/", async () => {
      const { prepareLectureUpload } = await import("../lecture-actions");

      const result = await prepareLectureUpload("class-1", "lecture 1.mp3", "audio/mpeg", 1024);

      expect(fromMock).toHaveBeenCalledWith("classes");
      expect(createSignedUploadUrlMock).toHaveBeenCalledTimes(1);
      const [path] = createSignedUploadUrlMock.mock.calls[0]!;
      expect(path).toMatch(/^user-1\/class-1\/\d+-lecture_1\.mp3$/);
      expect(result).toEqual({ path, token: "upload-token-abc" });
    });

    it("rejects a class the caller doesn't own, without minting an upload url", async () => {
      fromResults.classes = { data: null, error: { message: "not found" } };
      const { prepareLectureUpload } = await import("../lecture-actions");

      await expect(prepareLectureUpload("class-1", "lecture.mp3", "audio/mpeg", 1024)).rejects.toThrow("Class not found");
      expect(createSignedUploadUrlMock).not.toHaveBeenCalled();
    });

    it("rejects an unsupported mime type at prepare time, without minting an upload url", async () => {
      const { prepareLectureUpload } = await import("../lecture-actions");

      await expect(prepareLectureUpload("class-1", "lecture.mov", "video/quicktime", 1024)).rejects.toThrow(/Unsupported file type/);
      expect(createSignedUploadUrlMock).not.toHaveBeenCalled();
    });

    it("rejects an oversize file at prepare time, without minting an upload url", async () => {
      const { prepareLectureUpload } = await import("../lecture-actions");

      await expect(prepareLectureUpload("class-1", "lecture.mp3", "audio/mpeg", 600 * 1024 * 1024)).rejects.toThrow(/50 MB/);
      expect(createSignedUploadUrlMock).not.toHaveBeenCalled();
    });

    // P3-14 04-verification (tracking-app-a9): production measured a HARD
    // project-wide Supabase Storage limit of 50 MiB that overrides the
    // bucket's own (higher) file_size_limit -- 50MiB-1-byte accepted,
    // 51MiB rejected. These two pin the exact boundary lib/school/
    // lecture-limits.ts's LECTURE_MAX_BYTES (52428800) enforces, matching
    // production's own measured line, not the old 500 MiB assumption.
    it("rejects a 51MB file with the friendly, actionable size message", async () => {
      const { prepareLectureUpload } = await import("../lecture-actions");

      await expect(
        prepareLectureUpload("class-1", "lecture.mp3", "audio/mpeg", 51 * 1024 * 1024)
      ).rejects.toThrow("Recordings can be up to 50 MB. A 90-minute lecture at 64 kbps mono is about 43 MB; compress it or split it into parts.");
      expect(createSignedUploadUrlMock).not.toHaveBeenCalled();
    });

    it("accepts a 49MB file", async () => {
      const { prepareLectureUpload } = await import("../lecture-actions");

      await expect(prepareLectureUpload("class-1", "lecture.mp3", "audio/mpeg", 49 * 1024 * 1024)).resolves.toBeDefined();
      expect(createSignedUploadUrlMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("finalizeLectureUpload", () => {
    it("rejects a path outside this user/class's own prefix, without touching Storage or inserting a row", async () => {
      const { finalizeLectureUpload } = await import("../lecture-actions");

      await expect(finalizeLectureUpload("class-1", "user-2/class-1/123-lec.mp3")).rejects.toThrow(
        "Path does not belong to this user/class"
      );
      expect(listMock).not.toHaveBeenCalled();
      expect(fromMock).not.toHaveBeenCalledWith("lecture_recordings");
    });

    it("rejects when the uploaded object can't be found (upload never completed or expired)", async () => {
      listMock.mockResolvedValue({ data: [], error: null });
      const { finalizeLectureUpload } = await import("../lecture-actions");

      await expect(finalizeLectureUpload("class-1", "user-1/class-1/123-lec.mp3")).rejects.toThrow(/Upload not found/);
      expect(fromMock).not.toHaveBeenCalledWith("lecture_recordings");
    });

    it("re-reads the real object metadata from Storage (not client input) and inserts a row from it", async () => {
      listMock.mockResolvedValue({
        data: [{ name: "123-lec.mp3", metadata: { size: 2048, mimetype: "audio/mpeg" } }],
        error: null,
      });
      fromResults.lecture_recordings = { data: null, error: null };
      const { finalizeLectureUpload } = await import("../lecture-actions");

      await finalizeLectureUpload("class-1", "user-1/class-1/123-lec.mp3");

      expect(fromMock).toHaveBeenCalledWith("lecture_recordings");
      expect(revalidatePathMock).toHaveBeenCalledWith("/school");
      expect(removeMock).not.toHaveBeenCalled();
    });

    it("removes the object and rejects when the real object's mime type fails the allowlist", async () => {
      listMock.mockResolvedValue({
        data: [{ name: "123-lec.mov", metadata: { size: 2048, mimetype: "video/quicktime" } }],
        error: null,
      });
      const { finalizeLectureUpload } = await import("../lecture-actions");

      await expect(finalizeLectureUpload("class-1", "user-1/class-1/123-lec.mov")).rejects.toThrow(/validation/);
      expect(removeMock).toHaveBeenCalledWith(["user-1/class-1/123-lec.mov"]);
      expect(fromMock).not.toHaveBeenCalledWith("lecture_recordings");
    });

    it("cleans up the object when the row insert fails, and rethrows", async () => {
      listMock.mockResolvedValue({
        data: [{ name: "123-lec.mp3", metadata: { size: 2048, mimetype: "audio/mpeg" } }],
        error: null,
      });
      fromResults.lecture_recordings = { data: null, error: { message: "insert failed" } };
      const { finalizeLectureUpload } = await import("../lecture-actions");

      await expect(finalizeLectureUpload("class-1", "user-1/class-1/123-lec.mp3")).rejects.toEqual({ message: "insert failed" });
      expect(removeMock).toHaveBeenCalledWith(["user-1/class-1/123-lec.mp3"]);
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });
  });

  it("removeLectureRecording deletes the row then best-effort removes the storage object", async () => {
    fromResults.lecture_recordings = { data: { storage_path: "user-1/class-1/123-lec.mp3" }, error: null };
    const { removeLectureRecording } = await import("../lecture-actions");

    await removeLectureRecording("rec-1");

    expect(removeMock).toHaveBeenCalledWith(["user-1/class-1/123-lec.mp3"]);
    expect(revalidatePathMock).toHaveBeenCalledWith("/school");
  });

  describe("getLectureRecordingUrl", () => {
    it("mints a fresh signed URL for an owned recording", async () => {
      fromResults.lecture_recordings = { data: { storage_path: "user-1/class-1/123-lec.mp3", mime_type: "audio/mpeg" }, error: null };
      const { getLectureRecordingUrl } = await import("../lecture-actions");

      const result = await getLectureRecordingUrl("rec-1");

      expect(createSignedUrlMock).toHaveBeenCalledWith("user-1/class-1/123-lec.mp3", 3600);
      expect(result).toEqual({ url: "https://signed.example/x", mimeType: "audio/mpeg" });
    });

    it("returns null instead of throwing for a recording that no longer exists or isn't this user's", async () => {
      fromResults.lecture_recordings = { data: null, error: null };
      const { getLectureRecordingUrl } = await import("../lecture-actions");

      const result = await getLectureRecordingUrl("rec-missing");

      expect(result).toBeNull();
      expect(createSignedUrlMock).not.toHaveBeenCalled();
    });
  });
});
