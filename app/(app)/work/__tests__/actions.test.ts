import { beforeEach, describe, expect, it, vi } from "vitest";

const addScheduleEventCoreMock = vi.fn(async (..._args: unknown[]) => {});
const cancelScheduleOccurrenceCoreMock = vi.fn(async (..._args: unknown[]) => {});
const revalidatePathMock = vi.fn();

vi.mock("@/lib/tasks/actions-core", () => ({
  addScheduleEventCore: (...args: unknown[]) => addScheduleEventCoreMock(...args),
  cancelScheduleOccurrenceCore: (...args: unknown[]) => cancelScheduleOccurrenceCoreMock(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

// Work stopped reading/writing the shared `tasks` table entirely once the
// old "Task list" panel was removed (Opus Lead, 2026-08-20) — two task
// systems on one page (coop_tasks-backed Agenda/Pipeline, tasks-backed
// Task list) meant anything typed into the old panel silently went
// nowhere: never in the Agenda, never in the Pipeline, and no longer
// counted toward Home's Work progress after the snapshot rewire. Only
// the schedule actions (Work schedule, which Ayman explicitly kept) are
// left in this file.
describe("Work actions", () => {
  beforeEach(() => {
    addScheduleEventCoreMock.mockClear();
    cancelScheduleOccurrenceCoreMock.mockClear();
    revalidatePathMock.mockClear();
  });

  it("addScheduleEvent scopes to the co_op domain and revalidates the page", async () => {
    const { addScheduleEvent } = await import("../actions");

    await addScheduleEvent("Shift", { isRecurring: true, dayOfWeek: 2 });

    expect(addScheduleEventCoreMock).toHaveBeenCalledWith("co_op", "Shift", { isRecurring: true, dayOfWeek: 2 });
    expect(revalidatePathMock).toHaveBeenCalledWith("/work");
  });

  it("cancelScheduleOccurrence passes through the event id and date, and revalidates", async () => {
    const { cancelScheduleOccurrence } = await import("../actions");

    await cancelScheduleOccurrence("event-1", "2026-08-24");

    expect(cancelScheduleOccurrenceCoreMock).toHaveBeenCalledWith("event-1", "2026-08-24");
    expect(revalidatePathMock).toHaveBeenCalledWith("/work");
  });
});
