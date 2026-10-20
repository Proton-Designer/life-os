import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_DOC } from "@/lib/reader/__fixtures__/sample-doc";
import { DEFAULT_READER_SETTINGS } from "@/lib/reader/types";
import { resetBodyPinForTests } from "@/lib/client/use-body-pin";

const prepare = vi.fn();
const updateSettings = vi.fn(async (_patch: unknown) => true);
const refresh = vi.fn();
const sessionSubmit = vi.fn();
vi.mock("@/app/(app)/personal/reader-actions", () => ({
  prepareReaderDoc: (id: string) => prepare(id),
  getReadingStats: async () => ({ ok: false, message: "n/a" }),
  createHighlight: async () => ({ ok: false, message: "n/a" }),
  deleteHighlight: async () => ({ ok: true }),
}));
vi.mock("@/lib/reader/unload-beacon", async (orig) => {
  const actual = await orig<typeof import("@/lib/reader/unload-beacon")>();
  return {
    ...actual,
    createSettingsSender: () => actual.createSettingsSender((p) => updateSettings(p)),
    createSessionSender: (_send: unknown, onStored?: () => void) => {
      const real = actual.createSessionSender(async () => true, onStored);
      return { ...real, submit: (p?: Parameters<typeof real.submit>[0]) => (sessionSubmit(p), real.submit(p)) };
    },
  };
});
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
    sessionSubmit.mockReset();
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

  it("retries unsent reading stretches when the connection comes back ('online'), and stops listening on unmount", async () => {
    loadDoc.mockResolvedValue({ ok: true, doc: SAMPLE_DOC, fromCache: false });
    const { unmount } = render(<ReaderLoader {...base} />);
    await waitFor(() => expect(screen.getByTestId("reader-root")).toBeInTheDocument());
    expect(sessionSubmit).toHaveBeenCalledTimes(1); // the mount drain of stretches a closed tab left in storage
    expect(sessionSubmit).toHaveBeenCalledWith(undefined);
    act(() => void window.dispatchEvent(new Event("online")));
    expect(sessionSubmit).toHaveBeenCalledTimes(2); // positive control: the event adds one more drain
    const calls = sessionSubmit.mock.calls.length;
    unmount();
    window.dispatchEvent(new Event("online"));
    expect(sessionSubmit).toHaveBeenCalledTimes(calls);
  });

  it("shows the book's current name, not the title frozen in the stored document (a renamed book)", async () => {
    loadDoc.mockResolvedValue({ ok: true, doc: { ...SAMPLE_DOC, title: "Old frozen title" }, fromCache: true });
    const { rerender } = render(<ReaderLoader {...base} title="Renamed" />);
    await waitFor(() => expect(screen.getByTestId("reader-root")).toBeInTheDocument());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Renamed");
    expect(screen.queryByText("Old frozen title")).toBeNull(); // positive control: the frozen title really was different
    rerender(<ReaderLoader {...base} title="Renamed again" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Renamed again");
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

  it("Try again after a failed load of a ready book also asks the server for a fresh document URL", async () => {
    loadDoc.mockResolvedValueOnce({ ok: false, message: "That link expired." });
    render(<ReaderLoader {...base} />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    loadDoc.mockResolvedValue({ ok: true, doc: SAMPLE_DOC, fromCache: false });
    fireEvent.click(retry);
    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("reader-root")).toBeInTheDocument());
  });

  it("sends a setting changed inside the debounce window when the page is hidden, once", async () => {
    updateSettings.mockClear();
    loadDoc.mockResolvedValue({ ok: true, doc: SAMPLE_DOC, fromCache: false });
    render(<ReaderLoader {...base} />);
    await waitFor(() => expect(screen.getByTestId("reader-root")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Faster" }));
    expect(updateSettings).not.toHaveBeenCalled();
    act(() => void window.dispatchEvent(new Event("pagehide")));
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({ wpm: 325 });
    await act(async () => void (await Promise.resolve()));
    act(() => void window.dispatchEvent(new Event("pagehide")));
    expect(updateSettings).toHaveBeenCalledTimes(1); // positive control: nothing pending, nothing re-sent
  });

  it("sends pending settings when the reader unmounts", async () => {
    updateSettings.mockClear();
    loadDoc.mockResolvedValue({ ok: true, doc: SAMPLE_DOC, fromCache: false });
    const { unmount } = render(<ReaderLoader {...base} />);
    await waitFor(() => expect(screen.getByTestId("reader-root")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Slower" }));
    unmount();
    expect(updateSettings).toHaveBeenCalledWith({ wpm: 275 });
  });
});
