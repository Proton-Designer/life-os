import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_DOC } from "@/lib/reader/__fixtures__/sample-doc";
import { DEFAULT_READER_SETTINGS } from "@/lib/reader/types";
import { resetBodyPinForTests } from "@/lib/client/use-body-pin";

const prepare = vi.fn();
const updateSettings = vi.fn(async () => ({ ok: true }));
const refresh = vi.fn();
vi.mock("@/app/(app)/personal/reader-actions", () => ({ prepareReaderDoc: (id: string) => prepare(id), updateReaderSettings: (p: unknown) => updateSettings(p) }));
const router = { refresh };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const loadDoc = vi.fn();
vi.mock("@/lib/reader/doc-cache", async (orig) => ({ ...(await orig<typeof import("@/lib/reader/doc-cache")>()), loadReaderDoc: (a: unknown) => loadDoc(a), indexedDbDocCache: () => null }));

import { ReaderLoader, type ReaderLoaderProps } from "../reader-loader";

const base: ReaderLoaderProps = {
  bookId: "11111111-1111-4111-8111-111111111111",
  backHref: "/self-mastery",
  title: "My Book",
  status: "ready",
  docUrl: "https://signed/doc",
  docVersion: 1,
  position: null,
  settings: DEFAULT_READER_SETTINGS,
};

describe("ReaderLoader", () => {
  beforeEach(() => {
    prepare.mockReset();
    loadDoc.mockReset();
    refresh.mockReset();
    resetBodyPinForTests();
    localStorage.clear();
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  it("opens a ready book from its stored document and resumes at the server position", async () => {
    loadDoc.mockResolvedValue({ ok: true, doc: SAMPLE_DOC, fromCache: false });
    render(<ReaderLoader {...base} position={{ wordIndex: 40, clientUpdatedAt: new Date(5000).toISOString() }} />);
    await waitFor(() => expect(screen.getByTestId("reader-root")).toBeInTheDocument());
    expect(loadDoc).toHaveBeenCalledWith(expect.objectContaining({ bookId: base.bookId, docUrl: base.docUrl }));
    expect(screen.getByTestId("reader-progress")).not.toHaveTextContent("0%");
  });

  it("builds a never-opened book first (\"Preparing for reading…\") and refreshes when ready", async () => {
    let finish!: (v: unknown) => void;
    prepare.mockReturnValue(new Promise((r) => (finish = r)));
    render(<ReaderLoader {...base} status="none" docUrl={null} />);
    expect(await screen.findByText("Preparing for reading…")).toBeInTheDocument();
    expect(prepare).toHaveBeenCalledWith(base.bookId);
    await act(async () => finish({ ok: true, preview: {} }));
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the typed message with Try again when preparing fails, and retries", async () => {
    prepare.mockResolvedValueOnce({ ok: false, message: "This PDF has no selectable text (scanned). OCR isn't supported yet." });
    render(<ReaderLoader {...base} status="none" docUrl={null} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("OCR isn't supported yet");
    prepare.mockResolvedValueOnce({ ok: true, preview: {} });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("does not re-run a failed import by itself", async () => {
    render(<ReaderLoader {...base} status="failed" docUrl={null} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("reports a document download failure with a way back", async () => {
    loadDoc.mockResolvedValue({ ok: false, message: "The book couldn't be downloaded. Check your connection and try again." });
    render(<ReaderLoader {...base} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't be downloaded");
    expect(screen.getByRole("link", { name: "Back to library" })).toHaveAttribute("href", "/self-mastery");
  });
});
