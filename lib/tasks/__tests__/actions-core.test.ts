import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

function makeChain(resolvedValue: { data: unknown; error: null } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "upsert", "update", "insert", "delete"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.single = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));
const client = { from: fromMock } as unknown as SupabaseClient;

describe("updateScheduleEventCore", () => {
  it("updates a permanent row's own day/time, scoped to id and user_id -- no requireUser() inside", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { updateScheduleEventCore } = await import("../actions-core");

    await updateScheduleEventCore(client, "user-1", "event-1", { dayOfWeek: 3, eventTime: "09:00", endTime: "17:00" });

    expect(fromMock).toHaveBeenCalledWith("schedule_events");
    expect(chain.update).toHaveBeenCalledWith({ day_of_week: 3, event_time: "09:00", end_time: "17:00" });
    expect(chain.eq).toHaveBeenCalledWith("id", "event-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });
});

describe("removeScheduleEventCore", () => {
  it("deletes a permanent row, scoped to id and user_id", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { removeScheduleEventCore } = await import("../actions-core");

    await removeScheduleEventCore(client, "user-1", "event-1");

    expect(fromMock).toHaveBeenCalledWith("schedule_events");
    expect(chain.delete).toHaveBeenCalledTimes(1);
    expect(chain.eq).toHaveBeenCalledWith("id", "event-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });
});

describe("setScheduleEventOverrideCore", () => {
  it("upserts a temporary time change for one occurrence", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { setScheduleEventOverrideCore } = await import("../actions-core");

    await setScheduleEventOverrideCore(client, "user-1", "event-1", "2026-08-26", "12:00", "15:00");

    expect(fromMock).toHaveBeenCalledWith("schedule_event_overrides");
    expect(chain.upsert).toHaveBeenCalledWith(
      { event_id: "event-1", user_id: "user-1", date: "2026-08-26", event_time: "12:00", end_time: "15:00" },
      { onConflict: "event_id,date" }
    );
  });

  // School/Work's date-heavy write path: the date string is a caller-
  // supplied opaque value threaded straight through to the upsert -- never
  // re-derived from `new Date()` inside this function. Pinned at both sides
  // of the UTC rollover (18:59/19:01 America/Chicago, expressed here simply
  // as the literal date strings a caller at those instants would pass) and
  // in a timezone east of UTC (Asia/Tokyo), to prove the date that lands in
  // the database is always exactly the string the caller sent -- the
  // function has no clock of its own to get the day wrong with.
  it.each([
    ["2026-09-08", "America/Chicago 18:59 -> still 2026-09-08 locally"],
    ["2026-09-09", "America/Chicago 19:01 -> already 2026-09-09 locally"],
    ["2026-09-09", "Asia/Tokyo, east of UTC"],
  ])("passes the date string through byte-for-byte regardless of caller timezone (%s, %s)", async (date) => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { setScheduleEventOverrideCore } = await import("../actions-core");

    await setScheduleEventOverrideCore(client, "user-1", "event-1", date, "12:00");

    expect(chain.upsert).toHaveBeenCalledWith(expect.objectContaining({ date }), expect.anything());
  });
});

describe("removeScheduleEventOverrideCore", () => {
  it("deletes the override, reverting the occurrence to its permanent time", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { removeScheduleEventOverrideCore } = await import("../actions-core");

    await removeScheduleEventOverrideCore(client, "user-1", "event-1", "2026-08-26");

    expect(fromMock).toHaveBeenCalledWith("schedule_event_overrides");
    expect(chain.delete).toHaveBeenCalledTimes(1);
    expect(chain.eq).toHaveBeenCalledWith("event_id", "event-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chain.eq).toHaveBeenCalledWith("date", "2026-08-26");
  });
});

describe("cancelScheduleOccurrenceCore", () => {
  it("records the cancelled occurrence in schedule_event_cancellations, not the recurring pattern", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { cancelScheduleOccurrenceCore } = await import("../actions-core");

    await cancelScheduleOccurrenceCore(client, "user-1", "event-1", "2026-08-12");

    expect(fromMock).toHaveBeenCalledWith("schedule_event_cancellations");
    expect(chain.upsert).toHaveBeenCalledWith(
      { event_id: "event-1", user_id: "user-1", date: "2026-08-12" },
      { onConflict: "event_id,date", ignoreDuplicates: true }
    );
  });

  it.each([
    ["2026-09-08", "America/Chicago 18:59"],
    ["2026-09-09", "America/Chicago 19:01"],
    ["2026-09-09", "Asia/Tokyo"],
  ])("passes the date string through byte-for-byte regardless of caller timezone (%s, %s)", async (date) => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { cancelScheduleOccurrenceCore } = await import("../actions-core");

    await cancelScheduleOccurrenceCore(client, "user-1", "event-1", date);

    expect(chain.upsert).toHaveBeenCalledWith(expect.objectContaining({ date }), expect.anything());
  });
});

describe("uncancelScheduleOccurrenceCore", () => {
  it("deletes the specific cancelled occurrence, scoped to the owning user", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { uncancelScheduleOccurrenceCore } = await import("../actions-core");

    await uncancelScheduleOccurrenceCore(client, "user-1", "event-1", "2026-08-12");

    expect(fromMock).toHaveBeenCalledWith("schedule_event_cancellations");
    expect(chain.delete).toHaveBeenCalledTimes(1);
    expect(chain.eq).toHaveBeenCalledWith("event_id", "event-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chain.eq).toHaveBeenCalledWith("date", "2026-08-12");
  });
});

describe("toggleTaskCore", () => {
  it("sets completed_at when flipping a task to complete", async () => {
    const chain = makeChain({ data: { completed: false }, error: null });
    fromImpl = () => chain;
    const { toggleTaskCore } = await import("../actions-core");

    const result = await toggleTaskCore(client, "user-1", "task-1");

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ completed: true, completed_at: expect.any(String) })
    );
    expect(result).toEqual({ completed: true });
  });

  it("clears completed_at when flipping a task back to incomplete", async () => {
    const chain = makeChain({ data: { completed: true }, error: null });
    fromImpl = () => chain;
    const { toggleTaskCore } = await import("../actions-core");

    const result = await toggleTaskCore(client, "user-1", "task-1");

    expect(chain.update).toHaveBeenCalledWith({ completed: false, completed_at: null });
    expect(result).toEqual({ completed: false });
  });

  it("throws, not silently no-ops, when the task doesn't exist for this user", async () => {
    const chain = makeChain({ data: null, error: null });
    fromImpl = () => chain;
    const { toggleTaskCore } = await import("../actions-core");

    await expect(toggleTaskCore(client, "user-1", "missing")).rejects.toThrow(/not found/i);
  });
});

describe("removeTaskCore", () => {
  it("is a real DELETE, scoped to id and user_id -- core-shaped for the cookie callers, never wired into lib/mcp/write-registry.ts", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { removeTaskCore } = await import("../actions-core");

    await removeTaskCore(client, "user-1", "task-1");

    expect(fromMock).toHaveBeenCalledWith("tasks");
    expect(chain.delete).toHaveBeenCalledTimes(1);
    expect(chain.eq).toHaveBeenCalledWith("id", "task-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });
});

describe("addTaskCore", () => {
  it("inserts a task scoped to the given domain and user, and returns the real row id", async () => {
    const chain = makeChain({ data: { id: "task-new" }, error: null });
    fromImpl = () => chain;
    const { addTaskCore } = await import("../actions-core");

    const id = await addTaskCore(client, "user-1", { domain: "school", title: "Read chapter 4", dueDate: "2026-08-15", dueTime: "14:00" });

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
    expect(id).toBe("task-new");
  });

  it("carries the class_id and task_type, and only sets task_type_other_label when the type is 'other'", async () => {
    const chain = makeChain({ data: { id: "task-new" }, error: null });
    fromImpl = () => chain;
    const { addTaskCore } = await import("../actions-core");

    await addTaskCore(client, "user-1", {
      domain: "school",
      title: "Lab prep",
      dueDate: "2026-08-15",
      taskType: "quiz",
      taskTypeOtherLabel: "Should be ignored — not type 'other'",
      classId: "class-1",
    });

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ task_type: "quiz", task_type_other_label: null, class_id: "class-1" })
    );
  });

  it("sets task_type_other_label when the type is 'other'", async () => {
    const chain = makeChain({ data: { id: "task-new" }, error: null });
    fromImpl = () => chain;
    const { addTaskCore } = await import("../actions-core");

    await addTaskCore(client, "user-1", { domain: "school", title: "Bring goggles", taskType: "other", taskTypeOtherLabel: "Lab prep" });

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ task_type: "other", task_type_other_label: "Lab prep" })
    );
  });

  it.each([
    ["2026-09-08", "America/Chicago 18:59"],
    ["2026-09-09", "America/Chicago 19:01"],
    ["2026-09-09", "Asia/Tokyo"],
  ])("passes due_date through byte-for-byte regardless of caller timezone (%s, %s)", async (dueDate) => {
    const chain = makeChain({ data: { id: "task-new" }, error: null });
    fromImpl = () => chain;
    const { addTaskCore } = await import("../actions-core");

    await addTaskCore(client, "user-1", { domain: "school", title: "x", dueDate });

    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ due_date: dueDate }));
  });
});

describe("updateTaskCore", () => {
  it("replaces a task's contents, scoped to id and user_id", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { updateTaskCore } = await import("../actions-core");

    await updateTaskCore(client, "user-1", "task-1", { title: "Updated title", dueDate: "2026-09-01", taskType: "exam", classId: "class-2" });

    expect(fromMock).toHaveBeenCalledWith("tasks");
    expect(chain.update).toHaveBeenCalledWith({
      title: "Updated title",
      due_date: "2026-09-01",
      task_type: "exam",
      task_type_other_label: null,
      class_id: "class-2",
    });
    expect(chain.eq).toHaveBeenCalledWith("id", "task-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });
});

describe("addScheduleEventCore", () => {
  it("inserts a recurring row scoped to the given domain and user", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { addScheduleEventCore } = await import("../actions-core");

    await addScheduleEventCore(client, "user-1", "school", "PHYS-2326", { isRecurring: true, dayOfWeek: 2, eventTime: "13:00", endTime: "14:15" });

    expect(fromMock).toHaveBeenCalledWith("schedule_events");
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", domain: "school", title: "PHYS-2326", is_recurring: true, day_of_week: 2, event_date: null })
    );
  });

  it.each([
    ["2026-09-08", "America/Chicago 18:59"],
    ["2026-09-09", "America/Chicago 19:01"],
    ["2026-09-09", "Asia/Tokyo"],
  ])("passes event_date through byte-for-byte regardless of caller timezone (%s, %s)", async (eventDate) => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { addScheduleEventCore } = await import("../actions-core");

    await addScheduleEventCore(client, "user-1", "school", "One-off", { isRecurring: false, eventDate });

    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ event_date: eventDate }));
  });
});
