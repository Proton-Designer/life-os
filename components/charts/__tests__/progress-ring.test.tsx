import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressRing } from "../progress-ring";

describe("ProgressRing", () => {
  it("renders the rounded percentage", () => {
    render(<ProgressRing pct={42.6} colorVar="--accent-deen" />);
    expect(screen.getByText("43%")).toBeInTheDocument();
  });

  it("does not crash at 0%", () => {
    render(<ProgressRing pct={0} colorVar="--accent-deen" />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("does not crash at 100%", () => {
    render(<ProgressRing pct={100} colorVar="--accent-deen" />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("clamps an out-of-range value rather than drawing a broken arc", () => {
    render(<ProgressRing pct={140} colorVar="--accent-deen" />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("renders a muted dash with an explanatory label when nothing is tracked, not 0%", () => {
    render(<ProgressRing pct={null} colorVar="--accent-deen" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Not tracked today" })).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  // 2026-08-26 (Opus Lead ruling): shared by the Salah calendar and the
  // kill-list history view, both of which need "N/M" in the center
  // instead of a percentage.
  it("shows centerLabel instead of the percentage when provided", () => {
    render(<ProgressRing pct={60} colorVar="--accent-deen" centerLabel="3/5" />);
    expect(screen.getByText("3/5")).toBeInTheDocument();
    expect(screen.queryByText("60%")).not.toBeInTheDocument();
  });

  it("shows centerLabel instead of the dash at pct === null", () => {
    render(<ProgressRing pct={null} colorVar="--accent-deen" centerLabel="0/5" />);
    expect(screen.getByText("0/5")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });
});
