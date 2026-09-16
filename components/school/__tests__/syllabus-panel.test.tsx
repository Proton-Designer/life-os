import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { SyllabusPanel } from "../syllabus-panel";
import type { SyllabusExtractionOutcome, CanvasSyllabusImportActionOutcome } from "@/app/(app)/school/syllabus-extraction-actions";

const extractSyllabusDeliverablesMock = vi.fn(
  async (..._args: unknown[]): Promise<SyllabusExtractionOutcome> => ({ outcome: "extracted", batchId: "b1", itemCount: 2, truncated: false })
);
const importCanvasSyllabusMock = vi.fn(async (..._args: unknown[]): Promise<CanvasSyllabusImportActionOutcome> => ({ outcome: "extracted", batchId: "b1", itemCount: 2, truncated: false }));
vi.mock("@/app/(app)/school/syllabus-extraction-actions", () => ({
  extractSyllabusDeliverables: (...args: unknown[]) => extractSyllabusDeliverablesMock(...args),
  importCanvasSyllabus: (...args: unknown[]) => importCanvasSyllabusMock(...args),
}));
vi.mock("@/app/(app)/school/class-actions", () => ({
  uploadClassSyllabus: vi.fn(async () => {}),
  removeClassSyllabus: vi.fn(async () => {}),
  getClassSyllabusUrl: vi.fn(async () => null),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/** jsdom's <input type="file"> doesn't expose an accessible name, so userEvent.upload's
 * own target-finding via the visible "Extract deliverables from PDF" button is what
 * actually opens the hidden PDF-only input — this file drives it that way rather than
 * querying the hidden input directly, matching how a real click would reach it. */
function pdfFile(name = "syllabus.pdf") {
  return new File(["%PDF-1.4 fake content"], name, { type: "application/pdf" });
}

describe("SyllabusPanel — Phase 1 #16 extraction trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the extraction trigger while editing, restricted to PDF", () => {
    render(<SyllabusPanel classId="c1" hasSyllabus={false} editing />);
    const button = screen.getByRole("button", { name: "Extract deliverables from PDF" });
    expect(button).toBeInTheDocument();
  });

  it("hides the extraction trigger outside edit mode, same gating as the rest of this panel's mutations", () => {
    render(<SyllabusPanel classId="c1" hasSyllabus={false} editing={false} />);
    expect(screen.queryByRole("button", { name: "Extract deliverables from PDF" })).not.toBeInTheDocument();
  });

  it("choosing a PDF calls extractSyllabusDeliverables with the class id and the file", async () => {
    const user = userEvent.setup();
    render(<SyllabusPanel classId="c1" hasSyllabus={false} editing />);

    await user.click(screen.getByRole("button", { name: "Extract deliverables from PDF" }));
    const hiddenInput = document.querySelector('input[type="file"][accept=".pdf,application/pdf"]') as HTMLInputElement;
    await user.upload(hiddenInput, pdfFile());

    await waitFor(() => expect(extractSyllabusDeliverablesMock).toHaveBeenCalledTimes(1));
    const [classIdArg, formDataArg] = extractSyllabusDeliverablesMock.mock.calls[0]!;
    expect(classIdArg).toBe("c1");
    expect((formDataArg as FormData).get("file")).toBeInstanceOf(File);
  });

  it("shows the no-key message distinctly from a genuine parse failure", async () => {
    extractSyllabusDeliverablesMock.mockResolvedValueOnce({ outcome: "no_key" });
    const user = userEvent.setup();
    render(<SyllabusPanel classId="c1" hasSyllabus={false} editing />);

    await user.click(screen.getByRole("button", { name: "Extract deliverables from PDF" }));
    const hiddenInput = document.querySelector('input[type="file"][accept=".pdf,application/pdf"]') as HTMLInputElement;
    await user.upload(hiddenInput, pdfFile());

    expect(await screen.findByText(/add an api key/i)).toBeInTheDocument();
  });

  it("shows a distinct message for a scanned PDF with no text layer — not the no-key message, not #19's 'nothing found'", async () => {
    extractSyllabusDeliverablesMock.mockResolvedValueOnce({ outcome: "no_text_layer" });
    const user = userEvent.setup();
    render(<SyllabusPanel classId="c1" hasSyllabus={false} editing />);

    await user.click(screen.getByRole("button", { name: "Extract deliverables from PDF" }));
    const hiddenInput = document.querySelector('input[type="file"][accept=".pdf,application/pdf"]') as HTMLInputElement;
    await user.upload(hiddenInput, pdfFile());

    expect(await screen.findByText(/couldn't read text from this pdf/i)).toBeInTheDocument();
  });

  it("says nothing extra on a successful extraction with items — the review panel elsewhere covers it", async () => {
    const user = userEvent.setup();
    render(<SyllabusPanel classId="c1" hasSyllabus={false} editing />);

    await user.click(screen.getByRole("button", { name: "Extract deliverables from PDF" }));
    const hiddenInput = document.querySelector('input[type="file"][accept=".pdf,application/pdf"]') as HTMLInputElement;
    await user.upload(hiddenInput, pdfFile());

    await waitFor(() => expect(extractSyllabusDeliverablesMock).toHaveBeenCalled());
    expect(screen.queryByText(/add an api key|couldn't read|isn't available|couldn't make sense/i)).not.toBeInTheDocument();
  });
});

// CANVAS-GAP-02 -- an ADDITIONAL path, only shown once this class is
// Canvas-linked; the manual PDF trigger above is unaffected either way.
describe("SyllabusPanel — Import from Canvas (CANVAS-GAP-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the Canvas import trigger only when canvasLinked and editing", () => {
    const { rerender } = render(<SyllabusPanel classId="c1" hasSyllabus={false} canvasLinked={false} editing />);
    expect(screen.queryByRole("button", { name: "Import from Canvas" })).not.toBeInTheDocument();

    rerender(<SyllabusPanel classId="c1" hasSyllabus={false} canvasLinked editing />);
    expect(screen.getByRole("button", { name: "Import from Canvas" })).toBeInTheDocument();
  });

  it("hides the Canvas import trigger outside edit mode even when linked, same gating as the rest of this panel", () => {
    render(<SyllabusPanel classId="c1" hasSyllabus={false} canvasLinked editing={false} />);
    expect(screen.queryByRole("button", { name: "Import from Canvas" })).not.toBeInTheDocument();
  });

  it("clicking it calls importCanvasSyllabus with the class id", async () => {
    const user = userEvent.setup();
    render(<SyllabusPanel classId="c1" hasSyllabus={false} canvasLinked editing />);

    await user.click(screen.getByRole("button", { name: "Import from Canvas" }));

    await waitFor(() => expect(importCanvasSyllabusMock).toHaveBeenCalledWith("c1"));
  });

  it("shows an honest message when Canvas has no syllabus for this course", async () => {
    importCanvasSyllabusMock.mockResolvedValueOnce({ outcome: "empty" });
    const user = userEvent.setup();
    render(<SyllabusPanel classId="c1" hasSyllabus={false} canvasLinked editing />);

    await user.click(screen.getByRole("button", { name: "Import from Canvas" }));

    expect(await screen.findByText(/canvas doesn't have a syllabus for this course yet/i)).toBeInTheDocument();
  });

  it("surfaces the fetch's own message on fetch_failed, not a generic one", async () => {
    importCanvasSyllabusMock.mockResolvedValueOnce({ outcome: "fetch_failed", message: "Canvas rejected that token." });
    const user = userEvent.setup();
    render(<SyllabusPanel classId="c1" hasSyllabus={false} canvasLinked editing />);

    await user.click(screen.getByRole("button", { name: "Import from Canvas" }));

    expect(await screen.findByText("Canvas rejected that token.")).toBeInTheDocument();
  });

  it("says nothing extra on a successful import with items -- the review panel elsewhere covers it", async () => {
    const user = userEvent.setup();
    render(<SyllabusPanel classId="c1" hasSyllabus={false} canvasLinked editing />);

    await user.click(screen.getByRole("button", { name: "Import from Canvas" }));

    await waitFor(() => expect(importCanvasSyllabusMock).toHaveBeenCalled());
    expect(screen.queryByText(/canvas doesn't have a syllabus|connect canvas|isn't mapped|add an api key|isn't available|couldn't make sense/i)).not.toBeInTheDocument();
  });

  it("does not disturb the manual PDF trigger, which stays available regardless of canvasLinked", () => {
    render(<SyllabusPanel classId="c1" hasSyllabus={false} canvasLinked editing />);
    expect(screen.getByRole("button", { name: "Extract deliverables from PDF" })).toBeInTheDocument();
  });
});
