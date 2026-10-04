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

const addTaskCoreMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/tasks/actions-core", () => ({ addTaskCore: (...args: unknown[]) => addTaskCoreMock(...args) }));

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
      await captureTask({ area: "school", title: "Submit lab report", dueDate: "2026-09-05" });
      expect(addTaskCoreMock).toHaveBeenCalledWith(expect.anything(), "user-1", { domain: "school", title: "Submit lab report", dueDate: "2026-09-05" });
    });

    it("never passes estimated_minutes or a taskType — a captured task earns both later", async () => {
      await captureTask({ area: "school", title: "Submit lab report", dueDate: "2026-09-05" });
      const call = addTaskCoreMock.mock.calls[0]![2] as Record<string, unknown>;
      expect(call).not.toHaveProperty("estimatedMinutes");
      expect(call).not.toHaveProperty("taskType");
    });

    it("omits dueDate entirely when nothing resolved, rather than fabricating today as a deadline", async () => {
      await captureTask({ area: "school", title: "Buy notebook", dueDate: null });
      expect(addTaskCoreMock).toHaveBeenCalledWith(expect.anything(), "user-1", { domain: "school", title: "Buy notebook" });
    });

    // #30/#31: a spoken time ("...at 5pm") reached this action's `dueTime` param but was
    // never forwarded to addTaskCore — the task landed with due_time null, so
    // get-day-shape's timeline, calendar's timed-block bucket, and get-priority-items'
    // urgency ranking all missed it (each keys off due_time being non-null). Threaded
    // through here, the same way dueDate already is.
    it("threads dueTime through to addTaskCore — regression test for #30/#31", async () => {
      await captureTask({ area: "school", title: "Submit lab report", dueDate: "2026-09-05", dueTime: "17:00" });
      expect(addTaskCoreMock).toHaveBeenCalledWith(expect.anything(), "user-1", {
        domain: "school",
        title: "Submit lab report",
        dueDate: "2026-09-05",
        dueTime: "17:00",
      });
    });

    it("omits dueTime entirely when nothing resolved, rather than fabricating midnight", async () => {
      await captureTask({ area: "school", title: "Buy notebook", dueDate: null, dueTime: null });
      const call = addTaskCoreMock.mock.calls[0]![2] as Record<string, unknown>;
      expect(call).not.toHaveProperty("dueTime");
    });
  });

  describe("captureTask area (IA-P1a)", () => {
    it("co_op reaches addTaskCore as domain co_op", async () => {
      await captureTask({ title: "Ship the report", area: "co_op" });
      expect(addTaskCoreMock).toHaveBeenCalledWith(expect.anything(), "user-1", { domain: "co_op", title: "Ship the report" });
    });

    it("'none' is the Inbox: a domain-null dump_source 'capture' row carrying the parsed date/time, never addTaskCore", async () => {
      tasksInsertChain = makeChain({ data: { domain: null, dump_source: "capture" }, error: null });
      await captureTask({ title: "Call the landlord", area: "none", dueDate: "2026-10-09", dueTime: "09:30" });
      expect(addTaskCoreMock).not.toHaveBeenCalled();
      const row = tasksInsertChain.insert.mock.calls[0]![0] as Record<string, unknown>;
      expect(row).toMatchObject({ domain: null, dump_source: "capture", title: "Call the landlord", due_date: "2026-10-09", due_time: "09:30" });
    });

    it("rejects a missing or unknown area instead of quietly filing under School", async () => {
      await expect(captureTask({ title: "x", area: undefined as never })).rejects.toThrow(/area/i);
      await expect(captureTask({ title: "x", area: "business" as never })).rejects.toThrow(/area/i);
      expect(addTaskCoreMock).not.toHaveBeenCalled();
    });
  });

  describe("captureDistraction", () => {
    it("routes to createTriggerAndLog with the confirmed domain, never touching distraction_triggers directly", async () => {
      await captureDistraction({ title: "Checked phone", domain: "fitness" });
      expect(createTriggerAndLogMock).toHaveBeenCalledWith({ domain: "fitness", name: "Checked phone", description: null });
    });
  });

  // R57 follow-up + correction (2026-09-02, migrations 119/120 on production):
  // domain null always — domain "school" was the lie R54 forbids. dump_source is NOT
  // uniform, though: the Boss's correction distinguishes KINDS of seed (school, milestone,
  // worry — findable by the Night Plan's own seeding/anti-worry-hour regardless of which
  // surface parked them) from SURFACES (capture — an undifferentiated note with no kind).
  // So the Worry button passes source: "worry"; the Note button passes source: "capture".
  describe("captureDump", () => {
    it("a worry capture writes dump_source 'worry' — a kind the Night Plan must find regardless of surface", async () => {
      tasksInsertChain = makeChain({ data: { domain: null, dump_source: "worry" }, error: null });
      await captureDump({ title: "Worried about the exam", source: "worry" });
      expect(fromMock).toHaveBeenCalledWith("tasks");

      const insertedRow = tasksInsertChain.insert.mock.calls[0]![0] as Record<string, unknown>;
      expect(insertedRow.title).toBe("Worried about the exam");
      expect(insertedRow.domain).toBeNull();
      expect(insertedRow.dump_source).toBe("worry");
      expect(insertedRow.domain).not.toBe("school");
      expect(typeof insertedRow.planned_date).toBe("string");
      expect(insertedRow).not.toHaveProperty("mit_rank");
      expect(insertedRow).not.toHaveProperty("estimated_minutes");
    });

    it("a note capture writes dump_source 'capture' — an undifferentiated note, no kind", async () => {
      tasksInsertChain = makeChain({ data: { domain: null, dump_source: "capture" }, error: null });
      await captureDump({ title: "Remember this idea", source: "capture" });
      const insertedRow = tasksInsertChain.insert.mock.calls[0]![0] as Record<string, unknown>;
      expect(insertedRow.domain).toBeNull();
      expect(insertedRow.dump_source).toBe("capture");
    });

    it("throws if the row read back doesn't actually carry domain null + the requested dump_source — the write is verified, not just requested", async () => {
      // Simulates a regression (a reintroduced domain default, a trigger, anything that
      // could silently change what actually lands) — the read-back check must catch it
      // even though the INSERT call itself asked for the right shape.
      tasksInsertChain = makeChain({ data: { domain: "school", dump_source: "worry" }, error: null });
      await expect(captureDump({ title: "x", source: "worry" })).rejects.toThrow();
    });

    it("also throws if the read-back dump_source doesn't match the requested source, even with domain correctly null", async () => {
      tasksInsertChain = makeChain({ data: { domain: null, dump_source: "capture" }, error: null });
      await expect(captureDump({ title: "x", source: "worry" })).rejects.toThrow();
    });

    it("throws when the insert fails, rather than silently swallowing the error", async () => {
      tasksInsertChain = makeChain({ data: null, error: { message: "boom" } });
      await expect(captureDump({ title: "x", source: "worry" })).rejects.toThrow();
    });
  });
});
