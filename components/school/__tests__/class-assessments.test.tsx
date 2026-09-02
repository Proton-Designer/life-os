import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ClassAssessments, type ClassAssessment } from "../class-assessments";

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
  return { id, name, type: "quiz", date, task_id: null, risk: { score, band: score >= 50 ? "high" : "low", confidence } };
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
  });

  it("orders multiple insufficient-confidence items by date among themselves", () => {
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
