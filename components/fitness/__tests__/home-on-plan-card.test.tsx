import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HomeOnPlanCard } from "../home-on-plan-card";
import type { DayWorkout } from "@/lib/fitness/load-workout-details";

const WORKOUT: DayWorkout = {
  id: "w1",
  name: "Push A",
  exercises: [
    {
      exerciseId: "e1",
      name: "Cable Press",
      targetSets: 3,
      targetRepsLow: 8,
      targetRepsHigh: 10,
      targetLoad: 100,
      lastTopSet: null,
    },
  ],
};

describe("HomeOnPlanCard", () => {
  it("renders nothing when no workout is assigned today, including the week-one starter-plan case", () => {
    const { container } = render(
      <HomeOnPlanCard date="2026-08-20" workout={null} alreadyConfirmed={false} onConfirm={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing once already confirmed — nothing left to do, nothing left to show", () => {
    const { container } = render(
      <HomeOnPlanCard date="2026-08-20" workout={WORKOUT} alreadyConfirmed={true} onConfirm={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("collapses by default to one quiet line — workout name and 'Not logged yet', no numbers shown yet", () => {
    render(<HomeOnPlanCard date="2026-08-20" workout={WORKOUT} alreadyConfirmed={false} onConfirm={vi.fn()} />);
    expect(screen.getByTestId("home-on-plan-collapsed")).toHaveTextContent("Push A");
    expect(screen.getByTestId("home-on-plan-collapsed")).toHaveTextContent("Not logged yet");
    expect(screen.queryByTestId("home-on-plan-expanded")).not.toBeInTheDocument();
  });

  it("tapping the collapsed card expands to the real SessionDetailPanel with numbers inline before any confirm tap", async () => {
    const user = userEvent.setup();
    render(<HomeOnPlanCard date="2026-08-20" workout={WORKOUT} alreadyConfirmed={false} onConfirm={vi.fn()} />);
    await user.click(screen.getByTestId("home-on-plan-collapsed"));
    expect(screen.getByTestId("home-on-plan-expanded")).toBeInTheDocument();
    expect(screen.getByLabelText("Cable Press load")).toHaveValue(100);
    expect(screen.getByRole("button", { name: /Confirm Push A/ })).toBeInTheDocument();
  });

  it("confirming from the expanded panel calls the same onConfirm (RPC 029), no second write path", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<HomeOnPlanCard date="2026-08-20" workout={WORKOUT} alreadyConfirmed={false} onConfirm={onConfirm} />);
    await user.click(screen.getByTestId("home-on-plan-collapsed"));
    await user.click(screen.getByRole("button", { name: /Confirm Push A/ }));
    expect(onConfirm).toHaveBeenCalledWith("2026-08-20", "w1", "Push A", [
      { exerciseId: "e1", exerciseName: "Cable Press", position: 1, sets: 3, reps: 10, load: 100 },
    ]);
  });
});
