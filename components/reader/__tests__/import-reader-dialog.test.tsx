import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReaderImportPreview } from "@/lib/reader/types";

const push = vi.fn();
const router = { push };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const createImport = vi.fn();
const prepare = vi.fn();
const confirm = vi.fn();
const cancel = vi.fn(async (_id: string) => ({ ok: true }));
vi.mock("@/app/(app)/personal/reader-actions", () => ({
  createReaderImport: (i: unknown) => createImport(i),
  prepareReaderDoc: (id: string) => prepare(id),
  confirmReaderImport: (id: string, e: unknown) => confirm(id, e),
  cancelReaderImport: (id: string) => cancel(id),
}));
const upload = vi.fn(async (..._a: unknown[]) => ({ data: {}, error: null as { message: string } | null }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: upload }) } }) }));

import { ImportReaderDialog, readingTimeLabel } from "../import-reader-dialog";

const PREVIEW: ReaderImportPreview = {
  bookId: "b-1",
  title: "Deep Work",
  author: "Cal Newport",
  source: "epub",
  wordCount: 61234,
  chapters: [{ title: "Intro", firstWord: 0 }, { title: "Chapter 1", firstWord: 900 }],
  sample: "The first words of the book …",
  warnings: ["2 pages had no text and were skipped."],
};

async function openWithFile(user: ReturnType<typeof userEvent.setup>, name = "deep.epub") {
  render(<ImportReaderDialog />);
  await user.click(screen.getByTestId("import-to-read-trigger"));
  await user.upload(screen.getByTestId("import-file-input") as HTMLInputElement, new File(["PK"], name));
}

describe("ImportReaderDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createImport.mockReset().mockResolvedValue({ ok: true, bookId: "b-1", upload: { path: "u/b-1/source.epub", token: "t", contentType: "application/epub+zip" } });
    prepare.mockReset().mockResolvedValue({ ok: true, preview: PREVIEW });
    confirm.mockReset().mockResolvedValue({ ok: true });
    upload.mockReset().mockResolvedValue({ data: {}, error: null });
  });

  it("file: create -> upload with the server's content type -> prepare -> preview -> start reading opens /read/<id>", async () => {
    const user = userEvent.setup();
    await openWithFile(user);
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByTestId("import-preview")).toBeInTheDocument();
    expect(createImport).toHaveBeenCalledWith({ kind: "file", filename: "deep.epub", fileSizeBytes: 2 });
    expect(upload).toHaveBeenCalledWith("u/b-1/source.epub", "t", expect.any(File), { contentType: "application/epub+zip" });
    expect(screen.getByTestId("import-stats")).toHaveTextContent("61,234 words");
    expect(screen.getByText(/2 pages had no text/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Deep Work (2016)");
    await user.click(screen.getByRole("button", { name: "Start reading" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/read/b-1"));
    expect(confirm).toHaveBeenCalledWith("b-1", { title: "Deep Work (2016)", author: "Cal Newport" });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("cancel in the preview deletes the import and returns to the form", async () => {
    const user = userEvent.setup();
    await openWithFile(user);
    await user.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByTestId("import-preview");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith("b-1"));
    expect(await screen.findByRole("button", { name: /Import$/ })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("a typed server failure shows its message, cleans up the row and offers Try again", async () => {
    prepare.mockResolvedValue({ ok: false, message: "This PDF has no selectable text (it looks scanned). OCR isn't supported yet.", code: "no_text" });
    const user = userEvent.setup();
    await openWithFile(user, "scan.pdf");
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("OCR isn't supported yet");
    expect(cancel).toHaveBeenCalledWith("b-1");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("an upload failure cleans up and shows a retryable message", async () => {
    upload.mockResolvedValue({ data: {}, error: { message: "network down" } });
    const user = userEvent.setup();
    await openWithFile(user);
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("upload didn't go through");
    expect(cancel).toHaveBeenCalledWith("b-1");
    expect(prepare).not.toHaveBeenCalled();
  });

  it("paste uploads the text as a plain-text blob; link needs no upload", async () => {
    const user = userEvent.setup();
    render(<ImportReaderDialog />);
    await user.click(screen.getByTestId("import-to-read-trigger"));
    await user.click(screen.getByRole("button", { name: "Paste" }));
    await user.type(screen.getByLabelText("Text to read"), "Some words to read.");
    createImport.mockResolvedValueOnce({ ok: true, bookId: "b-2", upload: { path: "u/b-2/source.txt", token: "t2", contentType: "text/plain" } });
    await user.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByTestId("import-preview");
    expect(createImport).toHaveBeenLastCalledWith({ kind: "paste" });
    expect(upload).toHaveBeenCalledWith("u/b-2/source.txt", "t2", expect.any(Blob), { contentType: "text/plain" });
  });

  it("link: sends the url and skips the upload step", async () => {
    createImport.mockResolvedValue({ ok: true, bookId: "b-3", upload: null });
    const user = userEvent.setup();
    render(<ImportReaderDialog />);
    await user.click(screen.getByTestId("import-to-read-trigger"));
    await user.click(screen.getByRole("button", { name: "Link" }));
    await user.type(screen.getByLabelText("Article link"), "https://example.com/post");
    await user.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByTestId("import-preview");
    expect(createImport).toHaveBeenCalledWith({ kind: "url", url: "https://example.com/post" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("Import stays disabled until there is something to import (positive control)", async () => {
    const user = userEvent.setup();
    render(<ImportReaderDialog />);
    await user.click(screen.getByTestId("import-to-read-trigger"));
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });
});

describe("readingTimeLabel", () => {
  it("formats minutes and hours", () => {
    expect(readingTimeLabel(300)).toBe("about 1 min");
    expect(readingTimeLabel(30000)).toBe("about 1 h 40 min");
    expect(readingTimeLabel(18000)).toBe("about 1 h");
  });
});
