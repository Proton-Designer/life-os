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
});
