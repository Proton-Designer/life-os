import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const logWorkoutMock = vi.fn();
vi.mock("@/app/(app)/fitness/actions", () => ({
  logWorkout: (...args: unknown[]) => logWorkoutMock(...args),
}));

import { TodayWorkoutCard } from "../today-workout-card";

describe("TodayWorkoutCard", () => {
  it("shows the scheduled workout name and a Log it action when not yet logged", async () => {
    const user = userEvent.setup();
    render(<TodayWorkoutCard scheduledName="Push day" logged={false} date="2026-08-15" accent="fitness" />);
    expect(screen.getByText("Push day")).toBeInTheDocument();
    expect(screen.getByText("Not logged yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Log it" }));
    expect(logWorkoutMock).toHaveBeenCalledWith("2026-08-15", "Push day", "scheduled");
  });

  it("hides the log action once today's workout is logged", () => {
    render(<TodayWorkoutCard scheduledName="Push day" logged={true} date="2026-08-15" accent="fitness" />);
    expect(screen.getByText("Logged")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log it" })).not.toBeInTheDocument();
  });

  it("shows Rest day and no action when nothing is scheduled", () => {
    render(<TodayWorkoutCard scheduledName={null} logged={false} date="2026-08-15" accent="fitness" />);
    expect(screen.getByText("Rest day")).toBeInTheDocument();
    expect(screen.getByText("Nothing scheduled today")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log it" })).not.toBeInTheDocument();
  });
});
