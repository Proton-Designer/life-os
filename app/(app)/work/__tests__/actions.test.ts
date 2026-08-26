import { beforeEach, describe, expect, it, vi } from "vitest";

const addScheduleEventCoreMock = vi.fn(async (..._args: unknown[]) => {});
const updateScheduleEventCoreMock = vi.fn(async (..._args: unknown[]) => {});
const removeScheduleEventCoreMock = vi.fn(async (..._args: unknown[]) => {});
const setScheduleEventOverrideCoreMock = vi.fn(async (..._args: unknown[]) => {});
const removeScheduleEventOverrideCoreMock = vi.fn(async (..._args: unknown[]) => {});
const cancelScheduleOccurrenceCoreMock = vi.fn(async (..._args: unknown[]) => {});
const uncancelScheduleOccurrenceCoreMock = vi.fn(async (..._args: unknown[]) => {});
const revalidatePathMock = vi.fn();

vi.mock("@/lib/tasks/actions-core", () => ({
  addScheduleEventCore: (...args: unknown[]) => addScheduleEventCoreMock(...args),
  updateScheduleEventCore: (...args: unknown[]) => updateScheduleEventCoreMock(...args),
  removeScheduleEventCore: (...args: unknown[]) => removeScheduleEventCoreMock(...args),
  setScheduleEventOverrideCore: (...args: unknown[]) => setScheduleEventOverrideCoreMock(...args),
  removeScheduleEventOverrideCore: (...args: unknown[]) => removeScheduleEventOverrideCoreMock(...args),
  cancelScheduleOccurrenceCore: (...args: unknown[]) => cancelScheduleOccurrenceCoreMock(...args),
  uncancelScheduleOccurrenceCore: (...args: unknown[]) => uncancelScheduleOccurrenceCoreMock(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

// Item 4 (2026-08-26 night batch 2): the free-text generic addScheduleEvent
// is gone — "this schedule is just for work, this isn't to add new events."
// Every write here is Work-specific: title is always "Work", never
// user-entered.
describe("Work actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("addWorkHours always titles the row 'Work' and scopes to co_op", async () => {
    const { addWorkHours } = await import("../actions");
    await addWorkHours(2, "09:00", "17:00");
    expect(addScheduleEventCoreMock).toHaveBeenCalledWith("co_op", "Work", {
      isRecurring: true,
      dayOfWeek: 2,
      eventTime: "09:00",
      endTime: "17:00",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/work");
  });

  it("updateWorkHours edits the permanent pattern in place", async () => {
    const { updateWorkHours } = await import("../actions");
    await updateWorkHours("event-1", { dayOfWeek: 3, eventTime: "10:00", endTime: "18:00" });
    expect(updateScheduleEventCoreMock).toHaveBeenCalledWith("event-1", {
      dayOfWeek: 3,
      eventTime: "10:00",
      endTime: "18:00",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/work");
  });

  it("removeWorkHours deletes the permanent row", async () => {
    const { removeWorkHours } = await import("../actions");
    await removeWorkHours("event-1");
    expect(removeScheduleEventCoreMock).toHaveBeenCalledWith("event-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/work");
  });

  it("addOneOffWorkShift creates a non-recurring 'Work' row for a single date", async () => {
    const { addOneOffWorkShift } = await import("../actions");
    await addOneOffWorkShift("2026-08-30", "13:00", "16:00");
    expect(addScheduleEventCoreMock).toHaveBeenCalledWith("co_op", "Work", {
      isRecurring: false,
      eventDate: "2026-08-30",
      eventTime: "13:00",
      endTime: "16:00",
    });
  });

  it("setWorkHoursOverride sets a temporary time for one occurrence", async () => {
    const { setWorkHoursOverride } = await import("../actions");
    await setWorkHoursOverride("event-1", "2026-08-26", "12:00", "15:00");
    expect(setScheduleEventOverrideCoreMock).toHaveBeenCalledWith("event-1", "2026-08-26", "12:00", "15:00");
    expect(revalidatePathMock).toHaveBeenCalledWith("/work");
  });

  it("removeWorkHoursOverride reverts an occurrence to its permanent time", async () => {
    const { removeWorkHoursOverride } = await import("../actions");
    await removeWorkHoursOverride("event-1", "2026-08-26");
    expect(removeScheduleEventOverrideCoreMock).toHaveBeenCalledWith("event-1", "2026-08-26");
    expect(revalidatePathMock).toHaveBeenCalledWith("/work");
  });

  it("cancelScheduleOccurrence passes through the event id and date, and revalidates", async () => {
    const { cancelScheduleOccurrence } = await import("../actions");

    await cancelScheduleOccurrence("event-1", "2026-08-24");

    expect(cancelScheduleOccurrenceCoreMock).toHaveBeenCalledWith("event-1", "2026-08-24");
    expect(revalidatePathMock).toHaveBeenCalledWith("/work");
  });

  it("uncancelScheduleOccurrence passes through the event id and date, and revalidates", async () => {
    const { uncancelScheduleOccurrence } = await import("../actions");

    await uncancelScheduleOccurrence("event-1", "2026-08-24");

    expect(uncancelScheduleOccurrenceCoreMock).toHaveBeenCalledWith("event-1", "2026-08-24");
    expect(revalidatePathMock).toHaveBeenCalledWith("/work");
  });
});
