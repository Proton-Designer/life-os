import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BodyModule } from "../body-module";

describe("BodyModule", () => {
  it("always renders both weight and waist lines together", () => {
    render(<BodyModule weightAvg7d={158} waist={{ valueIn: 32.5, date: "2026-08-06" }} />);
    expect(screen.getByText("Weight")).toBeInTheDocument();
    expect(screen.getByText("Waist")).toBeInTheDocument();
    expect(screen.getByText("158 lb")).toBeInTheDocument();
    expect(screen.getByText("32.5 in")).toBeInTheDocument();
  });

  it("shows weight as the 7-day average, never a raw-value label", () => {
    render(<BodyModule weightAvg7d={158} waist={null} />);
    expect(screen.getByText("7-day avg")).toBeInTheDocument();
  });

  it("shows an honest dash rather than a fabricated number when no weight is logged yet", () => {
    render(<BodyModule weightAvg7d={null} waist={{ valueIn: 32.5, date: "2026-08-06" }} />);
    const weightRow = screen.getByText("Weight").closest("div");
    expect(weightRow).toHaveTextContent("—");
  });

  it("shows an honest dash for waist when none logged, without hiding the weight line", () => {
    render(<BodyModule weightAvg7d={158} waist={null} />);
    expect(screen.getByText("Weight")).toBeInTheDocument();
    expect(screen.getByText("Waist")).toBeInTheDocument();
    const waistRow = screen.getByText("Waist").closest("div");
    expect(waistRow).toHaveTextContent("—");
  });

  it("both lines still render when neither has data — no props exist that could hide one alone", () => {
    render(<BodyModule weightAvg7d={null} waist={null} />);
    expect(screen.getByText("Weight")).toBeInTheDocument();
    expect(screen.getByText("Waist")).toBeInTheDocument();
  });

  it("shows the one static diet-outcome sentence", () => {
    render(<BodyModule weightAvg7d={null} waist={null} />);
    expect(screen.getByText(/Body fat is mostly a diet outcome/)).toBeInTheDocument();
  });

  // Regression, caught live: a plain calendar date rendered through
  // toLocaleDateString with no timeZone reads the process's local system
  // clock, rolling a UTC-midnight date back a day in any negative-offset
  // zone (this sandbox is America/Chicago — "2026-08-20" displayed as
  // "Aug 19" before pinning timeZone: "UTC"). Must hold regardless of
  // where the test runner's TZ happens to be.
  it("shows the waist date as the calendar day it was logged, not a day earlier under a negative UTC offset", () => {
    render(<BodyModule weightAvg7d={null} waist={{ valueIn: 32.5, date: "2026-08-20" }} />);
    expect(screen.getByText("Aug 20")).toBeInTheDocument();
    expect(screen.queryByText("Aug 19")).not.toBeInTheDocument();
  });
});
