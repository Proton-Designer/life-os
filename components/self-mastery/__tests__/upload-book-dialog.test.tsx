import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

type PrepareOutcome = { ok: true; bookId: string; path: string; token: string; contentType: string } | { ok: false; message: string };
type FinalizeOutcome = { ok: true; bookId: string } | { ok: false; message: string };
const prepareBookUploadMock = vi.fn(
  async (..._args: unknown[]): Promise<PrepareOutcome> => ({ ok: true, bookId: "book-1", path: "user-1/book-1.pdf", token: "tok-1", contentType: "application/pdf" })
);
const finalizeBookUploadMock = vi.fn(async (..._args: unknown[]): Promise<FinalizeOutcome> => ({ ok: true, bookId: "book-1" }));
const cancelBookUploadMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/app/(app)/personal/self-mastery-actions", () => ({
  prepareBookUpload: (...args: unknown[]) => prepareBookUploadMock(...args),
  finalizeBookUpload: (...args: unknown[]) => finalizeBookUploadMock(...args),
  cancelBookUpload: (...args: unknown[]) => cancelBookUploadMock(...args),
}));

const uploadToSignedUrlMock = vi.fn(async (..._args: unknown[]) => ({ data: {} as {} | null, error: null as { message: string } | null }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: uploadToSignedUrlMock }) } }),
}));

import { UploadBookDialog } from "../upload-book-dialog";

function fakeFile(): File {
  return new File(["%PDF-1.4 fake"], "book.pdf", { type: "application/pdf" });
}

/** Overrides `.size` rather than allocating a real N-byte blob -- cheap,
 * and this dialog only ever reads `.size`/`.name`/`.type` off the File
 * before handing it to `uploadToSignedUrl`. */
function sizedFile(sizeBytes: number, name = "book.pdf"): File {
  const file = new File(["%PDF-1.4 fake"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

async function openAndPickFile(user: ReturnType<typeof userEvent.setup>, file: File = fakeFile()) {
  render(<UploadBookDialog />);
  await user.click(screen.getByTestId("add-book-trigger"));
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(fileInput, file);
}

describe("UploadBookDialog -- URGENT pdf-upload fix (direct-to-storage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pushMock.mockReset();
    prepareBookUploadMock.mockReset().mockResolvedValue({ ok: true, bookId: "book-1", path: "user-1/book-1.pdf", token: "tok-1", contentType: "application/pdf" });
    finalizeBookUploadMock.mockReset().mockResolvedValue({ ok: true, bookId: "book-1" });
    cancelBookUploadMock.mockReset().mockResolvedValue(undefined);
    uploadToSignedUrlMock.mockReset().mockResolvedValue({ data: {}, error: null });
  });

  it("submitting runs prepare -> direct-to-storage upload -> finalize, in that order, then navigates to the book", async () => {
    const user = userEvent.setup();
    await openAndPickFile(user);
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "A Book");

    await user.click(screen.getByRole("button", { name: "Add to library" }));

    await waitFor(() => expect(finalizeBookUploadMock).toHaveBeenCalledTimes(1));
    expect(prepareBookUploadMock).toHaveBeenCalledWith("A Book", "", "standard", expect.any(Number), "book.pdf");
    expect(uploadToSignedUrlMock).toHaveBeenCalledWith("user-1/book-1.pdf", "tok-1", expect.any(File), { contentType: "application/pdf" });
    expect(finalizeBookUploadMock).toHaveBeenCalledWith("book-1", "user-1/book-1.pdf");
    expect(cancelBookUploadMock).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/self-mastery/book-1");

    const prepareOrder = prepareBookUploadMock.mock.invocationCallOrder[0]!;
    const uploadOrder = uploadToSignedUrlMock.mock.invocationCallOrder[0]!;
    const finalizeOrder = finalizeBookUploadMock.mock.invocationCallOrder[0]!;
    expect(prepareOrder).toBeLessThan(uploadOrder);
    expect(uploadOrder).toBeLessThan(finalizeOrder);
  });

  // The whole point of the fix: the file's bytes never enter a FormData
  // sent to a Server Action, so a file far larger than Next's old 1MB
  // server-action body cap must go through the exact same path as a tiny
  // one -- there is no size-dependent branch anywhere in this component.
  it("a file far larger than the old 1MB server-action body cap uploads via the same direct-to-storage path, no crash", async () => {
    const user = userEvent.setup();
    await openAndPickFile(user, sizedFile(40 * 1024 * 1024));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "A Big Book");

    await user.click(screen.getByRole("button", { name: "Add to library" }));

    await waitFor(() => expect(finalizeBookUploadMock).toHaveBeenCalledTimes(1));
    expect(pushMock).toHaveBeenCalledWith("/self-mastery/book-1");
  });

  it("rejects a file over the real 50MB limit client-side, before ever calling prepare", async () => {
    const user = userEvent.setup();
    render(<UploadBookDialog />);
    await user.click(screen.getByTestId("add-book-trigger"));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(fileInput, sizedFile(51 * 1024 * 1024));

    expect(await screen.findByText(/too large/i)).toBeInTheDocument();
    expect(prepareBookUploadMock).not.toHaveBeenCalled();
    // Oversize is a readable message, never the crash the old flow produced --
    // the dialog stays on the "choose a file" empty state, not a form for a
    // file that was rejected.
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });

  it("shows prepare's own error message (e.g. no usable AI key) and never starts the direct upload", async () => {
    prepareBookUploadMock.mockResolvedValueOnce({ ok: false, message: "Add an API key for DeepSeek in Settings to process books." });
    const user = userEvent.setup();
    await openAndPickFile(user);
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "A Book");

    await user.click(screen.getByRole("button", { name: "Add to library" }));

    expect(await screen.findByText("Add an API key for DeepSeek in Settings to process books.")).toBeInTheDocument();
    expect(uploadToSignedUrlMock).not.toHaveBeenCalled();
    expect(cancelBookUploadMock).not.toHaveBeenCalled(); // nothing was ever created -- nothing to cancel
  });

  // THE NEW ORPHAN RISK this fix introduces (BRIEF-pdf-upload.md item 4):
  // prepareBookUpload already inserted a "books" row by the time the direct
  // upload can fail. Every failure branch past that point must call
  // cancelBookUpload so that row never gets stuck at "uploading" forever.
  describe("cleanup when the direct-to-storage upload fails after a row was already created", () => {
    it("calls cancelBookUpload and shows a readable error when uploadToSignedUrl itself errors", async () => {
      uploadToSignedUrlMock.mockResolvedValueOnce({ data: null, error: new Error("network error") });
      const user = userEvent.setup();
      await openAndPickFile(user);
      await user.clear(screen.getByLabelText("Title"));
      await user.type(screen.getByLabelText("Title"), "A Book");

      await user.click(screen.getByRole("button", { name: "Add to library" }));

      await waitFor(() => expect(cancelBookUploadMock).toHaveBeenCalledWith("book-1"));
      expect(screen.getByText("network error")).toBeInTheDocument();
      expect(finalizeBookUploadMock).not.toHaveBeenCalled();
      expect(pushMock).not.toHaveBeenCalled();
    });

    it("maps Storage's raw 'exceeded the maximum allowed size' rejection to the friendly message and still cleans up", async () => {
      uploadToSignedUrlMock.mockResolvedValueOnce({ data: null, error: new Error("The object exceeded the maximum allowed size") });
      const user = userEvent.setup();
      await openAndPickFile(user);
      await user.clear(screen.getByLabelText("Title"));
      await user.type(screen.getByLabelText("Title"), "A Book");

      await user.click(screen.getByRole("button", { name: "Add to library" }));

      await waitFor(() => expect(cancelBookUploadMock).toHaveBeenCalledWith("book-1"));
      expect(await screen.findByText(/too large/i)).toBeInTheDocument();
    });

    it("calls cancelBookUpload when finalize itself returns ok:false, after a successful direct upload", async () => {
      finalizeBookUploadMock.mockResolvedValueOnce({ ok: false, message: "Something went wrong uploading that file. Please try again." });
      const user = userEvent.setup();
      await openAndPickFile(user);
      await user.clear(screen.getByLabelText("Title"));
      await user.type(screen.getByLabelText("Title"), "A Book");

      await user.click(screen.getByRole("button", { name: "Add to library" }));

      await waitFor(() => expect(cancelBookUploadMock).toHaveBeenCalledWith("book-1"));
      expect(screen.getByText("Something went wrong uploading that file. Please try again.")).toBeInTheDocument();
      expect(pushMock).not.toHaveBeenCalled();
    });
  });

  describe("processing mode selector (P2-14B, preserved)", () => {
    it("defaults to Standard (selected/pressed), with Batch shown but not selected", async () => {
      const user = userEvent.setup();
      await openAndPickFile(user);

      expect(screen.getByRole("button", { name: "Standard" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Batch \(lower cost\)/ })).toBeInTheDocument();
    });

    it("submitting WITHOUT touching the toggle sends ingestion_mode=standard", async () => {
      const user = userEvent.setup();
      await openAndPickFile(user);
      await user.clear(screen.getByLabelText("Title"));
      await user.type(screen.getByLabelText("Title"), "A Book");

      await user.click(screen.getByRole("button", { name: "Add to library" }));

      await waitFor(() => expect(prepareBookUploadMock).toHaveBeenCalledTimes(1));
      expect(prepareBookUploadMock).toHaveBeenCalledWith("A Book", "", "standard", expect.any(Number), "book.pdf");
    });

    it("clicking Batch then submitting sends ingestion_mode=batch", async () => {
      const user = userEvent.setup();
      await openAndPickFile(user);
      await user.clear(screen.getByLabelText("Title"));
      await user.type(screen.getByLabelText("Title"), "A Book");

      await user.click(screen.getByRole("button", { name: /Batch \(lower cost\)/ }));
      await user.click(screen.getByRole("button", { name: "Add to library" }));

      await waitFor(() => expect(prepareBookUploadMock).toHaveBeenCalledTimes(1));
      expect(prepareBookUploadMock).toHaveBeenCalledWith("A Book", "", "batch", expect.any(Number), "book.pdf");
    });

    it("closing and reopening the dialog resets the mode back to Standard, never carrying a stale Batch choice into a new upload", async () => {
      const user = userEvent.setup();
      render(<UploadBookDialog />);
      await user.click(screen.getByTestId("add-book-trigger"));
      let fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(fileInput, fakeFile());
      await user.click(screen.getByRole("button", { name: /Batch \(lower cost\)/ }));

      // Close (Escape) and reopen.
      await user.keyboard("{Escape}");
      await user.click(screen.getByTestId("add-book-trigger"));
      fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(fileInput, fakeFile());
      await user.clear(screen.getByLabelText("Title"));
      await user.type(screen.getByLabelText("Title"), "A Book");
      await user.click(screen.getByRole("button", { name: "Add to library" }));

      await waitFor(() => expect(prepareBookUploadMock).toHaveBeenCalledTimes(1));
      expect(prepareBookUploadMock).toHaveBeenCalledWith("A Book", "", "standard", expect.any(Number), "book.pdf");
    });
  });

  describe("EPUB / TXT / Markdown", () => {
    it("the file picker offers PDF, EPUB, TXT and Markdown", async () => {
      const user = userEvent.setup();
      render(<UploadBookDialog />);
      await user.click(screen.getByTestId("add-book-trigger"));
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input.accept).toBe(".pdf,.epub,.txt,.md,.markdown");
    });

    it("an EPUB goes up with the Content-Type the server named, under the path the server named, and the title drops the extension", async () => {
      prepareBookUploadMock.mockResolvedValue({ ok: true, bookId: "book-1", path: "user-1/book-1.epub", token: "tok-1", contentType: "application/epub+zip" });
      const user = userEvent.setup();
      render(<UploadBookDialog />);
      await user.click(screen.getByTestId("add-book-trigger"));
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(input, new File(["PK"], "Atomic Habits.epub", { type: "" }));
      expect(screen.getByLabelText("Title")).toHaveValue("Atomic Habits");

      await user.click(screen.getByRole("button", { name: "Add to library" }));

      await waitFor(() => expect(finalizeBookUploadMock).toHaveBeenCalledTimes(1));
      expect(prepareBookUploadMock).toHaveBeenCalledWith("Atomic Habits", "", "standard", expect.any(Number), "Atomic Habits.epub");
      expect(uploadToSignedUrlMock).toHaveBeenCalledWith("user-1/book-1.epub", "tok-1", expect.any(File), { contentType: "application/epub+zip" });
      expect(finalizeBookUploadMock).toHaveBeenCalledWith("book-1", "user-1/book-1.epub");
    });
  });
});
