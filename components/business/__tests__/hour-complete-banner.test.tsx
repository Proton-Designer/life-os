import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HourCompleteBanner } from "../hour-complete-banner";

describe("HourCompleteBanner (Phase 2 #P2-04's in-app half)", () => {
  it("renders nothing before 60 minutes elapsed", () => {
    render(<HourCompleteBanner elapsedMinutes={59} />);
    expect(screen.queryByTestId("hour-complete-banner")).not.toBeInTheDocument();
  });

  it("appears exactly at the 60-minute mark", () => {
    render(<HourCompleteBanner elapsedMinutes={60} />);
    expect(screen.getByTestId("hour-complete-banner")).toBeInTheDocument();
  });

  it("stays visible well past 60 minutes -- not a one-tick flash", () => {
    render(<HourCompleteBanner elapsedMinutes={185} />);
    expect(screen.getByTestId("hour-complete-banner")).toBeInTheDocument();
  });

  it("dismisses on click and does not return on its own", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<HourCompleteBanner elapsedMinutes={61} />);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("hour-complete-banner")).not.toBeInTheDocument();

    rerender(<HourCompleteBanner elapsedMinutes={62} />);
    expect(screen.queryByTestId("hour-complete-banner")).not.toBeInTheDocument();
  });
});
