import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AnnouncementPanel } from "../announcement-panel";
import type { AnnouncementExtractionOutcome, AnnouncementHistoryEntry } from "@/app/(app)/school/announcement-actions";

const extractAnnouncementDeliverablesMock = vi.fn(async (..._args: unknown[]): Promise<AnnouncementExtractionOutcome> => ({ outcome: "extracted", batchId: "b1", itemCount: 1, truncated: false }));
const getAnnouncementHistoryMock = vi.fn(async (..._args: unknown[]): Promise<AnnouncementHistoryEntry[]> => []);
vi.mock("@/app/(app)/school/announcement-actions", () => ({
  extractAnnouncementDeliverables: (...args: unknown[]) => extractAnnouncementDeliverablesMock(...args),
  getAnnouncementHistory: (...args: unknown[]) => getAnnouncementHistoryMock(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("AnnouncementPanel (P2-07)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extractAnnouncementDeliverablesMock.mockResolvedValue({ outcome: "extracted", batchId: "b1", itemCount: 1, truncated: false });
    getAnnouncementHistoryMock.mockResolvedValue([]);
  });

  it("shows the paste box and parse trigger while editing", () => {
    render(<AnnouncementPanel classId="c1" editing />);
    expect(screen.getByPlaceholderText(/paste a course announcement/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Parse announcement" })).toBeInTheDocument();
  });

  it("hides the paste box outside edit mode, same gating SyllabusPanel uses for its own mutations", () => {
    render(<AnnouncementPanel classId="c1" editing={false} />);
    expect(screen.queryByPlaceholderText(/paste a course announcement/i)).not.toBeInTheDocument();
  });

  it("the parse button stays disabled until there's real text", () => {
    render(<AnnouncementPanel classId="c1" editing />);
    expect(screen.getByRole("button", { name: "Parse announcement" })).toBeDisabled();
  });

  it("parsing calls extractAnnouncementDeliverables with the class id and pasted text, then clears the box", async () => {
    const user = userEvent.setup();
    render(<AnnouncementPanel classId="c1" editing />);
    const textarea = screen.getByPlaceholderText(/paste a course announcement/i);
    await user.type(textarea, "Quiz moved to Friday.");
    await user.click(screen.getByRole("button", { name: "Parse announcement" }));

    await waitFor(() => expect(extractAnnouncementDeliverablesMock).toHaveBeenCalledWith("c1", "Quiz moved to Friday."));
    await waitFor(() => expect(textarea).toHaveValue(""));
  });

  it("shows a clear message for a too_short/no_key/unavailable/parse_failed outcome, never a silent no-op", async () => {
    extractAnnouncementDeliverablesMock.mockResolvedValue({ outcome: "no_key" });
    const user = userEvent.setup();
    render(<AnnouncementPanel classId="c1" editing />);
    await user.type(screen.getByPlaceholderText(/paste a course announcement/i), "A real announcement about a quiz.");
    await user.click(screen.getByRole("button", { name: "Parse announcement" }));

    expect(await screen.findByText(/add an api key/i)).toBeInTheDocument();
  });

  it("the history list is collapsed by default and fetches only when opened", async () => {
    const user = userEvent.setup();
    render(<AnnouncementPanel classId="c1" editing />);
    expect(getAnnouncementHistoryMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Announcement history" }));
    await waitFor(() => expect(getAnnouncementHistoryMock).toHaveBeenCalledWith("c1"));
  });

  it("shows a clean empty state when there's no history yet", async () => {
    const user = userEvent.setup();
    render(<AnnouncementPanel classId="c1" editing />);
    await user.click(screen.getByRole("button", { name: "Announcement history" }));
    expect(await screen.findByText(/no announcements parsed for this class yet/i)).toBeInTheDocument();
  });

  it("renders each history entry's status, item count, and a snippet of the raw text", async () => {
    getAnnouncementHistoryMock.mockResolvedValue([
      { id: "b1", rawText: "The midterm has been moved to October 20th.", status: "confirmed", itemCount: 1, createdAt: "2026-09-10T00:00:00Z" },
    ]);
    const user = userEvent.setup();
    render(<AnnouncementPanel classId="c1" editing />);
    await user.click(screen.getByRole("button", { name: "Announcement history" }));

    const row = await screen.findByTestId("announcement-history-b1");
    expect(row).toHaveTextContent(/confirmed/i);
    expect(row).toHaveTextContent(/1 item/i);
    expect(row).toHaveTextContent(/midterm has been moved to october 20th/i);
  });
});
