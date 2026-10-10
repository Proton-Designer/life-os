import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const archive = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/app/(app)/deen/actions", () => ({ archiveDeenHabit: (...a: unknown[]) => archive(...a) }));

import { FaithPracticesList } from "../faith-practices-list";
import type { FaithPractice } from "@/lib/deen/practices";
import { DAILY_FIELDS } from "@/lib/habits/__tests__/daily-fixture";

const practice = (over: Partial<FaithPractice> = {}): FaithPractice => ({
  id: "p1", name: "Read Quran", anchorCue: "After Fajr", completedToday: false, stage: "active_build", rollingRate: { done: 5, total: 12 },
  committedDate: "2026-09-20", stageOverride: null, streak: 0, streakInfo: { count: 0, unit: "day" }, ...DAILY_FIELDS, ...over,
});

describe("FaithPracticesList (/week step 3)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing when empty (Faith OFF); a row with name, stage and rate otherwise", () => {
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

describe("FaithPracticesList — cadence wording (HABIT-FREQ)", () => {
  it("daily keeps its original sentence; the other cadences speak in their own unit", () => {
    render(
      <FaithPracticesList
        practices={[
          practice({ id: "d", name: "Daily one", rollingRate: { done: 5, total: 12, unit: "day" } }),
          practice({ id: "w", name: "Weekly one", frequency: { kind: "per_week", count: 3 }, rollingRate: { done: 3, total: 4, unit: "week" } }),
          practice({ id: "m", name: "Monthly one", frequency: { kind: "per_month", count: 1 }, rollingRate: { done: 1, total: 2, unit: "month" } }),
          practice({ id: "e", name: "Fortnightly one", frequency: { kind: "every_n_days", interval: 14 }, rollingRate: { done: 2, total: 2, unit: "completion" } }),
        ]}
      />
    );
    const row = (n: string) => screen.getAllByTestId("faith-practice-row").find((r) => r.textContent?.includes(n))!;
    expect(row("Daily one")).toHaveTextContent("Done 5 of last 12 days");
    expect(row("Daily one")).not.toHaveTextContent("Every day");
    expect(row("Weekly one")).toHaveTextContent("3× a week · Hit the goal 3 of the last 4 weeks");
    expect(row("Monthly one")).toHaveTextContent("Once a month · Hit the goal 1 of the last 2 months");
    expect(row("Fortnightly one")).toHaveTextContent("Every 2 weeks · Done 2 of about 2 expected in the last 30 days");
  });
});
