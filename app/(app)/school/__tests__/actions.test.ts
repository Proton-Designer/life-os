import { beforeEach, describe, expect, it, vi } from "vitest";

const removeTaskCoreMock = vi.fn(async (_id: string) => {});
const addTaskCoreMock = vi.fn(async (..._args: unknown[]) => {});
const revalidatePathMock = vi.fn();

vi.mock("@/lib/tasks/actions-core", () => ({
  addTaskCore: (
    domain: string,
    title: string,
    dueDate?: string,
    dueTime?: string,
    taskType?: string,
    classEventId?: string
  ) => addTaskCoreMock(domain, title, dueDate, dueTime, taskType, classEventId),
  toggleTaskCore: vi.fn(),
  removeTaskCore: (id: string) => removeTaskCoreMock(id),
  addScheduleEventCore: vi.fn(),
  cancelScheduleOccurrenceCore: vi.fn(),
  uncancelScheduleOccurrenceCore: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

function makeChain(resolvedValue: { data: unknown; error: null } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "or", "in", "update", "insert", "delete"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));
const requireUserMock = vi.fn(async () => ({ supabase: { from: fromMock }, userId: "user-1" }));

vi.mock("@/lib/supabase/auth", () => ({
  requireUser: () => requireUserMock(),
}));

describe("School actions — removeTask", () => {
  beforeEach(() => {
    removeTaskCoreMock.mockClear();
    revalidatePathMock.mockClear();
  });

  it("revalidates '/' too — Home reads tasks via getTasks", async () => {
    const { removeTask } = await import("../actions");

    await removeTask("task-1");

    expect(removeTaskCoreMock).toHaveBeenCalledWith("task-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/school");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
  });
});

describe("School actions — addTask", () => {
  beforeEach(() => {
    addTaskCoreMock.mockClear();
    revalidatePathMock.mockClear();
  });

  it("passes task type and class through to addTaskCore", async () => {
    const { addTask } = await import("../actions");

    await addTask("Read chapter 4", "2026-08-15", "14:00", "reading", "event-1");

    expect(addTaskCoreMock).toHaveBeenCalledWith(
      "school",
      "Read chapter 4",
      "2026-08-15",
      "14:00",
      "reading",
      "event-1"
    );
  });
});

describe("School actions — class group CRUD", () => {
  beforeEach(() => {
    fromMock.mockClear();
    revalidatePathMock.mockClear();
  });

  it("addClassEvent inserts one row per day, sharing a class_group_id for a multi-day class", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { addClassEvent } = await import("../actions");

    await addClassEvent({ title: "PHYS-2326", days: [2, 4], eventTime: "13:00", endTime: "14:15" });

    expect(fromMock).toHaveBeenCalledWith("schedule_events");
    expect(chain.insert).toHaveBeenCalledTimes(1);
    const rows = chain.insert.mock.calls[0][0] as { day_of_week: number; class_group_id: string | null }[];
    expect(rows).toHaveLength(2);
    expect(rows[0].day_of_week).toBe(2);
    expect(rows[1].day_of_week).toBe(4);
    expect(rows[0].class_group_id).toBe(rows[1].class_group_id);
    expect(rows[0].class_group_id).not.toBeNull();
  });

  it("addClassEvent leaves class_group_id null for a single-day class", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { addClassEvent } = await import("../actions");

    await addClassEvent({ title: "Solo class", days: [1] });

    const rows = chain.insert.mock.calls[0][0] as { class_group_id: string | null }[];
    expect(rows[0].class_group_id).toBeNull();
  });

  it("addClassEvent rejects an empty day selection", async () => {
    const { addClassEvent } = await import("../actions");
    await expect(addClassEvent({ title: "No days", days: [] })).rejects.toThrow(/at least one day/i);
  });

  it("updateClassEvent updates rows in place rather than deleting and recreating them", async () => {
    const groupId = "11111111-1111-1111-1111-111111111111";
    const chain = makeChain({
      data: [
        { id: "row-tue", day_of_week: 2, class_group_id: groupId },
        { id: "row-thu", day_of_week: 4, class_group_id: groupId },
      ],
      error: null,
    });
    fromImpl = () => chain;
    const { updateClassEvent } = await import("../actions");

    // Drop Thursday, keep Tuesday, add Wednesday.
    await updateClassEvent(groupId, { title: "PHYS-2326", days: [2, 3], eventTime: "13:00" });

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ title: "PHYS-2326", class_group_id: groupId })
    );
    expect(chain.in).toHaveBeenCalledWith("id", ["row-tue"]); // kept
    expect(chain.delete).toHaveBeenCalledTimes(1); // drops Thursday's row
    expect(chain.insert).toHaveBeenCalledTimes(1); // adds Wednesday
    const inserted = chain.insert.mock.calls[0][0] as { day_of_week: number }[];
    expect(inserted[0].day_of_week).toBe(3);
  });

  it("updateClassEvent rejects a non-uuid key", async () => {
    const { updateClassEvent } = await import("../actions");
    await expect(updateClassEvent("not-a-uuid", { title: "x", days: [1] })).rejects.toThrow(/valid id/i);
  });

  it("removeClassEvent deletes by class_group_id or id in one query", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { removeClassEvent } = await import("../actions");
    const key = "22222222-2222-2222-2222-222222222222";

    await removeClassEvent(key);

    expect(chain.delete).toHaveBeenCalledTimes(1);
    expect(chain.or).toHaveBeenCalledWith(`class_group_id.eq.${key},id.eq.${key}`);
  });

  it("removeClassEvent rejects a non-uuid key", async () => {
    const { removeClassEvent } = await import("../actions");
    await expect(removeClassEvent("../../etc/passwd")).rejects.toThrow(/valid id/i);
  });
});
