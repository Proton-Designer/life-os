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
