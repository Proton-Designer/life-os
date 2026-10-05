import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const archive = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/app/(app)/deen/actions", () => ({ archiveDeenHabit: (...a: unknown[]) => archive(...a) }));

import { FaithPracticesList } from "../faith-practices-list";
import type { FaithPractice } from "@/lib/deen/practices";

const practice = (over: Partial<FaithPractice> = {}): FaithPractice => ({
  id: "p1", name: "Read Quran", anchorCue: "After Fajr", completedToday: false, stage: "active_build", rollingRate: { done: 5, total: 12 },
  committedDate: "2026-09-20", stageOverride: null, streak: 0, ...over,
});

describe("FaithPracticesList (/week step 3)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing when empty (Deen OFF); a row with name, stage and rate otherwise", () => {
    const { container, unmount } = render(<FaithPracticesList practices={[]} />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    render(<FaithPracticesList practices={[practice(), practice({ id: "p2", name: "Dhikr", stage: "locked" })]} />);
    const row = screen.getAllByTestId("faith-practice-row")[0];
    expect(within(row).getByText("Read Quran")).toBeInTheDocument();
    expect(within(row).getByText("Building")).toBeInTheDocument();
    expect(within(row).getByText("Done 5 of last 12 days")).toBeInTheDocument();
    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit on the Faith screen" })).toHaveAttribute("href", "/deen");
  });

  it("Drop asks first and archives only after confirming; Cancel archives nothing", async () => {
    const user = userEvent.setup();
    render(<FaithPracticesList practices={[practice()]} />);
    await user.click(screen.getByRole("button", { name: "Drop Read Quran" }));
    expect(screen.getByText("Stop tracking this practice? Its history is kept.")).toBeInTheDocument();
    expect(archive).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(archive).not.toHaveBeenCalled();
    expect(screen.getByTestId("faith-practice-row")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Drop Read Quran" }));
    await user.click(screen.getByRole("button", { name: "Stop tracking" }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(screen.queryByTestId("faith-practice-row")).not.toBeInTheDocument());
  });

  it("a failed archive keeps the row and says so", async () => {
    archive.mockRejectedValueOnce(new Error("nope"));
    const user = userEvent.setup();
    render(<FaithPracticesList practices={[practice()]} />);
    await user.click(screen.getByRole("button", { name: "Drop Read Quran" }));
    await user.click(screen.getByRole("button", { name: "Stop tracking" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't stop tracking/);
    expect(screen.getByTestId("faith-practice-row")).toBeInTheDocument();
  });
});
