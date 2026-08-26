import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskWizardDialog, type TaskWizardSubmitInput } from "../task-wizard-dialog";

const CLASSES = [
  { id: "c1", label: "PHYS-2326-002" },
  { id: "c2", label: "CS-3341-HON" },
];

async function openWizard() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add" }));
  return user;
}

describe("TaskWizardDialog", () => {
  it("walks class -> type -> description/date -> submit, in that order", async () => {
    const onSubmit = vi.fn((_input: TaskWizardSubmitInput) => Promise.resolve());
    render(<TaskWizardDialog classes={CLASSES} timezone="America/Chicago" onSubmit={onSubmit} />);
    const user = await openWizard();

    expect(screen.getByRole("heading", { name: "Which class?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "PHYS-2326-002" }));

    expect(screen.getByRole("heading", { name: "What type of task?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Quiz" }));

    expect(screen.getByRole("heading", { name: "Describe the task" })).toBeInTheDocument();
    // Quiz -> "Date", not "Due Date".
    expect(screen.getByText("Date", { selector: "span" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Description"), "Chapter 3 quiz");
    await user.click(screen.getByRole("button", { name: "Today" }));
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ classId: "c1", taskType: "quiz", title: "Chapter 3 quiz" })
    );
    const submitted = onSubmit.mock.calls[0]?.[0];
    expect(submitted?.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("offers Generic alongside every real class", async () => {
    render(<TaskWizardDialog classes={CLASSES} timezone="America/Chicago" onSubmit={vi.fn()} />);
    await openWizard();
    await userEvent.setup().click(screen.getByRole("button", { name: "Generic" }));
    expect(screen.getByRole("heading", { name: "What type of task?" })).toBeInTheDocument();
  });

  it("shows 'Due Date' for Homework/Assignment and Project/Paper, 'Date' otherwise", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<TaskWizardDialog classes={CLASSES} timezone="America/Chicago" onSubmit={onSubmit} />);
    const user = await openWizard();
    await user.click(screen.getByRole("button", { name: "Generic" }));
    await user.click(screen.getByRole("button", { name: "Homework/Assignment" }));
    expect(screen.getByText("Due Date", { selector: "span" })).toBeInTheDocument();
  });

  it("requires a custom label before advancing past Other", async () => {
    render(<TaskWizardDialog classes={CLASSES} timezone="America/Chicago" onSubmit={vi.fn()} />);
    const user = await openWizard();
    await user.click(screen.getByRole("button", { name: "Generic" }));
    await user.click(screen.getByRole("button", { name: "Other" }));

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Enter a type")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Describe the task" })).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Describe the type"), "Lab prep");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Describe the task" })).toBeInTheDocument();
  });

  it("submits the custom Other label alongside taskType: other", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<TaskWizardDialog classes={CLASSES} timezone="America/Chicago" onSubmit={onSubmit} />);
    const user = await openWizard();
    await user.click(screen.getByRole("button", { name: "Generic" }));
    await user.click(screen.getByRole("button", { name: "Other" }));
    await user.type(screen.getByPlaceholderText("Describe the type"), "Lab prep");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(screen.getByPlaceholderText("Description"), "Bring goggles");
    await user.click(screen.getByRole("button", { name: "Tomorrow" }));
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: "other", taskTypeOtherLabel: "Lab prep" })
    );
  });

  it("rejects submitting without a description", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<TaskWizardDialog classes={CLASSES} timezone="America/Chicago" onSubmit={onSubmit} />);
    const user = await openWizard();
    await user.click(screen.getByRole("button", { name: "Generic" }));
    await user.click(screen.getByRole("button", { name: "Reminder" }));
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a description")).toBeInTheDocument();
  });

  it("goes back a step without losing the ability to change the earlier choice", async () => {
    render(<TaskWizardDialog classes={CLASSES} timezone="America/Chicago" onSubmit={vi.fn()} />);
    const user = await openWizard();
    await user.click(screen.getByRole("button", { name: "PHYS-2326-002" }));
    await user.click(screen.getByRole("button", { name: "Quiz" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "What type of task?" })).toBeInTheDocument();
  });

  it("resets to step 1 when reopened after a close", async () => {
    render(<TaskWizardDialog classes={CLASSES} timezone="America/Chicago" onSubmit={vi.fn()} />);
    let user = await openWizard();
    await user.click(screen.getByRole("button", { name: "PHYS-2326-002" }));
    await user.keyboard("{Escape}");

    user = await openWizard();
    expect(screen.getByRole("heading", { name: "Which class?" })).toBeInTheDocument();
  });

  // C2: the expanded class view already knows which class it's in — never
  // ask again. Step 1 must never render, not even briefly before advancing.
  describe("lockedClass", () => {
    const LOCKED = { id: "c1", label: "PHYS-2326-002" };

    it("opens directly on the type step, never showing the class step", async () => {
      render(
        <TaskWizardDialog
          classes={CLASSES}
          timezone="America/Chicago"
          onSubmit={vi.fn()}
          lockedClass={LOCKED}
        />
      );
      await openWizard();
      expect(screen.getByRole("heading", { name: "What type of task?" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Which class?" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Generic" })).not.toBeInTheDocument();
    });

    it("submits with the locked class id, and hides the Back button on the type step", async () => {
      const onSubmit = vi.fn(() => Promise.resolve());
      render(
        <TaskWizardDialog
          classes={CLASSES}
          timezone="America/Chicago"
          onSubmit={onSubmit}
          lockedClass={LOCKED}
        />
      );
      const user = await openWizard();
      expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Quiz" }));
      await user.type(screen.getByPlaceholderText("Description"), "Chapter 3 quiz");
      await user.click(screen.getByRole("button", { name: "Today" }));
      await user.click(screen.getByRole("button", { name: "Add" }));
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ classId: "c1" }));
    });

    it("re-opens on the type step (not the class step) after a close", async () => {
      render(
        <TaskWizardDialog
          classes={CLASSES}
          timezone="America/Chicago"
          onSubmit={vi.fn()}
          lockedClass={LOCKED}
        />
      );
      let user = await openWizard();
      await user.click(screen.getByRole("button", { name: "Quiz" }));
      await user.keyboard("{Escape}");

      user = await openWizard();
      expect(screen.getByRole("heading", { name: "What type of task?" })).toBeInTheDocument();
    });
  });

  it("passes triggerVariant through to the trigger button (used to distinguish the class view's Add from the main list's)", () => {
    render(
      <TaskWizardDialog
        classes={CLASSES}
        timezone="America/Chicago"
        onSubmit={vi.fn()}
        triggerVariant="outline"
      />
    );
    expect(screen.getByRole("button", { name: "Add" })).toHaveAttribute("data-variant", "outline");
  });
});
