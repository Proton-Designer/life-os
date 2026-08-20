import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SessionDetailPanel } from "../session-detail-panel";

const WORKOUT = {
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
    {
      exerciseId: "e2",
      name: "Pull-ups",
      targetSets: 3,
      targetRepsLow: 6,
      targetRepsHigh: 8,
      targetLoad: null,
      lastTopSet: null,
    },
  ],
};

describe("SessionDetailPanel", () => {
  it("shows a plain empty message when nothing is planned for the day", () => {
    render(
      <SessionDetailPanel date="2026-08-20" dayLabel="Today" workout={null} alreadyConfirmed={false} onConfirm={vi.fn()} />
    );
    expect(screen.getByTestId("session-detail-empty")).toHaveTextContent("Nothing planned for Today.");
  });

  it("renders every exercise's actual numbers inline, sets and reps and load all visible before any confirm tap", () => {
    render(
      <SessionDetailPanel date="2026-08-20" dayLabel="Today" workout={WORKOUT} alreadyConfirmed={false} onConfirm={vi.fn()} />
    );
    expect(screen.getByLabelText("Cable Press sets")).toHaveValue(3);
    expect(screen.getByLabelText("Cable Press reps")).toHaveValue(10);
    expect(screen.getByLabelText("Cable Press load")).toHaveValue(100);
    // bodyweight exercise (no target load) shows no load field rather than a fabricated number
    expect(screen.queryByLabelText("Pull-ups load")).not.toBeInTheDocument();
  });

  it("renders every exercise simultaneously — no auto-advance / one-at-a-time wizard", () => {
    render(
      <SessionDetailPanel date="2026-08-20" dayLabel="Today" workout={WORKOUT} alreadyConfirmed={false} onConfirm={vi.fn()} />
    );
    expect(screen.getByTestId("session-row-e1")).toBeInTheDocument();
    expect(screen.getByTestId("session-row-e2")).toBeInTheDocument();
  });

  it("the Confirm button always renders alongside the visible numbers, never a bare button with nothing shown", () => {
    render(
      <SessionDetailPanel date="2026-08-20" dayLabel="Today" workout={WORKOUT} alreadyConfirmed={false} onConfirm={vi.fn()} />
    );
    const numbers = screen.getAllByRole("spinbutton");
    const confirmButton = screen.getByRole("button", { name: /Confirm Push A/ });
    expect(numbers.length).toBeGreaterThan(0);
    expect(confirmButton).toBeInTheDocument();
  });

  it("adjusting a number via the stepper before confirming changes what gets submitted", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <SessionDetailPanel date="2026-08-20" dayLabel="Today" workout={WORKOUT} alreadyConfirmed={false} onConfirm={onConfirm} />
    );
    const loadInput = screen.getByLabelText("Cable Press load");
    await user.clear(loadInput);
    await user.type(loadInput, "105");
    await user.click(screen.getByRole("button", { name: /Confirm Push A/ }));
    expect(onConfirm).toHaveBeenCalledWith(
      "2026-08-20",
      "w1",
      "Push A",
      expect.arrayContaining([expect.objectContaining({ exerciseId: "e1", load: 105 })])
    );
  });

  it("confirming without any edits submits the proposed numbers as-is", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <SessionDetailPanel date="2026-08-20" dayLabel="Today" workout={WORKOUT} alreadyConfirmed={false} onConfirm={onConfirm} />
    );
    await user.click(screen.getByRole("button", { name: /Confirm Push A/ }));
    expect(onConfirm).toHaveBeenCalledWith("2026-08-20", "w1", "Push A", [
      { exerciseId: "e1", exerciseName: "Cable Press", position: 1, sets: 3, reps: 10, load: 100 },
      { exerciseId: "e2", exerciseName: "Pull-ups", position: 2, sets: 3, reps: 8, load: null },
    ]);
  });

  it("an already-confirmed day shows a confirmed note instead of the Confirm button, with numbers disabled not hidden", () => {
    render(
      <SessionDetailPanel date="2026-08-20" dayLabel="Today" workout={WORKOUT} alreadyConfirmed={true} onConfirm={vi.fn()} />
    );
    expect(screen.getByTestId("session-confirmed-note")).toHaveTextContent("Confirmed for Today.");
    expect(screen.queryByRole("button", { name: /Confirm Push A/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Cable Press sets")).toBeDisabled();
  });

  it("confirming flips to the confirmed note without a page reload (local state)", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <SessionDetailPanel date="2026-08-20" dayLabel="Today" workout={WORKOUT} alreadyConfirmed={false} onConfirm={onConfirm} />
    );
    await user.click(screen.getByRole("button", { name: /Confirm Push A/ }));
    expect(await screen.findByTestId("session-confirmed-note")).toBeInTheDocument();
  });
});
