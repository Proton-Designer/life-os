import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkHoursEditorDialog, type PermanentWorkRow, type OneOffWorkRow } from "../work-hours-editor-dialog";
import type { ExceptionsByEvent } from "@/lib/tasks/schedule-cancellations";

const WEEK_DATES = ["2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29"];
const NEXT_WEEK_DATES = ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];

const PERMANENT: PermanentWorkRow[] = [{ id: "e-mon", dayOfWeek: 1, eventTime: "10:30", endTime: "17:30" }];
const NO_EXCEPTIONS: ExceptionsByEvent = new Map();

function baseActions(overrides: Partial<React.ComponentProps<typeof WorkHoursEditorDialog>["actions"]> = {}) {
  return {
    addWorkHours: vi.fn(() => Promise.resolve()),
    updateWorkHours: vi.fn(() => Promise.resolve()),
    removeWorkHours: vi.fn(() => Promise.resolve()),
    addOneOffWorkShift: vi.fn(() => Promise.resolve()),
    setWorkHoursOverride: vi.fn(() => Promise.resolve()),
    removeWorkHoursOverride: vi.fn(() => Promise.resolve()),
    cancelScheduleOccurrence: vi.fn(() => Promise.resolve()),
    uncancelScheduleOccurrence: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

async function openDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  return user;
}

describe("WorkHoursEditorDialog", () => {
  it("removes a permanent day", async () => {
    const removeWorkHours = vi.fn(() => Promise.resolve());
    render(
      <WorkHoursEditorDialog
        permanentRows={PERMANENT}
        oneOffRows={[]}
        weekDates={WEEK_DATES}
        nextWeekDates={NEXT_WEEK_DATES}
        exceptions={NO_EXCEPTIONS}
        actions={baseActions({ removeWorkHours })}
      />
    );
    const user = await openDialog();
    await user.click(screen.getByRole("button", { name: "Remove Mon hours" }));
    expect(removeWorkHours).toHaveBeenCalledWith("e-mon");
  });

  it("adds a new permanent day", async () => {
    const addWorkHours = vi.fn(() => Promise.resolve());
    render(
      <WorkHoursEditorDialog
        permanentRows={[]}
        oneOffRows={[]}
        weekDates={WEEK_DATES}
        nextWeekDates={NEXT_WEEK_DATES}
        exceptions={NO_EXCEPTIONS}
        actions={baseActions({ addWorkHours })}
      />
    );
    const user = await openDialog();
    await user.click(screen.getByRole("button", { name: "Add a day" }));
    const timeInputs = screen.getAllByDisplayValue("");
    await user.type(timeInputs[0], "09:00");
    await user.type(timeInputs[1], "17:00");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(addWorkHours).toHaveBeenCalledWith(1, "09:00", "17:00");
  });

  it("cancels a permanent occurrence for one specific week", async () => {
    const cancelScheduleOccurrence = vi.fn(() => Promise.resolve());
    render(
      <WorkHoursEditorDialog
        permanentRows={PERMANENT}
        oneOffRows={[]}
        weekDates={WEEK_DATES}
        nextWeekDates={NEXT_WEEK_DATES}
        exceptions={NO_EXCEPTIONS}
        actions={baseActions({ cancelScheduleOccurrence })}
      />
    );
    const user = await openDialog();
    await user.click(screen.getAllByRole("button", { name: "Cancel this week" })[0]);
    expect(cancelScheduleOccurrence).toHaveBeenCalledWith("e-mon", "2026-08-24");
  });

  it("shows Undo cancel for a cancelled occurrence and calls uncancelScheduleOccurrence", async () => {
    const uncancelScheduleOccurrence = vi.fn(() => Promise.resolve());
    const exceptions: ExceptionsByEvent = new Map([
      ["e-mon", new Map([["2026-08-24", { cancelled: true, override: null }]])],
    ]);
    render(
      <WorkHoursEditorDialog
        permanentRows={PERMANENT}
        oneOffRows={[]}
        weekDates={WEEK_DATES}
        nextWeekDates={NEXT_WEEK_DATES}
        exceptions={exceptions}
        actions={baseActions({ uncancelScheduleOccurrence })}
      />
    );
    const user = await openDialog();
    await user.click(screen.getAllByRole("button", { name: "Undo cancel" })[0]);
    expect(uncancelScheduleOccurrence).toHaveBeenCalledWith("e-mon", "2026-08-24");
  });

  it("sets a temporary hours override for one occurrence via 'Change hours'", async () => {
    const setWorkHoursOverride = vi.fn(() => Promise.resolve());
    render(
      <WorkHoursEditorDialog
        permanentRows={PERMANENT}
        oneOffRows={[]}
        weekDates={WEEK_DATES}
        nextWeekDates={NEXT_WEEK_DATES}
        exceptions={NO_EXCEPTIONS}
        actions={baseActions({ setWorkHoursOverride })}
      />
    );
    const user = await openDialog();
    await user.click(screen.getAllByRole("button", { name: "Change hours" })[0]);
    const timeInputs = screen.getAllByDisplayValue("");
    await user.type(timeInputs[0], "12:00");
    await user.type(timeInputs[1], "15:00");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(setWorkHoursOverride).toHaveBeenCalledWith("e-mon", "2026-08-24", "12:00", "15:00");
  });

  it("reverts an override back to the permanent schedule", async () => {
    const removeWorkHoursOverride = vi.fn(() => Promise.resolve());
    const exceptions: ExceptionsByEvent = new Map([
      ["e-mon", new Map([["2026-08-24", { cancelled: false, override: { eventTime: "12:00", endTime: "15:00" } }]])],
    ]);
    render(
      <WorkHoursEditorDialog
        permanentRows={PERMANENT}
        oneOffRows={[]}
        weekDates={WEEK_DATES}
        nextWeekDates={NEXT_WEEK_DATES}
        exceptions={exceptions}
        actions={baseActions({ removeWorkHoursOverride })}
      />
    );
    const user = await openDialog();
    await user.click(screen.getAllByRole("button", { name: "Revert" })[0]);
    expect(removeWorkHoursOverride).toHaveBeenCalledWith("e-mon", "2026-08-24");
  });

  it("adds a one-off shift for a day with no permanent pattern", async () => {
    const addOneOffWorkShift = vi.fn(() => Promise.resolve());
    render(
      <WorkHoursEditorDialog
        permanentRows={PERMANENT}
        oneOffRows={[]}
        weekDates={WEEK_DATES}
        nextWeekDates={NEXT_WEEK_DATES}
        exceptions={NO_EXCEPTIONS}
        actions={baseActions({ addOneOffWorkShift })}
      />
    );
    const user = await openDialog();
    // Sunday (2026-08-23) has no permanent pattern.
    await user.click(screen.getAllByRole("button", { name: "Add hours" })[0]);
    const timeInputs = screen.getAllByDisplayValue("");
    await user.type(timeInputs[0], "09:00");
    await user.type(timeInputs[1], "12:00");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(addOneOffWorkShift).toHaveBeenCalledWith("2026-08-23", "09:00", "12:00");
  });

  it("removes a one-off shift directly (no cancel/override mechanics needed)", async () => {
    const removeWorkHours = vi.fn(() => Promise.resolve());
    const oneOff: OneOffWorkRow[] = [{ id: "one-off-1", eventDate: "2026-08-23", eventTime: "09:00", endTime: "12:00" }];
    render(
      <WorkHoursEditorDialog
        permanentRows={PERMANENT}
        oneOffRows={oneOff}
        weekDates={WEEK_DATES}
        nextWeekDates={NEXT_WEEK_DATES}
        exceptions={NO_EXCEPTIONS}
        actions={baseActions({ removeWorkHours })}
      />
    );
    const user = await openDialog();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(removeWorkHours).toHaveBeenCalledWith("one-off-1");
  });
});
