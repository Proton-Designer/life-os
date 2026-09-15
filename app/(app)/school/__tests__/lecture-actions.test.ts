import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

// Same "thenable chain" shape as lib/school/__tests__/get-class-cards.test.ts's
// own fake — every chained method returns the chain itself, and it resolves
// to a fixed { data, error } regardless of which methods were actually
// called, which is enough for these functions (they only ever await the
// final result of one straight-line chain, never branch on an intermediate
// step's return value).
function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "insert", "delete", "eq", "single", "maybeSingle", "returns"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) => resolve(result);
  return chain;
}

const uploadMock = vi.fn(async (_path: string, _file: File, _opts: { contentType: string; upsert: boolean }) => ({
  error: null as { message: string } | null,
}));
const removeMock = vi.fn(async (_paths: string[]) => ({ error: null as { message: string } | null }));
const createSignedUrlMock = vi.fn(async () => ({ data: { signedUrl: "https://signed.example/x" }, error: null as { message: string } | null }));
let fromResult: { data: unknown; error: unknown } = { data: null, error: null };
const fromMock = vi.fn((_table: string) => makeChain(fromResult));

const requireUserMock = vi.fn(async () => ({
  supabase: {
    storage: { from: () => ({ upload: uploadMock, remove: removeMock, createSignedUrl: createSignedUrlMock }) },
    from: fromMock,
  },
  userId: "user-1",
}));
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: () => requireUserMock(),
}));

function audioFile(name: string) {
  return new File(["audio-bytes"], name, { type: "audio/mpeg" });
}

describe("lecture-actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromResult = { data: null, error: null };
    uploadMock.mockResolvedValue({ error: null });
    removeMock.mockResolvedValue({ error: null });
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null });
  });

  it("uploadLectureRecording uploads to the lectures bucket under <user>/<class>/, then inserts a row, then revalidates", async () => {
    const { uploadLectureRecording } = await import("../lecture-actions");
    const formData = new FormData();
    formData.set("file", audioFile("lecture 1.mp3"));

    await uploadLectureRecording("class-1", formData);

    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [path, , opts] = uploadMock.mock.calls[0]!;
    expect(path).toMatch(/^user-1\/class-1\/\d+-lecture_1\.mp3$/);
    expect(opts).toEqual({ contentType: "audio/mpeg", upsert: false });

    expect(fromMock).toHaveBeenCalledWith("lecture_recordings");
    expect(removeMock).not.toHaveBeenCalled(); // insert succeeded -- nothing to clean up
    expect(revalidatePathMock).toHaveBeenCalledWith("/school");
  });

  it("uploadLectureRecording cleans up the just-uploaded object when the row insert fails, and rethrows", async () => {
    fromResult = { data: null, error: { message: "insert failed" } };
    const { uploadLectureRecording } = await import("../lecture-actions");
    const formData = new FormData();
    formData.set("file", audioFile("lecture1.mp3"));

    await expect(uploadLectureRecording("class-1", formData)).rejects.toEqual({ message: "insert failed" });

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(removeMock.mock.calls[0]![0]).toEqual([uploadMock.mock.calls[0]![0]]);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("uploadLectureRecording throws when no file is provided, without touching storage", async () => {
    const { uploadLectureRecording } = await import("../lecture-actions");
    await expect(uploadLectureRecording("class-1", new FormData())).rejects.toThrow("No file provided");
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("removeLectureRecording deletes the row then best-effort removes the storage object", async () => {
    fromResult = { data: { storage_path: "user-1/class-1/123-lec.mp3" }, error: null };
    const { removeLectureRecording } = await import("../lecture-actions");

    await removeLectureRecording("rec-1");

    expect(removeMock).toHaveBeenCalledWith(["user-1/class-1/123-lec.mp3"]);
    expect(revalidatePathMock).toHaveBeenCalledWith("/school");
  });

  it("getLectureRecordingUrl mints a fresh signed URL for an owned recording", async () => {
    fromResult = { data: { storage_path: "user-1/class-1/123-lec.mp3", mime_type: "audio/mpeg" }, error: null };
    const { getLectureRecordingUrl } = await import("../lecture-actions");

    const result = await getLectureRecordingUrl("rec-1");

    expect(createSignedUrlMock).toHaveBeenCalledWith("user-1/class-1/123-lec.mp3", 3600);
    expect(result).toEqual({ url: "https://signed.example/x", mimeType: "audio/mpeg" });
  });

  it("getLectureRecordingUrl returns null instead of throwing for a recording that no longer exists or isn't this user's", async () => {
    fromResult = { data: null, error: null };
    const { getLectureRecordingUrl } = await import("../lecture-actions");

    const result = await getLectureRecordingUrl("rec-missing");

    expect(result).toBeNull();
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });
});
