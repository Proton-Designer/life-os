import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ClassAssessments, type ClassAssessment } from "../class-assessments";
import { buildAssessmentRiskInput } from "@/lib/school/risk/build-assessment-risk-input";
import { computeAssignmentRisk } from "@/lib/school/risk/assignment-risk";

// Batch 3 (2026-08-26 afternoon) rewrite: ClassAssessments no longer talks
// to the server or holds its own list — it's a pure staged-state renderer,
// so these tests exercise the onAdd/onUpdate/onRemove contract directly
// rather than mocking class-actions.

function assessment(overrides: Partial<ClassAssessment> = {}): ClassAssessment {
  return {
    id: "a1",
    name: "Midterm",
    type: "midterm_final",
    date: "2026-10-06",
    task_id: "t1",
    weightPct: null,
    risk: { score: 0, band: "low", confidence: "moderate" },
    ...overrides,
  };
}

describe("ClassAssessments", () => {
  it("renders rows read-only when not editing, but Add is still available (Add isn't staged)", () => {
    render(
      <ClassAssessments
        assessments={[assessment()]}
        editing={false}
        todayStr="2026-08-26"
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.getByText("Midterm")).toBeInTheDocument();
    // Short badge form in the read-only row — the full "Midterm/Final"
    // label is what's crushing the Name column on mobile (Opus Lead review).
    expect(screen.getByText("Mid/Final")).toBeInTheDocument();
    // Rendered through formatShortDate, never the raw ISO string.
    expect(screen.getByText("Oct. 6th")).toBeInTheDocument();
    expect(screen.queryByText("2026-10-06")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add assessment" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  // R7 capture, production, 2026-09-02 (fixture seed-domains@lifeos.test): at 390px the
  // Name column was clipped to "Midter…"/"Reacti…" while Type/Date/Conf rendered in
  // full. jsdom has no real layout engine, so this can only confirm the full name is
  // still IN THE DOCUMENT on its own line, not that it visually fits at 390px — the
  // LifeOS lead's scrollWidth-vs-clientWidth check against the live page is the actual
  // gate for that, and he re-captures once this lands.
  it("renders a long real-world name in full, not the ISO date or type crowding it off its own line", () => {
    const longName = "Midterm Exam 2 — Stereochemistry";
    render(
      <ClassAssessments
        assessments={[assessment({ name: longName })]}
        editing={false}
        todayStr="2026-08-26"
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.getByText(longName)).toBeInTheDocument();
    // Name and its meta are siblings on separate lines, not columns in one row — the
    // structural half of the fix (metaBelow-style), independent of pixel measurement.
    const nameEl = screen.getByText(longName);
    const metaEl = screen.getByText("Mid/Final");
    expect(nameEl.parentElement).toBe(metaEl.parentElement?.parentElement);
    expect(nameEl.parentElement?.className).toContain("flex-col");
  });

  it("shows the empty message when there are zero assessments", () => {
    render(
      <ClassAssessments
        assessments={[]}
        editing={false}
        todayStr="2026-08-26"
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.getByText("No assessments yet.")).toBeInTheDocument();
  });

  it("shows the Add button and inline-editable fields once editing, and Remove calls onRemove", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <ClassAssessments
        assessments={[assessment()]}
        editing
        todayStr="2026-08-26"
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={onRemove}
      />
    );
    expect(screen.getByRole("button", { name: "Add assessment" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name for Midterm" })).toHaveValue("Midterm");

    await user.click(screen.getByRole("button", { name: "Remove Midterm" }));
    expect(onRemove).toHaveBeenCalledWith("a1");
  });

  it("editing the inline name field calls onUpdate with the patch, not a full row replace", async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    render(
      <ClassAssessments
        assessments={[assessment({ name: "Q" })]}
        editing
        todayStr="2026-08-26"
        onAdd={vi.fn()}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
      />
    );
    await user.type(screen.getByRole("textbox", { name: "Name for Q" }), "!");
    expect(onUpdate).toHaveBeenCalledWith("a1", { name: "Q!" });
  });

  // R35's UI follow-up (The Boss, 2026-09-02): weight_pct entry on the editing row, editing
  // the cause (weight) rather than the derived effect (confidence) — see the input's own
  // comment on why it doesn't recompute the row's confidence live.
  describe("weight entry", () => {
    it("editing the weight field stages a numeric patch", () => {
      const onUpdate = vi.fn();
      render(
        <ClassAssessments
          assessments={[assessment({ weightPct: null })]}
          editing
          todayStr="2026-08-26"
          onAdd={vi.fn()}
          onUpdate={onUpdate}
          onRemove={vi.fn()}
        />
      );
      fireEvent.change(screen.getByRole("spinbutton", { name: "Weight for Midterm" }), { target: { value: "60" } });
      expect(onUpdate).toHaveBeenCalledWith("a1", { weightPct: 60 });
    });

    it("clearing the weight field stages null, never a real zero — unknown and 0% are different claims", () => {
      const onUpdate = vi.fn();
      render(
        <ClassAssessments
          assessments={[assessment({ weightPct: 40 })]}
          editing
          todayStr="2026-08-26"
          onAdd={vi.fn()}
          onUpdate={onUpdate}
          onRemove={vi.fn()}
        />
      );
      fireEvent.change(screen.getByRole("spinbutton", { name: "Weight for Midterm" }), { target: { value: "" } });
      expect(onUpdate).toHaveBeenCalledWith("a1", { weightPct: null });
    });

    it("clamps an out-of-range weight to migration 105's own CHECK bounds (0-100)", () => {
      const onUpdate = vi.fn();
      render(
        <ClassAssessments
          assessments={[assessment({ weightPct: null })]}
          editing
          todayStr="2026-08-26"
          onAdd={vi.fn()}
          onUpdate={onUpdate}
          onRemove={vi.fn()}
        />
      );
      const input = screen.getByRole("spinbutton", { name: "Weight for Midterm" });
      fireEvent.change(input, { target: { value: "150" } });
      expect(onUpdate).toHaveBeenLastCalledWith("a1", { weightPct: 100 });
      fireEvent.change(input, { target: { value: "-5" } });
      expect(onUpdate).toHaveBeenLastCalledWith("a1", { weightPct: 0 });
    });

    it("ignores non-numeric weight input rather than staging NaN", () => {
      const onUpdate = vi.fn();
      render(
        <ClassAssessments
          assessments={[assessment({ weightPct: null })]}
          editing
          todayStr="2026-08-26"
          onAdd={vi.fn()}
          onUpdate={onUpdate}
          onRemove={vi.fn()}
        />
      );
      fireEvent.change(screen.getByRole("spinbutton", { name: "Weight for Midterm" }), { target: { value: "abc" } });
      expect(onUpdate).not.toHaveBeenCalled();
    });
  });

  it("Add asks type first, then name+date, and stages via onAdd rather than calling the server", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(
      <ClassAssessments assessments={[]} editing todayStr="2026-08-26" onAdd={onAdd} onUpdate={vi.fn()} onRemove={vi.fn()} />
    );
    await user.click(screen.getByRole("button", { name: "Add assessment" }));
    expect(screen.getByText("Assessment type")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Quiz" }));
    expect(screen.getByText("Quiz details")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Name"), "Reading check");
    const dateInputs = screen.getAllByDisplayValue("");
    await user.type(dateInputs[0], "2026-09-15");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onAdd).toHaveBeenCalledWith({ name: "Reading check", type: "quiz", date: "2026-09-15" });
    // The type/details forms are gone again once submitted.
    expect(screen.queryByText("Quiz details")).not.toBeInTheDocument();
  });

  it("shows the linked-task removal note only while editing and only when a row has a task_id", () => {
    const { rerender } = render(
      <ClassAssessments
        assessments={[assessment({ task_id: "t1" })]}
        editing
        todayStr="2026-08-26"
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.getByText("Removing an assessment also removes its linked task.")).toBeInTheDocument();

    rerender(
      <ClassAssessments
        assessments={[assessment({ task_id: "t1" })]}
        editing={false}
        todayStr="2026-08-26"
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.queryByText("Removing an assessment also removes its linked task.")).not.toBeInTheDocument();

    rerender(
      <ClassAssessments
        assessments={[assessment({ task_id: null })]}
        editing
        todayStr="2026-08-26"
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.queryByText("Removing an assessment also removes its linked task.")).not.toBeInTheDocument();
  });
});

function rankedAssessment(
  id: string,
  name: string,
  date: string,
  score: number,
  confidence: ClassAssessment["risk"]["confidence"] = "moderate"
): ClassAssessment {
  return { id, name, type: "quiz", date, task_id: null, weightPct: null, risk: { score, band: score >= 50 ? "high" : "low", confidence } };
}

// R28 (The Boss, 2026-09-02): confidence stays OUT of the sort key within one list, but
// drives grouping — `insufficient`-confidence items fall to the bottom with a prompt,
// and every row shows its confidence. RED TEST history: before this ranking existed at
// all, ClassAssessments had no `risk` field and no notion of order beyond the array it
// was handed — 3/3 failed on that code (two on order, one on the missing copy). The
// original design gated ranking on a boolean prop derived from the class's difficulty
// rating; R28 replaced that with per-item `confidence`, so these tests target the
// current (confidence-driven) contract directly.
describe("ClassAssessments — confidence-based ranking (R28)", () => {
  it("ranks confidence >= low items by risk score, date as tiebreak — even when a higher-risk item is due later", () => {
    const items = [
      rankedAssessment("a", "Low-risk quiz due first", "2026-09-01", 10, "low"),
      rankedAssessment("b", "High-risk final due later", "2026-09-10", 90, "low"),
    ];
    render(
      <ClassAssessments assessments={items} editing={false} todayStr="2026-08-20" onAdd={() => {}} onUpdate={() => {}} onRemove={() => {}} />
    );
    const rows = screen.getAllByTestId(/^assessment-row-/);
    // b scores higher risk than a, despite being LATER by date — proves ranking is by
    // risk, not by the array/date order it was handed (the exact 8d77e73 sort-then-slice
    // failure mode: risk that only ever reorders within a date-sorted set is not risk-ranked).
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(["assessment-row-b", "assessment-row-a"]);
  });

  it("date breaks a tie in risk score among ranked items", () => {
    const items = [
      rankedAssessment("a", "Same risk, later date", "2026-09-10", 50, "moderate"),
      rankedAssessment("b", "Same risk, earlier date", "2026-09-01", 50, "moderate"),
    ];
    render(
      <ClassAssessments assessments={items} editing={false} todayStr="2026-08-20" onAdd={() => {}} onUpdate={() => {}} onRemove={() => {}} />
    );
    const rows = screen.getAllByTestId(/^assessment-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(["assessment-row-b", "assessment-row-a"]);
  });

  it("groups insufficient-confidence items at the bottom regardless of score or date, and shows the prompt", () => {
    const items = [
      // Earlier date AND a higher raw score than the ranked item below — neither should
      // matter, because its confidence can't support a rank claim.
      rankedAssessment("insufficient-item", "Unrated, due first, scores high", "2026-08-25", 99, "insufficient"),
      rankedAssessment("ranked-item", "Rated, due later, scores low", "2026-09-15", 5, "low"),
    ];
    render(
      <ClassAssessments assessments={items} editing={false} todayStr="2026-08-20" onAdd={() => {}} onUpdate={() => {}} onRemove={() => {}} />
    );
    const rows = screen.getAllByTestId(/^assessment-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "assessment-row-ranked-item",
      "assessment-row-insufficient-item",
    ]);
    expect(screen.getByText("rate difficulty to rank this")).toBeInTheDocument();
    // Mixed state uses the per-group prompt, not the whole-list caption — see the two-copy
    // ruling in class-assessments.tsx's own comment.
    expect(screen.queryByText("ranked by due date until you rate difficulty.")).not.toBeInTheDocument();
  });

  // Tied scores + "wrong" input array order, deliberately: with the real engine, two
  // insufficient-confidence items in one class can never have conflicting date/score
  // order (proximity is monotonic — closer due date never scores lower, holding
  // everything else fixed — see assignment-risk.test.ts), so this property can only be
  // isolated with synthetic data. A stable sort keyed on score alone would leave a tie
  // in ARRAY order (the "wrong" order below); only a real date-tiebreak fixes it.
  it("orders multiple insufficient-confidence items by date among themselves, not array order", () => {
    const items = [
      rankedAssessment("later", "Insufficient, later date", "2026-09-10", 0, "insufficient"),
      rankedAssessment("earlier", "Insufficient, earlier date", "2026-09-01", 0, "insufficient"),
    ];
    render(
      <ClassAssessments assessments={items} editing={false} todayStr="2026-08-20" onAdd={() => {}} onUpdate={() => {}} onRemove={() => {}} />
    );
    const rows = screen.getAllByTestId(/^assessment-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(["assessment-row-earlier", "assessment-row-later"]);
  });

  it("shows no insufficient-group prompt when every item is confidently ranked", () => {
    const items = [rankedAssessment("a", "Rated quiz", "2026-09-01", 40, "low")];
    render(
      <ClassAssessments assessments={items} editing={false} todayStr="2026-08-20" onAdd={() => {}} onUpdate={() => {}} onRemove={() => {}} />
    );
    expect(screen.queryByText("rate difficulty to rank this")).not.toBeInTheDocument();
    expect(screen.queryByText("ranked by due date until you rate difficulty.")).not.toBeInTheDocument();
  });

  // Still the universal state in production today even after R35 (Lead review,
  // 2026-09-02): no rating-capture or weight-entry UI exists yet, so every class is
  // unrated AND every assessment is unweighted — everything is insufficient until both
  // ship. See the "R35" describe block below for the now-reachable mixed case.
  it("when every item is insufficient, shows the whole-list caption instead of the per-group prompt, and falls back to date order", () => {
    const items = [
      rankedAssessment("later", "Unrated, later date, higher raw score", "2026-09-10", 99, "insufficient"),
      rankedAssessment("earlier", "Unrated, earlier date, lower raw score", "2026-09-01", 1, "insufficient"),
    ];
    render(
      <ClassAssessments assessments={items} editing={false} todayStr="2026-08-20" onAdd={() => {}} onUpdate={() => {}} onRemove={() => {}} />
    );
    expect(screen.getByText("ranked by due date until you rate difficulty.")).toBeInTheDocument();
    expect(screen.queryByText("rate difficulty to rank this")).not.toBeInTheDocument();
    const rows = screen.getAllByTestId(/^assessment-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(["assessment-row-earlier", "assessment-row-later"]);
  });

  it.each([
    ["high", "High"],
    ["moderate", "Mod"],
    ["low", "Low"],
    ["insufficient", "None"],
  ] as const)("shows a %s-confidence badge on every row, not just insufficient ones", (confidence, label) => {
    render(
      <ClassAssessments
        assessments={[rankedAssessment("a", "Some assessment", "2026-09-01", 30, confidence)]}
        editing={false}
        todayStr="2026-08-20"
        onAdd={() => {}}
        onUpdate={() => {}}
        onRemove={() => {}}
      />
    );
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

// R35 (2026-09-02): weight became excludable, so weightPct now varies per-assessment
// confidence within one class — the mixed group the R28 tests above could only reach
// synthetically is real now. These derive `risk` from the ACTUAL engine
// (buildAssessmentRiskInput + computeAssignmentRisk), not a hand-picked confidence, to
// prove the split is real and not assumed.
function realAssessment(id: string, name: string, date: string, weightPct: number | null): ClassAssessment {
  // A rated class with a projection — the shape that makes weighted read `moderate` and
  // unweighted read `insufficient` (verified by the assertions below before rendering).
  const input = buildAssessmentRiskInput({
    today: "2026-08-20",
    dueDate: date,
    weightPct,
    difficultyRating: 3,
    confidenceRating: 3,
    targetGradePct: 90,
    projectedGradePct: 85,
  });
  const { score, band, confidence } = computeAssignmentRisk(input);
  return { id, name, type: "quiz", date, task_id: null, weightPct, risk: { score, band, confidence } };
}

describe("ClassAssessments — R35: the mixed confidence group is now reachable through the real engine", () => {
  it("one weighted and one unweighted assessment in the same rated+projected class land in different confidence groups — even when the unweighted one scores higher", () => {
    // Deliberately adversarial (values found by probing the real engine, not guessed):
    // the unweighted item is due SOONER and scores HIGHER than the weighted one. A naive
    // "sort by score" would rank it first; only real confidence-based grouping puts the
    // properly-evidenced item on top regardless.
    const weighted = realAssessment("weighted", "Weighted quiz, due later, low weight", "2026-09-20", 5);
    const unweighted = realAssessment("unweighted", "Unweighted quiz, due sooner", "2026-09-01", null);
    // Confirm the premise against the real engine before asserting on the UI: this split
    // was structurally impossible before R35 (weight was never excludable) — see the
    // unreachable-branch note this scenario retires in class-assessments.tsx.
    expect(weighted.risk.confidence).toBe("moderate");
    expect(unweighted.risk.confidence).toBe("insufficient");
    expect(unweighted.risk.score).toBeGreaterThan(weighted.risk.score); // the adversarial part

    render(
      <ClassAssessments
        assessments={[unweighted, weighted]}
        editing={false}
        todayStr="2026-08-20"
        onAdd={() => {}}
        onUpdate={() => {}}
        onRemove={() => {}}
      />
    );
    const rows = screen.getAllByTestId(/^assessment-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(["assessment-row-weighted", "assessment-row-unweighted"]);
    expect(screen.getByText("rate difficulty to rank this")).toBeInTheDocument();
  });

  // A real-data integration check, not a tiebreak-isolation proof: proximity is
  // monotonic (assignment-risk.test.ts), so two same-shaped rows differing only by date
  // can never have their score order disagree with their date order — the synthetic
  // "orders multiple insufficient-confidence items by date among themselves, not array
  // order" test above is what actually isolates the tiebreak rule from the score.
  it("two unweighted assessments in the same class both land insufficient, and order by date among themselves", () => {
    const later = realAssessment("later", "Unweighted, later date", "2026-09-10", null);
    const earlier = realAssessment("earlier", "Unweighted, earlier date", "2026-09-01", null);
    expect(later.risk.confidence).toBe("insufficient");
    expect(earlier.risk.confidence).toBe("insufficient");

    render(
      <ClassAssessments
        assessments={[later, earlier]}
        editing={false}
        todayStr="2026-08-20"
        onAdd={() => {}}
        onUpdate={() => {}}
        onRemove={() => {}}
      />
    );
    const rows = screen.getAllByTestId(/^assessment-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(["assessment-row-earlier", "assessment-row-later"]);
  });
});
