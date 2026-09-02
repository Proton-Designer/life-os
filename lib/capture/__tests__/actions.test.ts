import { beforeEach, describe, expect, it, vi } from "vitest";

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.single = vi.fn(async () => resolvedValue);
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

  // R57 follow-up (2026-09-02, migrations 119/120 on production): domain null +
  // dump_source, never domain "school" — the lie R54 forbids. Per the LifeOS lead's
  // vocabulary mapping, the global capture sheet owns dump_source 'capture' specifically
  // (not 'worry'/'note', which are the Night Plan ritual's own values) — Worry vs Note in
  // this UI is a content hint for the user, not a separate persisted origin.
  describe("captureDump", () => {
    it("inserts a tasks row with domain null and dump_source 'capture', never domain 'school' — asserted by reading the row back", async () => {
      tasksInsertChain = makeChain({ data: { domain: null, dump_source: "capture" }, error: null });
      await captureDump({ title: "Worried about the exam" });
      expect(fromMock).toHaveBeenCalledWith("tasks");

      const insertedRow = tasksInsertChain.insert.mock.calls[0]![0] as Record<string, unknown>;
      expect(insertedRow.title).toBe("Worried about the exam");
      expect(insertedRow.domain).toBeNull();
      expect(insertedRow.dump_source).toBe("capture");
      expect(insertedRow.domain).not.toBe("school");
      expect(typeof insertedRow.planned_date).toBe("string");
      expect(insertedRow).not.toHaveProperty("mit_rank");
      expect(insertedRow).not.toHaveProperty("estimated_minutes");
    });

    it("throws if the row read back doesn't actually carry domain null + dump_source 'capture' — the write is verified, not just requested", async () => {
      // Simulates a regression (a reintroduced domain default, a trigger, anything that
      // could silently change what actually lands) — the read-back check must catch it
      // even though the INSERT call itself asked for the right shape.
      tasksInsertChain = makeChain({ data: { domain: "school", dump_source: "capture" }, error: null });
      await expect(captureDump({ title: "x" })).rejects.toThrow();
    });

    it("throws when the insert fails, rather than silently swallowing the error", async () => {
      tasksInsertChain = makeChain({ data: null, error: { message: "boom" } });
      await expect(captureDump({ title: "x" })).rejects.toThrow();
    });
  });
});
