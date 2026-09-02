import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ClassDetailDialog } from "../class-detail-dialog";
import type { ClassCardData } from "@/lib/school/get-class-cards";

const updateClassMock = vi.fn();
const addClassAssessmentMock = vi.fn();
const updateClassAssessmentMock = vi.fn();
const deleteClassAssessmentMock = vi.fn();
vi.mock("@/app/(app)/school/class-actions", () => ({
  updateClass: (...args: unknown[]) => updateClassMock(...args),
  addClassAssessment: (...args: unknown[]) => addClassAssessmentMock(...args),
  updateClassAssessment: (...args: unknown[]) => updateClassAssessmentMock(...args),
  deleteClassAssessment: (...args: unknown[]) => deleteClassAssessmentMock(...args),
}));

const addTaskMock = vi.fn();
const updateTaskMock = vi.fn();
const removeTaskMock = vi.fn();
const toggleTaskMock = vi.fn();
vi.mock("@/app/(app)/school/actions", () => ({
  addTask: (...args: unknown[]) => addTaskMock(...args),
  updateTask: (...args: unknown[]) => updateTaskMock(...args),
  removeTask: (...args: unknown[]) => removeTaskMock(...args),
  toggleTask: (...args: unknown[]) => toggleTaskMock(...args),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

function baseClassData(overrides: Partial<ClassCardData> = {}): ClassCardData {
  return {
    id: "c1",
    shortName: "Lin Alg",
    code: "MATH 2418",
    room: "FO 1.202",
    instructor: "Dr. Nguyen",
    hasSyllabus: false,
    tasksDueThisWeek: 0,
    upcomingAssessment: null,
    difficultyRating: null,
    targetGradePct: null,
    assessments: [],
    tasks: [],
    ...overrides,
  };
}

describe("ClassDetailDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders fully populated from props on first paint — no loading states, ever", () => {
    render(
      <ClassDetailDialog
        open
        onOpenChange={vi.fn()}
        classData={baseClassData({
          assessments: [
            {
              id: "a1",
              name: "Midterm",
              type: "midterm_final",
              date: "2026-10-06",
              taskId: "t1",
              risk: { score: 10, band: "low", confidence: "insufficient" },
              weightPct: null,
              pointsEarned: null,
              pointsPossible: null,
              isExcused: false,
            },
          ],
          tasks: [{ id: "t1", title: "Study ch. 4", dueDate: "2026-10-06", taskType: "exam", taskTypeOtherLabel: null, classId: "c1" }],
        })}
        timezone="America/Chicago"
      />
    );
    expect(screen.getByRole("heading", { name: "Assessments" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Syllabus" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Task list" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Grade" })).toBeInTheDocument();
    // "Midterm" appears twice now — once in the Assessments list, once in
    // the Grade ledger mounted alongside it — both instant, from the same props.
    expect(screen.getAllByText("Midterm")).toHaveLength(2);
    expect(screen.queryByText(/Loading assessments/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Loading grade/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Loading tasks/i)).not.toBeInTheDocument();
  });

  it("shows Edit when not editing, and swaps to Save+Cancel (Edit fully gone) when editing", async () => {
    const user = userEvent.setup();
    render(<ClassDetailDialog open onOpenChange={vi.fn()} classData={baseClassData()} timezone="America/Chicago" />);

    expect(screen.getByRole("button", { name: "Edit Lin Alg" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Lin Alg" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit Lin Alg" }));

    expect(screen.queryByRole("button", { name: "Edit Lin Alg" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Lin Alg" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel Lin Alg" })).toBeInTheDocument();
  });

  it("Cancel discards a staged course-detail edit without writing through, and it stays discarded", async () => {
    const user = userEvent.setup();
    render(<ClassDetailDialog open onOpenChange={vi.fn()} classData={baseClassData()} timezone="America/Chicago" />);

    await user.click(screen.getByRole("button", { name: "Edit Lin Alg" }));
    const roomField = screen.getByPlaceholderText("Room");
    await user.clear(roomField);
    await user.type(roomField, "ROLLBACK-SENTINEL");
    await user.click(screen.getByRole("button", { name: "Cancel Lin Alg" }));

    // Rolled back in the open dialog...
    expect(screen.queryByText("ROLLBACK-SENTINEL")).not.toBeInTheDocument();
    expect(screen.getByText(/FO 1\.202/)).toBeInTheDocument();
    // ...and nothing was ever written through to the server (the real bug
    // this test exists to catch: a Cancel that only resets local state but
    // had already saved).
    expect(updateClassMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("Save commits course-detail changes and exits editing mode", async () => {
    const user = userEvent.setup();
    render(<ClassDetailDialog open onOpenChange={vi.fn()} classData={baseClassData()} timezone="America/Chicago" />);

    await user.click(screen.getByRole("button", { name: "Edit Lin Alg" }));
    const roomField = screen.getByPlaceholderText("Room");
    await user.clear(roomField);
    await user.type(roomField, "FO 2.100");
    await user.click(screen.getByRole("button", { name: "Save Lin Alg" }));

    await waitFor(() =>
      expect(updateClassMock).toHaveBeenCalledWith("c1", { shortName: "Lin Alg", room: "FO 2.100", instructor: "Dr. Nguyen" })
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Save Lin Alg" })).not.toBeInTheDocument();
  });

  it("does not call updateClass at all when course details are unchanged", async () => {
    const user = userEvent.setup();
    render(<ClassDetailDialog open onOpenChange={vi.fn()} classData={baseClassData()} timezone="America/Chicago" />);

    await user.click(screen.getByRole("button", { name: "Edit Lin Alg" }));
    await user.click(screen.getByRole("button", { name: "Save Lin Alg" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(updateClassMock).not.toHaveBeenCalled();
  });

  it("Add assessment commits immediately — no Edit click required, and Save is never involved", async () => {
    const user = userEvent.setup();
    render(<ClassDetailDialog open onOpenChange={vi.fn()} classData={baseClassData()} timezone="America/Chicago" />);

    // Not editing at all — Add must still be reachable and work.
    expect(screen.queryByRole("button", { name: "Save Lin Alg" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add assessment" }));
    await user.click(screen.getByRole("button", { name: "Quiz" }));
    await user.type(screen.getByPlaceholderText("Name"), "Reading check");
    const dateInputs = screen.getAllByDisplayValue("");
    await user.type(dateInputs[0], "2026-09-15");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(addClassAssessmentMock).toHaveBeenCalledWith("c1", "Reading check", "quiz", "2026-09-15"));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(deleteClassAssessmentMock).not.toHaveBeenCalled();
    expect(updateClassAssessmentMock).not.toHaveBeenCalled();
  });

  it("Add task commits immediately — no Edit click required, skips the class-picker step, and Save is never involved", async () => {
    const user = userEvent.setup();
    render(<ClassDetailDialog open onOpenChange={vi.fn()} classData={baseClassData()} timezone="America/Chicago" />);

    expect(screen.queryByRole("button", { name: "Save Lin Alg" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add task" }));

    // lockedClass (C's prop) skips straight to the type step — "Which
    // class?"/"Generic" must never appear for a class-scoped wizard.
    expect(screen.getByRole("dialog", { name: "What type of task?" })).toBeInTheDocument();
    expect(screen.queryByText("Generic")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Homework/ }));
    const wizardDialog = screen.getByRole("dialog", { name: "Describe the task" });
    await user.type(within(wizardDialog).getByPlaceholderText("Description"), "Read ch. 4");
    // The background's own "Filter by date" input still exists (behind the
    // overlay) and would otherwise be the first match in document order.
    const dateInput = wizardDialog.querySelector('input[type="date"]') as HTMLInputElement;
    await user.type(dateInput, "2026-09-15");
    await user.click(within(wizardDialog).getByRole("button", { name: /^Add$/ }));

    await waitFor(() =>
      expect(addTaskMock).toHaveBeenCalledWith({
        title: "Read ch. 4",
        dueDate: "2026-09-15",
        taskType: "homework_assignment",
        taskTypeOtherLabel: undefined,
        classId: "c1",
      })
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(updateTaskMock).not.toHaveBeenCalled();
    expect(removeTaskMock).not.toHaveBeenCalled();
  });

  it("removing an assessment on Save calls deleteClassAssessment and skips independently removing its linked task", async () => {
    const user = userEvent.setup();
    render(
      <ClassDetailDialog
        open
        onOpenChange={vi.fn()}
        classData={baseClassData({
          assessments: [
            {
              id: "a1",
              name: "Midterm",
              type: "midterm_final",
              date: "2026-10-06",
              taskId: "t1",
              risk: { score: 10, band: "low", confidence: "insufficient" },
              weightPct: null,
              pointsEarned: null,
              pointsPossible: null,
              isExcused: false,
            },
          ],
          tasks: [{ id: "t1", title: "Study ch. 4", dueDate: "2026-10-06", taskType: "exam", taskTypeOtherLabel: null, classId: "c1" }],
        })}
        timezone="America/Chicago"
      />
    );

    await user.click(screen.getByRole("button", { name: "Edit Lin Alg" }));
    await user.click(screen.getByRole("button", { name: "Remove Midterm" }));
    await user.click(screen.getByRole("button", { name: "Save Lin Alg" }));

    await waitFor(() => expect(deleteClassAssessmentMock).toHaveBeenCalledWith("a1"));
    // The RPC behind deleteClassAssessment already removes the linked task
    // server-side — an independent removeTask("t1") here would be a
    // needless second call against an id that's already gone.
    expect(removeTaskMock).not.toHaveBeenCalledWith("t1");
  });

  it("editing an assessment's fields commits via updateClassAssessment, not a delete+add pair", async () => {
    const user = userEvent.setup();
    render(
      <ClassDetailDialog
        open
        onOpenChange={vi.fn()}
        classData={baseClassData({
          assessments: [
            {
              id: "a1",
              name: "Midterm",
              type: "midterm_final",
              date: "2026-10-06",
              taskId: "t1",
              risk: { score: 10, band: "low", confidence: "insufficient" },
              weightPct: null,
              pointsEarned: null,
              pointsPossible: null,
              isExcused: false,
            },
          ],
        })}
        timezone="America/Chicago"
      />
    );

    await user.click(screen.getByRole("button", { name: "Edit Lin Alg" }));
    const nameField = screen.getByRole("textbox", { name: "Name for Midterm" });
    await user.type(nameField, " Exam");
    await user.click(screen.getByRole("button", { name: "Save Lin Alg" }));

    await waitFor(() =>
      expect(updateClassAssessmentMock).toHaveBeenCalledWith("a1", {
        name: "Midterm Exam",
        type: "midterm_final",
        date: "2026-10-06",
        weightPct: null,
      })
    );
    expect(addClassAssessmentMock).not.toHaveBeenCalled();
    expect(deleteClassAssessmentMock).not.toHaveBeenCalled();
  });

  it("persists a typed weight through Save — the last-mile bug where mapAssessments/the diff/updateClassAssessment all silently dropped it", async () => {
    const user = userEvent.setup();
    render(
      <ClassDetailDialog
        open
        onOpenChange={vi.fn()}
        classData={baseClassData({
          assessments: [
            {
              id: "a1",
              name: "Midterm",
              type: "midterm_final",
              date: "2026-10-06",
              taskId: "t1",
              risk: { score: 10, band: "low", confidence: "insufficient" },
              weightPct: null,
              pointsEarned: null,
              pointsPossible: null,
              isExcused: false,
            },
            {
              id: "a2",
              name: "Pop Quiz",
              type: "quiz",
              date: "2026-10-01",
              taskId: null,
              risk: { score: 5, band: "low", confidence: "insufficient" },
              weightPct: null,
              pointsEarned: null,
              pointsPossible: null,
              isExcused: false,
            },
          ],
        })}
        timezone="America/Chicago"
      />
    );

    await user.click(screen.getByRole("button", { name: "Edit Lin Alg" }));
    const weightField = screen.getByRole("spinbutton", { name: "Weight for Midterm" });
    await user.type(weightField, "60");
    await user.click(screen.getByRole("button", { name: "Save Lin Alg" }));

    await waitFor(() =>
      expect(updateClassAssessmentMock).toHaveBeenCalledWith("a1", {
        name: "Midterm",
        type: "midterm_final",
        date: "2026-10-06",
        weightPct: 60,
      })
    );
    // The untouched sibling's weight must not be reported as changed, and must
    // never be sent as an update at all.
    expect(updateClassAssessmentMock).not.toHaveBeenCalledWith("a2", expect.anything());
  });

  it("surfaces a Save error, stays in editing mode with staged state intact, and never refreshes", async () => {
    updateClassMock.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    render(<ClassDetailDialog open onOpenChange={vi.fn()} classData={baseClassData()} timezone="America/Chicago" />);

    await user.click(screen.getByRole("button", { name: "Edit Lin Alg" }));
    const roomField = screen.getByPlaceholderText("Room");
    await user.clear(roomField);
    await user.type(roomField, "STAGED-BUT-UNSAVED");
    await user.click(screen.getByRole("button", { name: "Save Lin Alg" }));

    await waitFor(() => expect(screen.getByText("network down")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Save Lin Alg" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("STAGED-BUT-UNSAVED")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
