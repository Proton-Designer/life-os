import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ addAssessment: vi.fn(), updateAssessment: vi.fn(), removeAssessment: vi.fn() }));
vi.mock("@/app/(app)/school/assessment-actions", () => actions);
vi.mock("@/components/deen/use-optimistic-item", () => ({ useScheduleRefresh: () => () => {} }));

import { AssessmentsModule } from "../assessments-module";
import { buildAssessmentsOverview, type AssessmentsOverview } from "@/lib/school/assessments-overview";
import { resetKeyedQueuesForTests } from "@/lib/client/keyed-queue";

const TODAY = "2026-10-05";
const row = (id: string, name: string, date: string, classId = "c1", className = "BIO 101", type: "quiz" | "exam" = "quiz") => ({ id, classId, className, name, type, date, weightPct: null, taskId: `t-${id}` });
const overview = (noDate: AssessmentsOverview["noDate"] = []) =>
  buildAssessmentsOverview(
    [row("a1", "Quiz 3", "2026-10-05"), row("a2", "Midterm 1", "2026-10-06", "c2", "MATH 2418", "exam"), row("a3", "Lab report", "2026-10-20"), row("a4", "Final exam", "2026-12-10", "c2", "MATH 2418", "exam"), row("a0", "Old quiz", "2026-09-01")],
    TODAY,
    noDate
  );
const CLASSES = [
  { id: "c1", label: "BIO 101" },
  { id: "c2", label: "MATH 2418" },
];
const renderIt = (o = overview()) => render(<AssessmentsModule overview={o} classes={CLASSES} todayStr={TODAY} />);

beforeEach(() => {
  vi.clearAllMocks();
  resetKeyedQueuesForTests();
  actions.addAssessment.mockResolvedValue({ ok: true, assessmentId: "new-1", taskId: "nt-1" });
  actions.updateAssessment.mockResolvedValue({ ok: true });
  actions.removeAssessment.mockResolvedValue({ ok: true });
});

describe("AssessmentsModule (SCHOOL-02)", () => {
  it("is collapsed by default (count in the header, no rows) and expands on tap", async () => {
    const user = userEvent.setup();
    renderIt();
    expect(screen.getByTestId("assessments-module")).toHaveTextContent("4"); // past ones are not counted
    expect(screen.queryByTestId("assessments-groups")).not.toBeInTheDocument();
    expect(screen.getByTestId("assessments-toggle")).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByTestId("assessments-toggle"));
    expect(screen.getByTestId("assessments-groups")).toBeInTheDocument();
  });

  it("groups Soon / Upcoming / Future with class, name, date and 'Today' / 'Tomorrow' / 'In N days'", async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByTestId("assessments-toggle"));
    const soon = within(screen.getByTestId("assessments-group-soon"));
    expect(soon.getByText("Quiz 3")).toBeInTheDocument();
    expect(soon.getByText("Today")).toBeInTheDocument();
    expect(soon.getByText("Tomorrow")).toBeInTheDocument();
    expect(soon.getByText(/MATH 2418 · Exam/)).toBeInTheDocument();
    expect(within(screen.getByTestId("assessments-group-upcoming")).getByText("In 15 days")).toBeInTheDocument();
    expect(within(screen.getByTestId("assessments-group-future")).getByText("Final exam")).toBeInTheDocument();
    expect(screen.queryByText("Old quiz")).not.toBeInTheDocument(); // positive control: the 4 listed are the dated, upcoming ones
  });

  it("lists items still missing a date under 'No date'", async () => {
    const user = userEvent.setup();
    renderIt(overview([{ id: "u1", classId: "c1", className: "BIO 101", name: "Project (syllabus)", type: "project_paper" }]));
    await user.click(screen.getByTestId("assessments-toggle"));
    expect(within(screen.getByTestId("assessments-group-nodate")).getByText("Project (syllabus)")).toBeInTheDocument();
  });

  it("empty state when nothing is upcoming (and the Edit button is still there to add one)", async () => {
    const user = userEvent.setup();
    renderIt(buildAssessmentsOverview([], TODAY));
    await user.click(screen.getByTestId("assessments-toggle"));
    expect(screen.getByTestId("assessments-empty")).toBeInTheDocument();
    expect(screen.getByTestId("assessments-edit")).toBeInTheDocument();
  });

  it("Add: the new assessment shows up at once, the action gets absolute values, and the temp row takes the real id", async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByTestId("assessments-edit"));
    await user.click(screen.getByTestId("assessments-add-c1"));
    await user.type(screen.getByLabelText("New assessment name for BIO 101"), "Quiz 4");
    await user.clear(screen.getByLabelText("New assessment date for BIO 101"));
    await user.type(screen.getByLabelText("New assessment date for BIO 101"), "2026-10-09");
    await user.click(screen.getByTestId("assessments-add-save-c1"));
    expect(actions.addAssessment).toHaveBeenCalledWith("c1", { name: "Quiz 4", type: "quiz", date: "2026-10-09" });
    const block = within(screen.getByTestId("assessments-class-c1"));
    expect(block.getByDisplayValue("Quiz 4")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("assessment-edit-row-new-1")).toBeInTheDocument());
  });

  it("Add that fails rolls back and shows the reason (positive control: the same add succeeds above)", async () => {
    actions.addAssessment.mockResolvedValue({ ok: false, message: "That class wasn't found." });
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByTestId("assessments-edit"));
    await user.click(screen.getByTestId("assessments-add-c1"));
    await user.type(screen.getByLabelText("New assessment name for BIO 101"), "Quiz 4");
    await user.click(screen.getByTestId("assessments-add-save-c1"));
    await waitFor(() => expect(screen.getByTestId("assessments-error")).toHaveTextContent("That class wasn't found."));
    expect(within(screen.getByTestId("assessments-class-c1")).queryByDisplayValue("Quiz 4")).not.toBeInTheDocument();
  });

  it("Edit: Save sends absolute name/type/date for that assessment and is disabled until something changes", async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByTestId("assessments-edit"));
    expect(screen.getByTestId("assessment-save-a3")).toBeDisabled();
    const name = screen.getByLabelText("Name for Lab report");
    await user.clear(name);
    await user.type(name, "Lab report 2");
    expect(screen.getByTestId("assessment-save-a3")).toBeEnabled();
    await user.click(screen.getByTestId("assessment-save-a3"));
    expect(actions.updateAssessment).toHaveBeenCalledWith("a3", { name: "Lab report 2", type: "quiz", date: "2026-10-20" });
  });

  it("a failed edit puts the old value back and says why", async () => {
    actions.updateAssessment.mockResolvedValue({ ok: false, message: "Couldn't save that assessment." });
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByTestId("assessments-edit"));
    const name = screen.getByLabelText("Name for Lab report");
    await user.clear(name);
    await user.type(name, "Renamed");
    await user.click(screen.getByTestId("assessment-save-a3"));
    await waitFor(() => expect(screen.getByTestId("assessments-error")).toHaveTextContent("Couldn't save"));
    expect(screen.getByTestId("assessment-edit-row-a3")).toBeInTheDocument();
    expect(screen.getByLabelText("Name for Lab report")).toBeInTheDocument(); // the row is back under its original name
  });

  it("Remove asks first ('also removes its task'); nothing is deleted until confirmed, and Keep cancels", async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByTestId("assessments-edit"));
    await user.click(screen.getByTestId("assessment-remove-a3"));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("This also removes its task");
    expect(actions.removeAssessment).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Keep" }));
    expect(actions.removeAssessment).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("assessment-remove-a3"));
    await user.click(screen.getByTestId("assessment-remove-confirm-a3"));
    expect(actions.removeAssessment).toHaveBeenCalledWith("a3");
    expect(screen.queryByTestId("assessment-edit-row-a3")).not.toBeInTheDocument();
  });

  it("a failed remove brings the row back", async () => {
    actions.removeAssessment.mockResolvedValue({ ok: false, message: "Couldn't remove that." });
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByTestId("assessments-edit"));
    await user.click(screen.getByTestId("assessment-remove-a3"));
    await user.click(screen.getByTestId("assessment-remove-confirm-a3"));
    await waitFor(() => expect(screen.getByTestId("assessments-error")).toHaveTextContent("Couldn't remove that."));
    expect(screen.getByTestId("assessment-edit-row-a3")).toBeInTheDocument();
  });

  it("the type picker has no Final/Midterm; an Exam's name field suggests 'Midterm 1, Final exam'", async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByTestId("assessments-edit"));
    await user.click(screen.getByTestId("assessments-add-c1"));
    const select = screen.getByLabelText("New assessment type for BIO 101");
    expect(within(select).queryByText(/Final|Midterm/)).not.toBeInTheDocument();
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Quiz", "Exam", "Homework/Assignment", "Project/Paper"]);
    const name = screen.getByLabelText("New assessment name for BIO 101");
    expect(name).toHaveAttribute("placeholder", "Name");
    await user.selectOptions(select, "exam");
    expect(name).toHaveAttribute("placeholder", "e.g. Midterm 1, Final exam");
  });
});
