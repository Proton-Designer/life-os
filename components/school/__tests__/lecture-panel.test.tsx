import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { LecturePanel, type LectureRecording } from "../lecture-panel";

const prepareLectureUploadMock = vi.fn(async (..._args: unknown[]) => ({ path: "user-1/class-1/123-lecture.mp3", token: "tok-1" }));
const finalizeLectureUploadMock = vi.fn(async (..._args: unknown[]) => {});
const removeLectureRecordingMock = vi.fn(async (..._args: unknown[]) => {});
const getLectureRecordingUrlMock = vi.fn(async (..._args: unknown[]) => ({ url: "https://signed.example/x", mimeType: "audio/mpeg" }));
vi.mock("@/app/(app)/school/lecture-actions", () => ({
  prepareLectureUpload: (...args: unknown[]) => prepareLectureUploadMock(...args),
  finalizeLectureUpload: (...args: unknown[]) => finalizeLectureUploadMock(...args),
  removeLectureRecording: (...args: unknown[]) => removeLectureRecordingMock(...args),
  getLectureRecordingUrl: (...args: unknown[]) => getLectureRecordingUrlMock(...args),
}));

const uploadToSignedUrlMock = vi.fn(async (..._args: unknown[]) => ({ data: {} as {} | null, error: null as { message: string } | null }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: uploadToSignedUrlMock }) } }),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

function audioFile(name = "lecture.mp3") {
  return new File(["audio-bytes"], name, { type: "audio/mpeg" });
}

function recording(overrides: Partial<LectureRecording> = {}): LectureRecording {
  return {
    id: "rec-1",
    originalFilename: "lecture.mp3",
    mimeType: "audio/mpeg",
    sizeBytes: 1024,
    durationSeconds: null,
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("LecturePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadToSignedUrlMock.mockResolvedValue({ data: {}, error: null });
  });

  it("shows an empty state with no recordings, and the upload trigger only while editing", () => {
    const { rerender } = render(<LecturePanel classId="class-1" lectures={[]} editing />);
    expect(screen.getByText("No recordings yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload recording" })).toBeInTheDocument();

    rerender(<LecturePanel classId="class-1" lectures={[]} editing={false} />);
    expect(screen.queryByRole("button", { name: "Upload recording" })).not.toBeInTheDocument();
  });

  it("choosing a file runs prepare -> direct-to-storage upload -> finalize, in that order, then refreshes", async () => {
    const user = userEvent.setup();
    render(<LecturePanel classId="class-1" lectures={[]} editing />);

    const input = document.querySelector('input[type="file"][accept="audio/*"]') as HTMLInputElement;
    await user.upload(input, audioFile("lecture 1.mp3"));

    await waitFor(() => expect(finalizeLectureUploadMock).toHaveBeenCalledTimes(1));
    expect(prepareLectureUploadMock).toHaveBeenCalledWith("class-1", "lecture 1.mp3", "audio/mpeg", expect.any(Number));
    expect(uploadToSignedUrlMock).toHaveBeenCalledWith("user-1/class-1/123-lecture.mp3", "tok-1", expect.any(File));
    expect(finalizeLectureUploadMock).toHaveBeenCalledWith("class-1", "user-1/class-1/123-lecture.mp3");
    expect(refreshMock).toHaveBeenCalled();

    // Call order matters -- finalize must never run before the direct upload settles.
    const prepareOrder = prepareLectureUploadMock.mock.invocationCallOrder[0]!;
    const uploadOrder = uploadToSignedUrlMock.mock.invocationCallOrder[0]!;
    const finalizeOrder = finalizeLectureUploadMock.mock.invocationCallOrder[0]!;
    expect(prepareOrder).toBeLessThan(uploadOrder);
    expect(uploadOrder).toBeLessThan(finalizeOrder);
  });

  it("shows an error and never finalizes when prepare rejects", async () => {
    prepareLectureUploadMock.mockRejectedValueOnce(new Error("Unsupported file type: video/quicktime"));
    const user = userEvent.setup();
    render(<LecturePanel classId="class-1" lectures={[]} editing />);

    const input = document.querySelector('input[type="file"][accept="audio/*"]') as HTMLInputElement;
    await user.upload(input, audioFile());

    expect(await screen.findByText("Unsupported file type: video/quicktime")).toBeInTheDocument();
    expect(uploadToSignedUrlMock).not.toHaveBeenCalled();
    expect(finalizeLectureUploadMock).not.toHaveBeenCalled();
  });

  it("shows an error and never finalizes when the direct-to-storage upload itself fails", async () => {
    // Real supabase-js storage errors are Error instances (StorageApiError extends
    // Error) -- mirror that shape rather than a plain {message} object, matching
    // this panel's own `err instanceof Error ? err.message : ...` handling, same
    // convention class-detail-dialog.tsx's handleSave already uses.
    uploadToSignedUrlMock.mockResolvedValueOnce({ data: null, error: new Error("network error") });
    const user = userEvent.setup();
    render(<LecturePanel classId="class-1" lectures={[]} editing />);

    const input = document.querySelector('input[type="file"][accept="audio/*"]') as HTMLInputElement;
    await user.upload(input, audioFile());

    await waitFor(() => expect(screen.getByText("network error")).toBeInTheDocument());
    expect(finalizeLectureUploadMock).not.toHaveBeenCalled();
  });

  it("playing a recording fetches a fresh signed URL and renders an audio element with it", async () => {
    const user = userEvent.setup();
    render(<LecturePanel classId="class-1" lectures={[recording()]} editing />);

    await user.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => expect(getLectureRecordingUrlMock).toHaveBeenCalledWith("rec-1"));
    const audioEl = await screen.findByText((_, el) => el?.tagName.toLowerCase() === "audio");
    expect(audioEl).toHaveAttribute("src", "https://signed.example/x");
  });

  it("removing a recording requires confirmation, then calls removeLectureRecording", async () => {
    const user = userEvent.setup();
    render(<LecturePanel classId="class-1" lectures={[recording()]} editing />);

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(removeLectureRecordingMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm remove" }));
    expect(removeLectureRecordingMock).toHaveBeenCalledWith("rec-1");
  });

  it("hides Remove outside edit mode -- Play stays available", () => {
    render(<LecturePanel classId="class-1" lectures={[recording()]} editing={false} />);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });
});
