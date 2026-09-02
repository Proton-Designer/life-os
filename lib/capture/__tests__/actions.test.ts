import { beforeEach, describe, expect, it, vi } from "vitest";

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

const addTaskCoreMock = vi.fn(async (_input: unknown) => {});
vi.mock("@/lib/tasks/actions-core", () => ({ addTaskCore: (input: unknown) => addTaskCoreMock(input) }));

const createTriggerAndLogMock = vi.fn(async (_input: unknown) => ({ triggerId: "t1" }));
vi.mock("@/app/(app)/distractions/actions", () => ({
  createTriggerAndLog: (input: unknown) => createTriggerAndLogMock(input),
}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

const getClaimsMock = vi.fn(async () => ({ data: { claims: { sub: "user-1" } }, error: null }));
const PROFILE_CHAIN = makeChain({ data: { timezone: "America/Chicago" }, error: null });
let tasksInsertChain = makeChain({ data: null, error: null });
const fromMock = vi.fn((table: string) => (table === "profiles" ? PROFILE_CHAIN : tasksInsertChain));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock }, from: fromMock })),
}));

// Imported after the mocks above (vi.mock calls are hoisted, but this keeps the
// module-under-test's dependencies visually adjacent to what stands in for them).
import { captureDistraction, captureDump, captureTask } from "../actions";

describe("capture actions", () => {
  beforeEach(() => {
    addTaskCoreMock.mockClear();
    createTriggerAndLogMock.mockClear();
    revalidatePathMock.mockClear();
    fromMock.mockClear();
    tasksInsertChain = makeChain({ data: null, error: null });
  });

  describe("captureTask", () => {
    it("routes to addTaskCore with domain school — the only path that action has", async () => {
      await captureTask({ title: "Submit lab report", dueDate: "2026-09-05" });
      expect(addTaskCoreMock).toHaveBeenCalledWith({ domain: "school", title: "Submit lab report", dueDate: "2026-09-05" });
    });

    it("never passes estimated_minutes or a taskType — a captured task earns both later", async () => {
      await captureTask({ title: "Submit lab report", dueDate: "2026-09-05" });
      const call = addTaskCoreMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(call).not.toHaveProperty("estimatedMinutes");
      expect(call).not.toHaveProperty("taskType");
    });

    it("omits dueDate entirely when nothing resolved, rather than fabricating today as a deadline", async () => {
      await captureTask({ title: "Buy notebook", dueDate: null });
      expect(addTaskCoreMock).toHaveBeenCalledWith({ domain: "school", title: "Buy notebook" });
    });
  });

  describe("captureDistraction", () => {
    it("routes to createTriggerAndLog with the confirmed domain, never touching distraction_triggers directly", async () => {
      await captureDistraction({ title: "Checked phone", domain: "fitness" });
      expect(createTriggerAndLogMock).toHaveBeenCalledWith({ domain: "fitness", name: "Checked phone", description: null });
    });
  });

  describe("captureDump", () => {
    it("inserts a tasks row with planned_date resolved from the user's timezone, mit_rank and estimated_minutes untouched", async () => {
      await captureDump({ title: "Worried about the exam" });
      expect(fromMock).toHaveBeenCalledWith("tasks");
      const insertedRow = tasksInsertChain.insert.mock.calls[0]![0] as Record<string, unknown>;
      expect(insertedRow.title).toBe("Worried about the exam");
      expect(insertedRow.domain).toBe("school");
      expect(typeof insertedRow.planned_date).toBe("string");
      expect(insertedRow).not.toHaveProperty("mit_rank");
      expect(insertedRow).not.toHaveProperty("estimated_minutes");
    });

    it("throws when the insert fails, rather than silently swallowing the error", async () => {
      tasksInsertChain = makeChain({ data: null, error: { message: "boom" } });
      await expect(captureDump({ title: "x" })).rejects.toThrow();
    });
  });
});
