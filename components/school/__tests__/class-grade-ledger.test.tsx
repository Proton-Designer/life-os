import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClassGradeLedger, type GradeLedgerAssessment } from "../class-grade-ledger";

function assessment(overrides: Partial<GradeLedgerAssessment> = {}): GradeLedgerAssessment {
  return {
    id: "a1",
    name: "Midterm",
    type: "midterm_final",
    date: "2026-10-06",
    taskId: "t1",
    risk: { score: 0, band: "low", confidence: "moderate" },
    weightPct: 25,
    pointsEarned: null,
    pointsPossible: null,
    isExcused: false,
    ...overrides,
  };
}

describe("ClassGradeLedger — the empty-state majority case", () => {
  it("shows a distinct message with zero assessments, not a blank panel", () => {
    render(<ClassGradeLedger assessments={[]} targetGradePct={null} />);
    expect(screen.getByText(/no assessments yet/i)).toBeInTheDocument();
  });

  it("distinguishes 'assessments exist, none graded' from 'no assessments at all', and never renders a zero", () => {
    render(
      <ClassGradeLedger
        assessments={[
          assessment({ id: "a1", name: "Midterm", pointsEarned: null, pointsPossible: null }),
          assessment({ id: "a2", name: "Final", pointsEarned: null, pointsPossible: null }),
        ]}
        targetGradePct={null}
      />
    );
    expect(screen.getByText(/no grade yet/i)).toBeInTheDocument();
    expect(screen.getByText("Midterm")).toBeInTheDocument();
    expect(screen.getAllByText(/not graded yet/i)).toHaveLength(2);
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText(/^0\.0%$/)).not.toBeInTheDocument();
  });
});

describe("ClassGradeLedger — a real graded assessment", () => {
  it("renders the actual computed percentage, not a placeholder", () => {
    render(
      <ClassGradeLedger
        assessments={[
          assessment({ id: "a1", name: "Midterm", weightPct: 100, pointsEarned: 45, pointsPossible: 50 }),
        ]}
        targetGradePct={null}
      />
    );
    // Appears twice: once in the summary line, once in the assessment's own row.
    expect(screen.getAllByText("90.0%")).toHaveLength(2);
    expect(screen.getByText(/current/)).toBeInTheDocument();
  });
});

describe("ClassGradeLedger — excused and unweighted rows read distinctly", () => {
  it("labels an excused row 'Excused' rather than a score, and an unweighted row 'No weight set'", () => {
    render(
      <ClassGradeLedger
        assessments={[
          assessment({ id: "a1", name: "Pop Quiz", isExcused: true, pointsEarned: 2, pointsPossible: 10 }),
          assessment({ id: "a2", name: "Draft Essay", weightPct: null, pointsEarned: null, pointsPossible: null }),
          assessment({ id: "a3", name: "Homework 1", weightPct: 100, pointsEarned: 40, pointsPossible: 40 }),
        ]}
        targetGradePct={null}
      />
    );
    expect(screen.getByText("Excused")).toBeInTheDocument();
    expect(screen.getByText("No weight set")).toBeInTheDocument();
    // The excused and unweighted rows must not participate in the visible
    // current grade — Homework 1 alone is 100%. Appears twice: once in the
    // summary line, once in Homework 1's own row.
    expect(screen.getAllByText("100.0%")).toHaveLength(2);
  });
});

describe("ClassGradeLedger — required-score verdict", () => {
  it("prompts to set a target rather than showing any number when none is set", () => {
    render(
      <ClassGradeLedger
        assessments={[assessment({ id: "a1", weightPct: 30, pointsEarned: 80.7, pointsPossible: 100 })]}
        targetGradePct={null}
      />
    );
    expect(screen.getByText(/set a target grade/i)).toBeInTheDocument();
  });

  it("target 90, current 80.7% at 30% weight, 70% remaining: states the exact required percentage", () => {
    render(
      <ClassGradeLedger
        assessments={[
          assessment({ id: "a1", name: "Resolved so far", weightPct: 30, pointsEarned: 80.7, pointsPossible: 100 }),
          assessment({ id: "a2", name: "The rest", weightPct: 70, pointsEarned: null, pointsPossible: null }),
        ]}
        targetGradePct={90}
      />
    );
    expect(screen.getByText("Need 94.0% on the rest to reach 90%.")).toBeInTheDocument();
  });

  it("says the target is already secured rather than a required percentage", () => {
    render(
      <ClassGradeLedger
        assessments={[
          assessment({ id: "a1", weightPct: 80, pointsEarned: 98, pointsPossible: 100 }),
          assessment({ id: "a2", weightPct: 20, pointsEarned: null, pointsPossible: null }),
        ]}
        targetGradePct={70}
      />
    );
    expect(screen.getByText("Already secured — 70% is locked in no matter what's left.")).toBeInTheDocument();
  });

  it("says plainly when a target isn't reachable, with the real ceiling", () => {
    render(
      <ClassGradeLedger
        assessments={[
          assessment({ id: "a1", weightPct: 80, pointsEarned: 60, pointsPossible: 100 }),
          assessment({ id: "a2", weightPct: 20, pointsEarned: null, pointsPossible: null }),
        ]}
        targetGradePct={90}
      />
    );
    expect(screen.getByText("Not reachable even with 100% on the rest — the max possible is 68.0%.")).toBeInTheDocument();
  });
});
