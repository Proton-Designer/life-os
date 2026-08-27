import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ClassEditorDialog, type ClassGroup } from "../class-editor-dialog";

function group(overrides: Partial<ClassGroup> = {}): ClassGroup {
  return {
    groupKey: "g1",
    title: "PHYS-2326",
    eventTime: "13:00",
    endTime: "14:15",
    location: "SCI 1.220",
    instructor: "Mengke Liu",
    days: [
      { dayOfWeek: 2, eventId: "e-tue", date: "2026-08-25", cancelledThisWeek: false },
      { dayOfWeek: 4, eventId: "e-thu", date: "2026-08-27", cancelledThisWeek: false },
    ],
    ...overrides,
  };
}

function baseProps(overrides: Partial<React.ComponentProps<typeof ClassEditorDialog>> = {}) {
  return {
    classes: [],
    addClassEvent: vi.fn(() => Promise.resolve()),
    updateClassEvent: vi.fn(() => Promise.resolve()),
    removeClassEvent: vi.fn(() => Promise.resolve()),
    cancelScheduleOccurrence: vi.fn(() => Promise.resolve()),
    uncancelScheduleOccurrence: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

async function openDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Edit classes" }));
  return user;
}

describe("ClassEditorDialog", () => {
  it("shows an empty message with no classes, not a bare list", async () => {
    render(<ClassEditorDialog {...baseProps({ classes: [] })} />);
    await openDialog();
    expect(await screen.findByText("No classes yet")).toBeInTheDocument();
  });

  it("shows a T/Th class as ONE row, not two", async () => {
    render(<ClassEditorDialog {...baseProps({ classes: [group()] })} />);
    await openDialog();
    expect(screen.getAllByText("PHYS-2326")).toHaveLength(1);
    expect(screen.getByText("Tue/Thu", { exact: false })).toBeInTheDocument();
  });

  it("adds a multi-day class with both days checked", async () => {
    const addClassEvent = vi.fn(() => Promise.resolve());
    render(<ClassEditorDialog {...baseProps({ addClassEvent })} />);
    const user = await openDialog();

    await user.click(screen.getByRole("button", { name: "Add a class" }));
    await user.type(screen.getByPlaceholderText("Class name"), "New Class");
    await user.click(screen.getByRole("button", { name: "Tue" }));
    await user.click(screen.getByRole("button", { name: "Thu" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(addClassEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: "New Class", days: expect.arrayContaining([2, 4]) })
    );
  });

  it("edits an existing class and submits updateClassEvent keyed by its groupKey", async () => {
    const updateClassEvent = vi.fn(() => Promise.resolve());
    render(<ClassEditorDialog {...baseProps({ classes: [group()], updateClassEvent })} />);
    const user = await openDialog();

    await user.click(screen.getByRole("button", { name: "Edit PHYS-2326" }));
    expect(screen.getByDisplayValue("PHYS-2326")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateClassEvent).toHaveBeenCalledWith("g1", expect.objectContaining({ title: "PHYS-2326" }));
  });

  it("cancels an occurrence for one of the class's days, then undoes it", async () => {
    const cancelScheduleOccurrence = vi.fn(() => Promise.resolve());
    const uncancelScheduleOccurrence = vi.fn(() => Promise.resolve());
    const { rerender } = render(
      <ClassEditorDialog {...baseProps({ classes: [group()], cancelScheduleOccurrence, uncancelScheduleOccurrence })} />
    );
    await openDialog();

    await userEvent.setup().click(screen.getAllByRole("button", { name: "Cancel this week" })[0]);
    expect(cancelScheduleOccurrence).toHaveBeenCalledWith("e-tue", "2026-08-25");

    // Simulate the server round-trip flipping this occurrence to cancelled.
    rerender(
      <ClassEditorDialog
        {...baseProps({
          classes: [group({ days: [{ dayOfWeek: 2, eventId: "e-tue", date: "2026-08-25", cancelledThisWeek: true }, group().days[1]] })],
          cancelScheduleOccurrence,
          uncancelScheduleOccurrence,
        })}
      />
    );
    expect(await screen.findByRole("button", { name: "Undo cancel" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Undo cancel" }));
    expect(uncancelScheduleOccurrence).toHaveBeenCalledWith("e-tue", "2026-08-25");
  });

  it("removes a class by its groupKey", async () => {
    const removeClassEvent = vi.fn(() => Promise.resolve());
    render(<ClassEditorDialog {...baseProps({ classes: [group()], removeClassEvent })} />);
    const user = await openDialog();

    await user.click(screen.getByRole("button", { name: "Remove PHYS-2326" }));
    expect(removeClassEvent).toHaveBeenCalledWith("g1");
  });
});
