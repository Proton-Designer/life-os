import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SyllabusViewerDialog, type SyllabusViewerResult } from "../syllabus-viewer-dialog";

const renderAsyncMock = vi.hoisted(() => vi.fn());
vi.mock("docx-preview", () => ({ renderAsync: renderAsyncMock }));

const PDF: SyllabusViewerResult = { url: "https://example.com/syllabus.pdf", kind: "pdf" };
const DOCX: SyllabusViewerResult = { url: "https://example.com/syllabus.docx", kind: "docx" };
const OTHER: SyllabusViewerResult = { url: "https://example.com/syllabus.doc", kind: "other" };

describe("SyllabusViewerDialog", () => {
  beforeEach(() => {
    renderAsyncMock.mockReset();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(new Blob(), { status: 200 }))));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a message when there's no result", () => {
    render(<SyllabusViewerDialog open onOpenChange={vi.fn()} result={null} />);
    expect(screen.getByText("Couldn't load the syllabus.")).toBeInTheDocument();
  });

  it("renders a PDF inline via iframe, untouched by the docx work", () => {
    render(<SyllabusViewerDialog open onOpenChange={vi.fn()} result={PDF} />);
    expect(screen.getByTitle("Syllabus")).toHaveAttribute("src", PDF.url);
  });

  // --------------------------------------------------------------------
  // Mobile PDF (2026-09-10). On Ayman's phone, View produced a titled
  // modal with a 380x649 VOID in it and downloaded the file anyway --
  // mobile Chromium ships no PDF plugin, so the <iframe> navigated,
  // couldn't display, and handed off to the downloader. Nothing threw, so
  // the component's own "can't be previewed" fallback never fired: the
  // failing path looked successful all the way down.
  //
  // These three cases pin the branch on the PROPERTY the component reads
  // (navigator.pdfViewerEnabled), not on a user-agent string, which is
  // only a proxy for it. Deleting the pdfInline guard turns the first one
  // red -- verified by doing exactly that before trusting these.
  // --------------------------------------------------------------------
  function stubPdfViewer(enabled: boolean | undefined) {
    Object.defineProperty(navigator, "pdfViewerEnabled", {
      value: enabled,
      configurable: true,
    });
  }

  it("never mounts the iframe on a browser with no PDF viewer -- mounting it IS what triggers the download", () => {
    stubPdfViewer(false);
    render(<SyllabusViewerDialog open onOpenChange={vi.fn()} result={PDF} />);
    // Not "hidden", not "empty" -- absent. A hidden iframe still navigates.
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Open syllabus" })).toHaveAttribute("href", PDF.url);
  });

  it("hands a viewer-less browser the PLAIN signed url, never the ?download= one", () => {
    stubPdfViewer(false);
    render(<SyllabusViewerDialog open onOpenChange={vi.fn()} result={PDF} />);
    // The whole point of C1 was that View saved the file instead of showing
    // it. Answering the same tap with a download would concede the report.
    expect(screen.getByRole("link", { name: "Open syllabus" }).getAttribute("href")).not.toContain(
      "download="
    );
    // Download stays reachable, demoted -- not removed.
    expect(screen.getByRole("link", { name: "Download instead" }).getAttribute("href")).toContain(
      "download="
    );
  });

  it("still renders inline when the browser reports a viewer, and when it is too old to say", () => {
    stubPdfViewer(true);
    const { unmount } = render(<SyllabusViewerDialog open onOpenChange={vi.fn()} result={PDF} />);
    expect(screen.getByTitle("Syllabus")).toHaveAttribute("src", PDF.url);
    unmount();

    // undefined => assume yes. An unrecognised browser is far likelier to
    // have a viewer than not, and a false negative costs a working render.
    stubPdfViewer(undefined);
    render(<SyllabusViewerDialog open onOpenChange={vi.fn()} result={PDF} />);
    expect(screen.getByTitle("Syllabus")).toHaveAttribute("src", PDF.url);
  });

  it("shows an honest can't-preview message with a Download link for 'other' (e.g. legacy .doc), never the iframe", () => {
    render(<SyllabusViewerDialog open onOpenChange={vi.fn()} result={OTHER} />);
    expect(screen.getByText("This document can't be previewed.")).toBeInTheDocument();
    expect(screen.queryByTitle("Syllabus")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      expect.stringContaining("download=")
    );
  });

  it("renders a docx via docx-preview", async () => {
    renderAsyncMock.mockResolvedValue(undefined);
    render(<SyllabusViewerDialog open onOpenChange={vi.fn()} result={DOCX} />);
    await waitFor(() => expect(renderAsyncMock).toHaveBeenCalled(), { timeout: 4000 });
    expect(screen.queryByText("This document can't be previewed.")).not.toBeInTheDocument();
  });

  it("shows the honest fallback when docx-preview fails, with a working (?download=) link, not the ignored cross-origin download attribute", async () => {
    renderAsyncMock.mockRejectedValue(new Error("bad zip"));
    render(<SyllabusViewerDialog open onOpenChange={vi.fn()} result={DOCX} />);
    expect(await screen.findByText("This document can't be previewed.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Download" });
    expect(link).toHaveAttribute("href", expect.stringContaining("download="));
    expect(link).not.toHaveAttribute("download");
  });

  // Opus Lead review: unmounting the docx container on error left
  // containerRef.current permanently null, so a single transient failure
  // latched "can't be previewed" for every subsequent docx view — even a
  // later one with a perfectly good URL — until a full page reload.
  it("recovers on a fresh open after a docx failure, instead of latching the error forever", async () => {
    renderAsyncMock.mockRejectedValueOnce(new Error("transient")).mockResolvedValueOnce(undefined);

    const { rerender } = render(<SyllabusViewerDialog open onOpenChange={vi.fn()} result={DOCX} />);
    expect(await screen.findByText("This document can't be previewed.")).toBeInTheDocument();

    // Close, then reopen with a fresh signed URL (a new result object,
    // exactly as syllabus-panel.tsx mints on every open) — this must
    // re-run the render attempt, not keep showing the stale error.
    rerender(<SyllabusViewerDialog open={false} onOpenChange={vi.fn()} result={null} />);
    rerender(<SyllabusViewerDialog open onOpenChange={vi.fn()} result={{ ...DOCX }} />);

    await waitFor(() => expect(renderAsyncMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("This document can't be previewed.")).not.toBeInTheDocument();
  });
});
