import { beforeEach, describe, expect, it, vi } from "vitest";

const removeTaskCoreMock = vi.fn(async (_id: string) => {});
const revalidatePathMock = vi.fn();

vi.mock("@/lib/tasks/actions-core", () => ({
  addTaskCore: vi.fn(),
  toggleTaskCore: vi.fn(),
  removeTaskCore: (id: string) => removeTaskCoreMock(id),
  addScheduleEventCore: vi.fn(),
  cancelScheduleOccurrenceCore: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

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
