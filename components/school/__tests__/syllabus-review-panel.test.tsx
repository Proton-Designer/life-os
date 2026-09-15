import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { SyllabusReviewPanel } from "../syllabus-review-panel";
import type { ClassCardData } from "@/lib/school/get-class-cards";
import type { ConfirmStagingBatchResult } from "@/app/(app)/school/staging-actions";

const confirmStagingBatchMock = vi.fn(
  async (..._args: unknown[]): Promise<ConfirmStagingBatchResult> => ({ status: "confirmed", committedCount: 1, remaining: [] })
);
const updateStagedDeliverableMock = vi.fn(async (..._args: unknown[]) => {});
const deleteStagedDeliverableMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/app/(app)/school/staging-actions", () => ({
  confirmStagingBatch: (...args: unknown[]) => confirmStagingBatchMock(...args),
  updateStagedDeliverable: (...args: unknown[]) => updateStagedDeliverableMock(...args),
  deleteStagedDeliverable: (...args: unknown[]) => deleteStagedDeliverableMock(...args),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

type PendingBatch = NonNullable<ClassCardData["pendingStagingBatch"]>;

function batch(deliverables: PendingBatch["deliverables"]): PendingBatch {
  return { id: "batch-1", deliverables };
}

function deliverable(overrides: Partial<PendingBatch["deliverables"][number]> = {}): PendingBatch["deliverables"][number] {
  return { id: "d1", name: "Midterm", type: "exam", date: "2026-10-06", confidence: 0.9, sourceSnippet: null, ...overrides };
}

describe("SyllabusReviewPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("#19 — a zero-item batch renders a confident success state, not an error", () => {
    render(<SyllabusReviewPanel batch={batch([])} />);
    expect(screen.getByText(/nothing schedulable found/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("dismissing a zero-item batch confirms it — the empty batch IS the success state", async () => {
    const user = userEvent.setup();
    render(<SyllabusReviewPanel batch={batch([])} />);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(confirmStagingBatchMock).toHaveBeenCalledWith("batch-1");
  });

  it("renders each deliverable's name, type, date, and source snippet", () => {
    render(<SyllabusReviewPanel batch={batch([deliverable({ sourceSnippet: "Midterm: Oct 6" })])} />);
    expect(screen.getByDisplayValue("Midterm")).toBeInTheDocument();
    expect(screen.getByText(/midterm: oct 6/i)).toBeInTheDocument();
  });

  it("flags a low-confidence item for review", () => {
    render(<SyllabusReviewPanel batch={batch([deliverable({ confidence: 0.1 })])} />);
    expect(screen.getByText(/low confidence/i)).toBeInTheDocument();
  });

  it("flags an item with no date as not-yet-confirmable, per #17's no-guessing rule", () => {
    render(<SyllabusReviewPanel batch={batch([deliverable({ date: null })])} />);
    expect(screen.getByText(/no date/i)).toBeInTheDocument();
  });

  it("rejecting an item removes it from view and deletes it (never confirms) on Confirm", async () => {
    const user = userEvent.setup();
    render(<SyllabusReviewPanel batch={batch([deliverable({ id: "d1", name: "Reject me" })])} />);

    await user.click(screen.getByRole("button", { name: /reject reject me/i }));
    expect(screen.queryByDisplayValue("Reject me")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /confirm 0 items/i }));
    expect(deleteStagedDeliverableMock).toHaveBeenCalledWith("d1");
    expect(updateStagedDeliverableMock).not.toHaveBeenCalled();
  });

  it("Confirm saves every remaining edited row, then confirms the batch, then refreshes on full success", async () => {
    const user = userEvent.setup();
    render(<SyllabusReviewPanel batch={batch([deliverable({ id: "d1", name: "Original name" })])} />);

    const nameField = screen.getByLabelText(/name for original name/i);
    await user.clear(nameField);
    await user.type(nameField, "Corrected name");

    await user.click(screen.getByRole("button", { name: /confirm 1 item/i }));

    expect(updateStagedDeliverableMock).toHaveBeenCalledWith("d1", { name: "Corrected name", type: "exam", date: "2026-10-06" });
    expect(confirmStagingBatchMock).toHaveBeenCalledWith("batch-1");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("shows which specific items are still blocked when confirm doesn't fully complete", async () => {
    confirmStagingBatchMock.mockResolvedValueOnce({
      status: "confirming",
      committedCount: 0,
      remaining: [{ id: "d1", name: "Still needs a date", reason: "no_date" }],
    });
    const user = userEvent.setup();
    render(<SyllabusReviewPanel batch={batch([deliverable({ id: "d1", name: "Still needs a date", date: null })])} />);

    await user.click(screen.getByRole("button", { name: /confirm 1 item/i }));

    expect(await screen.findByText(/still needs a date/i)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
