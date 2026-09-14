import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { GradeScenarioPanel } from "../grade-scenario-panel";
import type { AssessmentGradeRow } from "@/lib/school/grades/grade-ledger";

function row(overrides: Partial<AssessmentGradeRow> = {}): AssessmentGradeRow {
  return { id: "a1", weightPct: null, pointsEarned: null, pointsPossible: null, isExcused: false, categoryId: null, ...overrides };
}

describe("GradeScenarioPanel", () => {
  it("renders nothing when every category is already resolved (or none exist)", () => {
    const { container } = render(<GradeScenarioPanel assessments={[]} categories={[]} targetGradePct={90} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one input per unresolved synthetic (single-assessment) category, and a prompt to set a target", () => {
    render(
      <GradeScenarioPanel
        assessments={[row({ id: "midterm", weightPct: 40 }), row({ id: "final", weightPct: 60 })]}
        categories={[]}
        targetGradePct={null}
      />
    );
    expect(screen.getByRole("heading", { name: "What-if" })).toBeInTheDocument();
    expect(screen.getByLabelText(/hypothetical score for midterm/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/hypothetical score for final/i)).toBeInTheDocument();
    expect(screen.getByText(/set a target grade/i)).toBeInTheDocument();
  });

  // Mirrors scenario.test.ts's own worked example exactly (computeScenario's existing,
  // previously-uncalled test) so this UI is proven against the same numbers the engine
  // itself is proven against — 40% already resolved at 90%, hypothesizing 85% on a 30%
  // category needs 95% on the last 30% to hit a 90 target.
  it("typing a hypothetical for one category solves the required score on what's left, using the real engine", async () => {
    const user = userEvent.setup();
    render(
      <GradeScenarioPanel
        assessments={[
          row({ id: "resolved", weightPct: 40, pointsEarned: 90, pointsPossible: 100 }),
          row({ id: "exam3", weightPct: 30 }),
          row({ id: "final", weightPct: 30 }),
        ]}
        categories={[]}
        targetGradePct={90}
      />
    );

    await user.type(screen.getByLabelText(/hypothetical score for exam3/i), "85");

    expect(await screen.findByText(/final \(single assessment\): 95\.0%/i)).toBeInTheDocument();
  });

  it("shows a final-grade verdict once every remaining category has a hypothetical", async () => {
    const user = userEvent.setup();
    render(
      <GradeScenarioPanel
        assessments={[
          row({ id: "resolved", weightPct: 40, pointsEarned: 90, pointsPossible: 100 }),
          row({ id: "exam3", weightPct: 30 }),
          row({ id: "final", weightPct: 30 }),
        ]}
        categories={[]}
        targetGradePct={90}
      />
    );

    await user.type(screen.getByLabelText(/hypothetical score for exam3/i), "85");
    await user.type(screen.getByLabelText(/hypothetical score for final/i), "96");

    expect(await screen.findByText(/final grade would be 90\.3% — target met/i)).toBeInTheDocument();
  });
});
