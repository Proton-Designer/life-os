import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { saveMock } = vi.hoisted(() => ({ saveMock: vi.fn() }));
vi.mock("@/app/(app)/close/gap-actions", () => ({ saveUntrackedGaps: saveMock }));

import { CloseGapsStage } from "../close-gaps-stage";
import type { UntrackedGap } from "@/lib/checkins/gaps-core";

const gap = (s: string, e: string, minutes: number, hint: UntrackedGap["hint"] = null): UntrackedGap => ({
  start: `2026-10-11T${s}:00.000Z`,
  end: `2026-10-11T${e}:00.000Z`,
  minutes,
  hint,
});
const G1 = gap("10:30", "13:00", 150);
const G2 = gap("14:00", "15:00", 60);
const G3 = gap("16:00", "16:45", 45);

function setup(gaps: UntrackedGap[], deenMode = true) {
  return render(<CloseGapsStage gaps={gaps} timezone="UTC" deenMode={deenMode} />);
}
const pick = (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(screen.getByRole("button", { name }));

describe("CloseGapsStage", () => {
  beforeEach(() => {
    saveMock.mockReset();
    saveMock.mockResolvedValue({ saved: 1 });
  });

  it("renders nothing when there are no gaps", () => {
    const { container } = setup([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("asks one stretch at a time in 12-hour time, with the total and a position", () => {
    setup([G1, G2]);
    expect(screen.getByTestId("close-gaps-range")).toHaveTextContent("10:30 AM – 1:00 PM");
    expect(screen.getByTestId("close-gaps-progress")).toHaveTextContent("1 of 2");
    expect(screen.getByText(/3h 30m today with nothing logged/)).toBeInTheDocument();
  });

  it("one tap answers and moves on; the last answer saves every answer together, then shows a short summary", async () => {
    const user = userEvent.setup();
    setup([G1, G2]);
    await pick(user, "Business");
    expect(saveMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("close-gaps-range")).toHaveTextContent("2:00 PM – 3:00 PM");
    await pick(user, "Rest or meals");
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(saveMock).toHaveBeenCalledWith([
      { start: G1.start, end: G1.end, choice: "business" },
      { start: G2.start, end: G2.end, choice: "rest" },
    ]);
    expect(await screen.findByTestId("close-gaps-done")).toHaveTextContent("2h 30m Business");
    expect(screen.getByTestId("close-gaps-done")).toHaveTextContent("1h Rest or meals");
  });

  it("'Not sure' skips a stretch without saving it (unknown, not wasted); all skipped saves nothing", async () => {
    const user = userEvent.setup();
    setup([G1, G2]);
    await user.click(screen.getByTestId("close-gaps-skip"));
    await user.click(screen.getByTestId("close-gaps-skip"));
    expect(saveMock).not.toHaveBeenCalled();
    expect(await screen.findByTestId("close-gaps-done")).toHaveTextContent("Left as unknown for tonight");
  });

  it("a schedule hint is the first thing offered and one tap answers with its area", async () => {
    const user = userEvent.setup();
    setup([gap("10:30", "12:00", 90, { title: "Calculus", choice: "school" })]);
    expect(screen.getByTestId("close-gaps-hint")).toHaveTextContent("Planned: Calculus");
    await user.click(screen.getByTestId("close-gaps-hint"));
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith([{ start: expect.any(String), end: expect.any(String), choice: "school" }]));
  });

  it("'Same for the other N' answers every remaining stretch with the next tap", async () => {
    const user = userEvent.setup();
    setup([G1, G2, G3]);
    await user.click(screen.getByTestId("close-gaps-fill-all"));
    expect(screen.getByTestId("close-gaps-fill-note")).toHaveTextContent("all 3 remaining");
    await pick(user, "Wasted");
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(saveMock.mock.calls[0][0].map((a: { choice: string }) => a.choice)).toEqual(["wasted", "wasted", "wasted"]);
  });

  it("Split turns one stretch into two parts that are asked in turn", async () => {
    const user = userEvent.setup();
    setup([G1]); // 10:30-1:00 PM, 150 min
    await user.click(screen.getByTestId("close-gaps-split"));
    expect(screen.getByTestId("close-gaps-split-picker")).toBeInTheDocument();
    await user.click(screen.getByTestId("close-gaps-split-confirm")); // default: the middle, 75 -> 75 (a multiple of 15)
    expect(screen.getByTestId("close-gaps-progress")).toHaveTextContent("1 of 2");
    expect(screen.getByTestId("close-gaps-range")).toHaveTextContent("10:30 AM – 11:45 AM");
    await pick(user, "School");
    expect(screen.getByTestId("close-gaps-range")).toHaveTextContent("11:45 AM – 1:00 PM");
    await pick(user, "Errands");
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(saveMock.mock.calls[0][0]).toEqual([
      { start: G1.start, end: "2026-10-11T11:45:00.000Z", choice: "school" },
      { start: "2026-10-11T11:45:00.000Z", end: G1.end, choice: "errands" },
    ]);
  });

  it("Faith is only offered with Faith Mode on", () => {
    const on = setup([G1], true);
    expect(screen.getByRole("button", { name: "Faith" })).toBeInTheDocument();
    on.unmount();
    setup([G1], false);
    expect(screen.queryByRole("button", { name: "Faith" })).not.toBeInTheDocument();
  });

  it("Back returns to the previous stretch, and a failed save keeps the answers with the error shown", async () => {
    const user = userEvent.setup();
    saveMock.mockRejectedValueOnce(new Error("That time isn't one of your untracked stretches"));
    setup([G1, G2]);
    await pick(user, "Business");
    await user.click(screen.getByTestId("close-gaps-back"));
    expect(screen.getByTestId("close-gaps-range")).toHaveTextContent("10:30 AM");
    expect(screen.getByRole("button", { name: "Business" })).toHaveAttribute("aria-pressed", "true");
    await pick(user, "Business");
    await pick(user, "Fitness");
    expect(await screen.findByTestId("close-gaps-error")).toHaveTextContent("isn't one of your untracked stretches");
    expect(screen.queryByTestId("close-gaps-done")).not.toBeInTheDocument();
  });
});
