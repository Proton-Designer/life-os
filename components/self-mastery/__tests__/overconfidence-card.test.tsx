import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OverconfidenceCard } from "../overconfidence-card";
import type { OverconfidenceVerdict } from "@/lib/self-mastery/overconfidence";

describe("OverconfidenceCard (Phase 2 #P2-08)", () => {
  it("shows the exact progress count toward the threshold when insufficient data", () => {
    const verdict: OverconfidenceVerdict = { status: "insufficient_data", sampleSize: 7, minimumRequired: 20 };
    render(<OverconfidenceCard verdict={verdict} />);
    expect(screen.getByText(/7 of 20/)).toBeInTheDocument();
  });

  it("shows a calm, non-alarming message when calibrated", () => {
    const verdict: OverconfidenceVerdict = {
      status: "calibrated",
      totalSample: 25,
      buckets: [
        { confidence: "sure", sampleSize: 15, actualCorrectRate: 0.93, belowMinimum: false },
        { confidence: "think_so", sampleSize: 5, actualCorrectRate: 0.6, belowMinimum: false },
        { confidence: "guessing", sampleSize: 5, actualCorrectRate: 0.4, belowMinimum: false },
      ],
    };
    render(<OverconfidenceCard verdict={verdict} />);
    expect(screen.getByText(/tracks your actual recall well/)).toBeInTheDocument();
  });

  it("shows the actual sure-correct-rate, rounded, in the overconfident warning", () => {
    const verdict: OverconfidenceVerdict = {
      status: "overconfident",
      totalSample: 25,
      sureActualCorrectRate: 0.503,
      buckets: [
        { confidence: "sure", sampleSize: 20, actualCorrectRate: 0.503, belowMinimum: false },
        { confidence: "think_so", sampleSize: 0, actualCorrectRate: null, belowMinimum: true },
        { confidence: "guessing", sampleSize: 5, actualCorrectRate: 1, belowMinimum: false },
      ],
    };
    render(<OverconfidenceCard verdict={verdict} />);
    expect(screen.getByText(/50%/)).toBeInTheDocument();
  });

  it("applies destructive styling only to the overconfident state, not calibrated or insufficient_data", () => {
    const overconfident: OverconfidenceVerdict = {
      status: "overconfident",
      totalSample: 25,
      sureActualCorrectRate: 0.5,
      buckets: [],
    };
    const { rerender } = render(<OverconfidenceCard verdict={overconfident} />);
    expect(screen.getByTestId("overconfidence-card").className).toContain("destructive");

    rerender(<OverconfidenceCard verdict={{ status: "insufficient_data", sampleSize: 1, minimumRequired: 20 }} />);
    expect(screen.getByTestId("overconfidence-card").className).not.toContain("destructive");

    rerender(<OverconfidenceCard verdict={{ status: "calibrated", totalSample: 20, buckets: [] }} />);
    expect(screen.getByTestId("overconfidence-card").className).not.toContain("destructive");
  });
});
