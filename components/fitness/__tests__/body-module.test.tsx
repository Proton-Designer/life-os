import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BodyModule } from "../body-module";

function noopHandlers() {
  return {
    onLogWeight: vi.fn().mockResolvedValue(undefined),
    onLogWaist: vi.fn().mockResolvedValue(undefined),
  };
}

describe("BodyModule", () => {
  it("always renders both weight and waist lines together", () => {
    render(<BodyModule weightAvg7d={158} waist={{ valueIn: 32.5, date: "2026-08-06" }} {...noopHandlers()} />);
    expect(screen.getByText("Weight")).toBeInTheDocument();
    expect(screen.getByText("Waist")).toBeInTheDocument();
    expect(screen.getByText("158 lb")).toBeInTheDocument();
    expect(screen.getByText("32.5 in")).toBeInTheDocument();
  });

  it("shows weight as the 7-day average, never a raw-value label", () => {
    render(<BodyModule weightAvg7d={158} waist={null} {...noopHandlers()} />);
    expect(screen.getByText("7-day avg")).toBeInTheDocument();
  });

  it("shows an honest dash rather than a fabricated number when no weight is logged yet", () => {
    render(<BodyModule weightAvg7d={null} waist={{ valueIn: 32.5, date: "2026-08-06" }} {...noopHandlers()} />);
    const weightRow = screen.getByText("Weight").closest("div");
    expect(weightRow).toHaveTextContent("—");
  });

  it("shows an honest dash for waist when none logged, without hiding the weight line", () => {
    render(<BodyModule weightAvg7d={158} waist={null} {...noopHandlers()} />);
    expect(screen.getByText("Weight")).toBeInTheDocument();
    expect(screen.getByText("Waist")).toBeInTheDocument();
    const waistRow = screen.getByText("Waist").closest("div");
    expect(waistRow).toHaveTextContent("—");
  });

  it("both lines still render when neither has data — no props exist that could hide one alone", () => {
    render(<BodyModule weightAvg7d={null} waist={null} {...noopHandlers()} />);
    expect(screen.getByText("Weight")).toBeInTheDocument();
    expect(screen.getByText("Waist")).toBeInTheDocument();
  });

  it("shows the one static diet-outcome sentence", () => {
    render(<BodyModule weightAvg7d={null} waist={null} {...noopHandlers()} />);
    expect(screen.getByText(/Body fat is mostly a diet outcome/)).toBeInTheDocument();
  });

  // Regression, caught live: a plain calendar date rendered through
  // toLocaleDateString with no timeZone reads the process's local system
  // clock, rolling a UTC-midnight date back a day in any negative-offset
  // zone (this sandbox is America/Chicago — "2026-08-20" displayed as
  // "Aug 19" before pinning timeZone: "UTC"). Must hold regardless of
  // where the test runner's TZ happens to be.
  it("shows the waist date as the calendar day it was logged, not a day earlier under a negative UTC offset", () => {
    render(<BodyModule weightAvg7d={null} waist={{ valueIn: 32.5, date: "2026-08-20" }} {...noopHandlers()} />);
    expect(screen.getByText("Aug 20")).toBeInTheDocument();
    expect(screen.queryByText("Aug 19")).not.toBeInTheDocument();
  });

  // 2026-08-25/26 batch 2, item 3: weight/waist stay loggable ON DEMAND
  // from here — "keep them there, when i want to do it I will" — with no
  // task semantics (no "due" state, logging today doesn't remove the
  // button, there's no daily reset).
  describe("on-demand logging", () => {
    it("each row has its own Log button, independent of the other", () => {
      render(<BodyModule weightAvg7d={158} waist={{ valueIn: 32.5, date: "2026-08-06" }} {...noopHandlers()} />);
      expect(screen.getAllByRole("button", { name: "Log" })).toHaveLength(2);
    });

    it("tapping weight's Log button opens a popup with a focused input and a Save button", async () => {
      const handlers = noopHandlers();
      const user = userEvent.setup();
      render(<BodyModule weightAvg7d={null} waist={null} {...handlers} />);

      const [weightLog] = screen.getAllByRole("button", { name: "Log" });
      await user.click(weightLog);

      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("Log today's weight");
      const input = screen.getByLabelText("Weight (lb)");
      expect(input).toHaveFocus();

      await user.type(input, "182");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(handlers.onLogWeight).toHaveBeenCalledWith(182);
    });

    it("tapping waist's Log button opens a popup for waist specifically, not weight", async () => {
      const handlers = noopHandlers();
      const user = userEvent.setup();
      render(<BodyModule weightAvg7d={null} waist={null} {...handlers} />);

      const [, waistLog] = screen.getAllByRole("button", { name: "Log" });
      await user.click(waistLog);

      expect(screen.getByRole("dialog")).toHaveTextContent("Log waist");
      const input = screen.getByLabelText("Waist (in)");
      await user.type(input, "33");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(handlers.onLogWaist).toHaveBeenCalledWith(33);
      expect(handlers.onLogWeight).not.toHaveBeenCalled();
    });

    it("Enter in the popup's input submits, same as pressing Save", async () => {
      const handlers = noopHandlers();
      const user = userEvent.setup();
      render(<BodyModule weightAvg7d={null} waist={null} {...handlers} />);

      await user.click(screen.getAllByRole("button", { name: "Log" })[0]);
      const input = screen.getByLabelText("Weight (lb)");
      await user.type(input, "180{Enter}");

      expect(handlers.onLogWeight).toHaveBeenCalledWith(180);
    });

    it("logging weight does not remove or disable the Log button — no daily-task semantics", async () => {
      const handlers = noopHandlers();
      const user = userEvent.setup();
      render(<BodyModule weightAvg7d={158} waist={null} {...handlers} />);

      await user.click(screen.getAllByRole("button", { name: "Log" })[0]);
      await user.type(screen.getByLabelText("Weight (lb)"), "182");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Log" })).toHaveLength(2); // still there, still enabled — no daily-task removal
    });
  });
});
