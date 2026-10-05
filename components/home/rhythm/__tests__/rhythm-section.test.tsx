import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const startDayAction = vi.fn(async () => {});
vi.mock("@/app/(app)/open/actions", () => ({ startDayAction: () => startDayAction() }));
const getReplanData = vi.fn(async () => ({ todayLines: [{ id: "l1", title: "Draft the memo" }], planSeeds: [] }));
vi.mock("@/app/(app)/close/actions", () => ({ getReplanData: () => getReplanData() }));
vi.mock("@/components/evening-close/close-plan-stage", () => ({
  ClosePlanStage: ({ mode, initialLines }: { mode: string; initialLines: { title: string }[] }) => (
    <div data-testid="plan-stage">{mode}:{initialLines.map((l) => l.title).join(",")}</div>
  ),
}));
vi.mock("@/app/(app)/open/today/timebox-actions", () => ({ setTaskPlannedStartTime: vi.fn(), clearTaskPlannedStartTime: vi.fn() }));
vi.mock("@/components/business/lock-in-overlay-context", () => ({ useLockInOverlay: () => ({ session: null }) }));
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef(function L({ href, prefetch: _p, children, ...r }: React.ComponentPropsWithoutRef<"a"> & { prefetch?: unknown }, ref: React.Ref<HTMLAnchorElement>) {
      return <a ref={ref} href={href} {...r}>{children}</a>;
    }),
  };
});

import { RhythmSection } from "../rhythm-section";
import { resetKeyedQueuesForTests } from "@/lib/client/keyed-queue";
import type { RhythmData } from "@/lib/home/rhythm-data";

const plan = [
  { id: "a", title: "Ship the report", mit_rank: 1, completed: false },
  { id: "b", title: "Call the bank", mit_rank: 2, completed: true },
];

describe("RhythmSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKeyedQueuesForTests();
  });

  it("morning: last night's three with the crown marked, plus Start day and Re-plan", () => {
    render(<RhythmSection data={{ state: "morning", plan, diff: { changed: false } as never }} />);
    expect(screen.getByTestId("rhythm-morning")).toBeInTheDocument();
    expect(screen.getByText("Ship the report")).toBeInTheDocument();
    expect(screen.getByText("crowned")).toBeInTheDocument();
    expect(screen.getByTestId("start-day")).toHaveTextContent("Start day");
    expect(screen.getByTestId("replan-open")).toBeInTheDocument();
  });

  it("morning with no plan says so, and still offers Start day", () => {
    render(<RhythmSection data={{ state: "morning", plan: [], diff: { changed: false } as never }} />);
    expect(screen.getByText("No plan was made last night.")).toBeInTheDocument();
    expect(screen.getByTestId("start-day")).toBeInTheDocument();
  });

  it("Start day flips at once (optimistic) and writes once even on a double tap", async () => {
    const user = userEvent.setup();
    render(<RhythmSection data={{ state: "morning", plan: [], diff: { changed: false } as never }} />);
    await user.click(screen.getByTestId("start-day"));
    await user.click(screen.getByTestId("start-day"));
    expect(screen.getByTestId("start-day")).toHaveTextContent("Day started");
    await waitFor(() => expect(startDayAction).toHaveBeenCalledTimes(1));
  });

  it("a failed Start day puts the button back with an alert", async () => {
    startDayAction.mockRejectedValueOnce(new Error("x"));
    const user = userEvent.setup();
    render(<RhythmSection data={{ state: "morning", plan: [], diff: { changed: false } as never }} />);
    await user.click(screen.getByTestId("start-day"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't start the day");
    expect(screen.getByTestId("start-day")).toHaveTextContent("Start day");
  });

  it("Re-plan opens today's plan stage (mode today) with data read on open", async () => {
    const user = userEvent.setup();
    render(<RhythmSection data={{ state: "morning", plan, diff: { changed: false } as never }} />);
    expect(getReplanData).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("replan-open"));
    expect(await screen.findByTestId("plan-stage")).toHaveTextContent("today:Draft the memo");
    expect(getReplanData).toHaveBeenCalledTimes(1);
  });

  // HOME-02: ONE switch (HOME_DAY_VIEW). "classic" must render exactly the pre-change layout (three tiles and,
  // on the page, the separate day's-shape panel); "bar" renders the Day bar instead and none of the tiles.
  const today: RhythmData = { state: "today", localDate: "2026-10-05", nowIso: "2026-10-05T17:00:00Z", bedtime: null, wokeAtIso: "2026-10-05T12:00:00Z", deltaSeconds: 3600, hoursTodayMinutes: 90, efficiencyPercent: 42, timeboxed: [] };

  it("today / classic: the three tiles (Awake for, Hours, Efficiency), no Day bar, no Start day button", () => {
    render(<RhythmSection data={today} dayView="classic" />);
    expect(screen.getByTestId("rhythm-today")).toBeInTheDocument();
    expect(screen.getAllByTestId("stat-tile")).toHaveLength(3);
    expect(screen.getByText("42%")).toBeInTheDocument();
    // HOME-01b: the tile says just "Awake for" (no "Delta")
    expect(screen.getByText("Awake for")).toBeInTheDocument();
    expect(screen.queryByText(/delta/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("day-bar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("start-day")).not.toBeInTheDocument();
  });

  it("today / bar: the Day bar replaces the tiles (positive control for the classic test above)", () => {
    render(<RhythmSection data={today} dayView="bar" />);
    expect(screen.getByTestId("day-bar")).toBeInTheDocument();
    expect(screen.queryAllByTestId("stat-tile")).toHaveLength(0);
    expect(screen.getByTestId("day-bar-efficiency")).toHaveTextContent("42% focused");
  });

  it("the other phases are identical in both views (morning card unchanged)", () => {
    for (const view of ["bar", "classic"] as const) {
      const { unmount } = render(<RhythmSection data={{ state: "morning", plan: [], diff: { changed: false } as never }} dayView={view} />);
      expect(screen.getByTestId("rhythm-morning")).toBeInTheDocument();
      unmount();
    }
  });

  it("wind_down: a Close the day link to /close", () => {
    render(<RhythmSection data={{ state: "wind_down", bedtime: "22:30" }} />);
    expect(screen.getByTestId("lights-out")).toHaveTextContent("Lights out by 10:30 PM");
    expect(screen.getByTestId("close-the-day")).toHaveAttribute("href", "/close");
  });

  it("done: says so and lists tomorrow's three (or that nothing is planned)", () => {
    const { unmount } = render(<RhythmSection data={{ state: "done", tomorrow: [{ id: "t", title: "Write the essay", mitRank: 1 }], bedtime: null }} />);
    expect(screen.getByTestId("rhythm-done")).toHaveTextContent("Write the essay");
    expect(screen.queryByTestId("lights-out")).not.toBeInTheDocument();
    unmount();
    render(<RhythmSection data={{ state: "done", tomorrow: [], bedtime: "22:30" }} />);
    expect(screen.getByTestId("rhythm-done")).toHaveTextContent("Nothing is planned for tomorrow");
    // IA-P4b: "Lights out by" only when a wind-down plan gives a bedtime (control: the first render had none)
    expect(screen.getByTestId("lights-out")).toHaveTextContent("Lights out by 10:30 PM");
  });
});
