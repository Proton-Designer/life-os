import { beforeEach, describe, expect, it, vi } from "vitest";

function makeChain(resolvedValue: { data: unknown; error: null } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "upsert", "update", "insert", "delete"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  };
}

const getClaimsMock = vi.fn(async () => ({ data: { claims: { sub: "user-1" } }, error: null }));
let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock }, from: fromMock })),
}));

describe("cancelScheduleOccurrenceCore", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
  });

  it("records the cancelled occurrence in schedule_event_cancellations, not the recurring pattern", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { cancelScheduleOccurrenceCore } = await import("../actions-core");

    await cancelScheduleOccurrenceCore("event-1", "2026-08-12");

    expect(fromMock).toHaveBeenCalledWith("schedule_event_cancellations");
    expect(chain.upsert).toHaveBeenCalledWith(
      { event_id: "event-1", user_id: "user-1", date: "2026-08-12" },
      { onConflict: "event_id,date", ignoreDuplicates: true }
    );
  });
});

describe("uncancelScheduleOccurrenceCore", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
  });

  it("deletes the specific cancelled occurrence, scoped to the owning user", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { uncancelScheduleOccurrenceCore } = await import("../actions-core");

    await uncancelScheduleOccurrenceCore("event-1", "2026-08-12");

    expect(fromMock).toHaveBeenCalledWith("schedule_event_cancellations");
    expect(chain.delete).toHaveBeenCalledTimes(1);
    expect(chain.eq).toHaveBeenCalledWith("event_id", "event-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chain.eq).toHaveBeenCalledWith("date", "2026-08-12");
  });
});

describe("toggleTaskCore", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
  });

  it("sets completed_at when flipping a task to complete", async () => {
    const chain = makeChain({ data: { completed: false }, error: null });
    fromImpl = () => chain;
    const { toggleTaskCore } = await import("../actions-core");

    await toggleTaskCore("task-1");

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ completed: true, completed_at: expect.any(String) })
    );
  });

  it("clears completed_at when flipping a task back to incomplete", async () => {
    const chain = makeChain({ data: { completed: true }, error: null });
    fromImpl = () => chain;
    const { toggleTaskCore } = await import("../actions-core");

    await toggleTaskCore("task-1");

    expect(chain.update).toHaveBeenCalledWith({ completed: false, completed_at: null });
  });
});

describe("addTaskCore", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
  });

  it("inserts a task scoped to the given domain", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { addTaskCore } = await import("../actions-core");

    await addTaskCore("school", "Read chapter 4", "2026-08-15", "14:00");

    expect(fromMock).toHaveBeenCalledWith("tasks");
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        domain: "school",
        title: "Read chapter 4",
        due_date: "2026-08-15",
        due_time: "14:00",
      })
    );
  });
});
