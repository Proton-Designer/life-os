import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { GradeScenarioPanel } from "../grade-scenario-panel";
import type { GradeLedgerAssessment } from "../class-grade-ledger";

// Deliberately UUID-shaped ids, distinct from each row's `name` — the ORIGINAL version
// of this test used readable slugs ("midterm", "final") as the id itself, which is
// exactly why it never caught the production bug (Opus Lead, live 2026-09-15): a
// synthetic category's engine-facing `name` IS the assessment's raw id
// (buildCategoriesAndItems' own contract), so a readable id made the mislabeled UUID
// look like a correctly-labeled name by coincidence. Real ids never look like this.
function row(id: string, overrides: Partial<GradeLedgerAssessment> = {}): GradeLedgerAssessment {
  return {
    id,
    name: "Untitled",
    type: "quiz",
    date: "2026-09-15",
    taskId: null,
    risk: { score: 0, band: "low", confidence: "moderate" },
    weightPct: null,
    pointsEarned: null,
    pointsPossible: null,
    isExcused: false,
    categoryId: null,
    ...overrides,
  };
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("GradeScenarioPanel", () => {
  it("renders nothing when every category is already resolved (or none exist)", () => {
    const { container } = render(<GradeScenarioPanel assessments={[]} categories={[]} targetGradePct={90} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one input per unresolved synthetic (single-assessment) category, and a prompt to set a target", () => {
    render(
      <GradeScenarioPanel
        assessments={[row("11111111-1111-4111-8111-111111111111", { name: "Midterm", weightPct: 40 }), row("22222222-2222-4222-8222-222222222222", { name: "Final", weightPct: 60 })]}
        categories={[]}
        targetGradePct={null}
      />
    );
    expect(screen.getByRole("heading", { name: "What-if" })).toBeInTheDocument();
    expect(screen.getByLabelText(/hypothetical score for midterm/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/hypothetical score for final/i)).toBeInTheDocument();
    expect(screen.getByText(/set a target grade/i)).toBeInTheDocument();
  });

  // Production bug, found live 2026-09-15 (Opus Lead): the What-if panel rendered
  // "e49e41f3-fb9c-45ac-a97d-a2454966b729 (single assessment) (50%)" instead of the
  // assessment's real name. Root cause: labelFor's lookup found the real assessment but
  // then discarded it, interpolating the raw category name (the assessment's own UUID,
  // per buildCategoriesAndItems' synthetic-category contract) instead of
  // `asAssessment.name`. This test asserts the visible label is the real name and is
  // NOT UUID-shaped — it would have failed against the pre-fix code (verified: the old
  // `${fallbackName} (single assessment)` interpolation renders the id, which matches
  // UUID_RE here).
  it("labels an unresolved single-assessment category with the assessment's real NAME, never its raw id", () => {
    render(
      <GradeScenarioPanel
        assessments={[row("e49e41f3-fb9c-45ac-a97d-a2454966b729", { name: "Final", weightPct: 50 })]}
        categories={[]}
        targetGradePct={null}
      />
    );
    const label = screen.getByLabelText(/hypothetical score for final/i);
    expect(label).toBeInTheDocument();
    const row_ = label.closest("div")!;
    expect(row_).toHaveTextContent("Final (50%)");
    expect(row_.textContent).not.toMatch(UUID_RE);
    expect(row_.textContent).not.toContain("single assessment");
  });

  // Mirrors scenario.test.ts's own worked example exactly (computeScenario's existing,
  // previously-uncalled test) so this UI is proven against the same numbers the engine
  // itself is proven against — 40% already resolved at 90%, hypothesizing 85% on a 30%
  // category needs 95% on the last 30% to hit a 90 target. Real UUID ids, real distinct
  // names — the exact shape that exposed the label bug live.
  it("typing a hypothetical for one category solves the required score on what's left, using the real engine", async () => {
    const user = userEvent.setup();
    render(
      <GradeScenarioPanel
        assessments={[
          row("aaaaaaaa-0000-4000-8000-000000000001", { name: "Quiz 1", weightPct: 40, pointsEarned: 90, pointsPossible: 100 }),
          row("bbbbbbbb-0000-4000-8000-000000000002", { name: "Midterm", weightPct: 30 }),
          row("cccccccc-0000-4000-8000-000000000003", { name: "Final", weightPct: 30 }),
        ]}
        categories={[]}
        targetGradePct={90}
      />
    );

    await user.type(screen.getByLabelText(/hypothetical score for midterm/i), "85");

    // The real name, "Final", not "cccccccc-0000-...".
    expect(await screen.findByText(/Final: 95\.0%/i)).toBeInTheDocument();
    expect(screen.queryByText(/cccccccc/i)).not.toBeInTheDocument();
  });

  it("shows a final-grade verdict once every remaining category has a hypothetical", async () => {
    const user = userEvent.setup();
    render(
      <GradeScenarioPanel
        assessments={[
          row("aaaaaaaa-0000-4000-8000-000000000001", { name: "Quiz 1", weightPct: 40, pointsEarned: 90, pointsPossible: 100 }),
          row("bbbbbbbb-0000-4000-8000-000000000002", { name: "Midterm", weightPct: 30 }),
          row("cccccccc-0000-4000-8000-000000000003", { name: "Final", weightPct: 30 }),
        ]}
        categories={[]}
        targetGradePct={90}
      />
    );

    await user.type(screen.getByLabelText(/hypothetical score for midterm/i), "85");
    await user.type(screen.getByLabelText(/hypothetical score for final/i), "96");

    expect(await screen.findByText(/final grade would be 90\.3% — target met/i)).toBeInTheDocument();
  });
});
