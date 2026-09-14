import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { startWorkSessionCore, endWorkSessionCore, toggleSessionObjectiveCore } from "../actions-core";

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "update", "insert", "delete"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.single = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

describe("startWorkSessionCore", () => {
  it("throws and never inserts when an active session already exists", async () => {
    const workSessions = makeChain({ data: { id: "existing" }, error: null });
    const from = vi.fn(() => workSessions);
    const client = { from } as unknown as SupabaseClient;

    // #37: a real objective is included so this test still exercises the
    // ACTIVE-SESSION guard specifically -- with no objectives at all the
    // call would now be rejected by the #37 gate before ever reaching this
    // guard, which would make this test pass for the wrong reason.
    await expect(
      startWorkSessionCore(client, "user-1", { kind: "deep_work", objectives: [{ kind: "custom", customText: "Draft it" }] })
    ).rejects.toThrow(/already active/i);
    expect(workSessions.insert).not.toHaveBeenCalled();
  });

  it("inserts the session with goal_minutes/class_id, defaulting both to null when omitted", async () => {
    const workSessions = makeChain();
    workSessions.maybeSingle = vi.fn(async () => ({ data: null, error: null })); // no active session
    workSessions.single = vi.fn(async () => ({ data: { id: "s1", started_at: "2026-09-10T18:00:00.000Z" }, error: null }));
    const objectivesTable = makeChain({ data: null, error: null });
    const from = vi.fn((table: string) => (table === "work_sessions" ? workSessions : objectivesTable));
    const client = { from } as unknown as SupabaseClient;

    const result = await startWorkSessionCore(client, "user-1", {
      kind: "deep_study",
      objectives: [{ kind: "task", taskId: "t1" }],
    });

    expect(workSessions.insert).toHaveBeenCalledWith({ user_id: "user-1", kind: "deep_study", goal_minutes: null, class_id: null });
    expect(result).toEqual({ id: "s1", startedAt: "2026-09-10T18:00:00.000Z" });
  });

  // #37 (Opus Lead's ruling, 2026-09-14): "can't start without typing what
  // you'll produce" -- enforced here, not only in the setup dialog's
  // canStart, so no caller (the dialog, the MCP work_session.start tool,
  // any future one) can route around it.
  describe("#37 — the deliverable gate", () => {
    it("rejects a session with no objectives at all, before ever touching the database", async () => {
      const from = vi.fn();
      const client = { from } as unknown as SupabaseClient;

      await expect(startWorkSessionCore(client, "user-1", { kind: "deep_work" })).rejects.toThrow(
        /at least one objective/i
      );
      expect(from).not.toHaveBeenCalled();
    });

    it("rejects a session whose only objective is a blank/whitespace custom objective", async () => {
      const from = vi.fn();
      const client = { from } as unknown as SupabaseClient;

      await expect(
        startWorkSessionCore(client, "user-1", { kind: "deep_work", objectives: [{ kind: "custom", customText: "   " }] })
      ).rejects.toThrow(/at least one objective/i);
      expect(from).not.toHaveBeenCalled();
    });

    it("accepts a session whose only objective is a real kill_list_item — no typed text required on top of a real selection", async () => {
      const workSessions = makeChain();
      workSessions.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
      workSessions.single = vi.fn(async () => ({ data: { id: "s1", started_at: "2026-09-10T18:00:00.000Z" }, error: null }));
      const objectivesTable = makeChain({ data: null, error: null });
      const from = vi.fn((table: string) => (table === "work_sessions" ? workSessions : objectivesTable));
      const client = { from } as unknown as SupabaseClient;

      await expect(
        startWorkSessionCore(client, "user-1", { kind: "deep_work", objectives: [{ kind: "kill_list_item", killListItemId: "k1" }] })
      ).resolves.toEqual({ id: "s1", startedAt: "2026-09-10T18:00:00.000Z" });
    });

    it("accepts a session whose only objective is a real task selection", async () => {
      const workSessions = makeChain();
      workSessions.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
      workSessions.single = vi.fn(async () => ({ data: { id: "s1", started_at: "2026-09-10T18:00:00.000Z" }, error: null }));
      const objectivesTable = makeChain({ data: null, error: null });
      const from = vi.fn((table: string) => (table === "work_sessions" ? workSessions : objectivesTable));
      const client = { from } as unknown as SupabaseClient;

      await expect(
        startWorkSessionCore(client, "user-1", { kind: "deep_study", objectives: [{ kind: "task", taskId: "t1" }] })
      ).resolves.toEqual({ id: "s1", startedAt: "2026-09-10T18:00:00.000Z" });
    });

    it("accepts a session with a non-blank custom objective alongside blank ones", async () => {
      const workSessions = makeChain();
      workSessions.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
      workSessions.single = vi.fn(async () => ({ data: { id: "s1", started_at: "2026-09-10T18:00:00.000Z" }, error: null }));
      const objectivesTable = makeChain({ data: null, error: null });
      const from = vi.fn((table: string) => (table === "work_sessions" ? workSessions : objectivesTable));
      const client = { from } as unknown as SupabaseClient;

      await expect(
        startWorkSessionCore(client, "user-1", { kind: "deep_work", objectives: [{ kind: "custom", customText: "Write the draft" }] })
      ).resolves.toEqual({ id: "s1", startedAt: "2026-09-10T18:00:00.000Z" });
    });
  });

  it("inserts objectives keyed by array order as position, mapping each kind to its own DB column", async () => {
    const workSessions = makeChain();
    workSessions.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    workSessions.single = vi.fn(async () => ({ data: { id: "s1", started_at: "2026-09-10T18:00:00.000Z" }, error: null }));
    const objectives = makeChain({ data: null, error: null });
    const from = vi.fn((table: string) => (table === "work_sessions" ? workSessions : objectives));
    const client = { from } as unknown as SupabaseClient;

    await startWorkSessionCore(client, "user-1", {
      kind: "deep_work",
      goalMinutes: 30,
      classId: null,
      objectives: [
        { kind: "kill_list_item", killListItemId: "k1" },
        { kind: "task", taskId: "t1" },
        { kind: "custom", customText: "Draft it" },
      ],
    });

    expect(objectives.insert).toHaveBeenCalledWith([
      { user_id: "user-1", session_id: "s1", position: 0, kind: "kill_list_item", kill_list_item_id: "k1", task_id: null, custom_text: null },
      { user_id: "user-1", session_id: "s1", position: 1, kind: "task", kill_list_item_id: null, task_id: "t1", custom_text: null },
      { user_id: "user-1", session_id: "s1", position: 2, kind: "custom", kill_list_item_id: null, task_id: null, custom_text: "Draft it" },
    ]);
  });

  // NOTE: the old "no objectives selected -> no work_session_objectives
  // write" test that lived here is superseded, not merely moved — #37
  // (above) means "no objectives were selected" is no longer a legal call
  // at all; it's covered by "rejects a session with no objectives at all,
  // before ever touching the database" in the #37 describe block above.

  it("deletes the just-created session if the objectives insert fails — never a session missing objectives it was supposed to have", async () => {
    const workSessions = makeChain();
    workSessions.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    workSessions.single = vi.fn(async () => ({ data: { id: "s1", started_at: "2026-09-10T18:00:00.000Z" }, error: null }));
    const objectives = makeChain({ data: null, error: { message: "boom" } });
    const from = vi.fn((table: string) => (table === "work_sessions" ? workSessions : objectives));
    const client = { from } as unknown as SupabaseClient;

    await expect(
      startWorkSessionCore(client, "user-1", { kind: "deep_work", objectives: [{ kind: "custom", customText: "x" }] })
    ).rejects.toThrow();

    expect(workSessions.delete).toHaveBeenCalledTimes(1);
    expect(workSessions.eq).toHaveBeenCalledWith("id", "s1");
  });
});

describe("endWorkSessionCore", () => {
  it("throws when the session doesn't exist or isn't the caller's", async () => {
    const chain = makeChain({ data: null, error: null });
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    await expect(endWorkSessionCore(client, "user-1", "s1")).rejects.toThrow();
    expect(chain.update).not.toHaveBeenCalled();
  });

  it("uses the given endedAtIso when provided (the auto-end timestamp rule), not the wall clock", async () => {
    const chain = makeChain({ data: { id: "s1", ended_at: null }, error: null });
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    await endWorkSessionCore(client, "user-1", "s1", "2026-09-10T18:30:00.000Z");

    expect(chain.update).toHaveBeenCalledWith({ ended_at: "2026-09-10T18:30:00.000Z" });
  });

  it("falls back to the wall clock when endedAtIso is omitted (a manual End Session tap)", async () => {
    const chain = makeChain({ data: { id: "s1", ended_at: null }, error: null });
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    const before = Date.now();
    await endWorkSessionCore(client, "user-1", "s1");
    const call = chain.update.mock.calls[0]![0] as { ended_at: string };
    expect(new Date(call.ended_at).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("idempotency: an already-ended session is a no-op — never touches update at all", async () => {
    const chain = makeChain({ data: { id: "s1", ended_at: "2026-09-10T18:00:00.000Z" }, error: null });
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    await endWorkSessionCore(client, "user-1", "s1");

    expect(chain.update).not.toHaveBeenCalled();
  });

  it("idempotency: a genuine retry (seed a row, call twice, real time between calls) preserves the original ended_at byte-for-byte — team-lead's brief", async () => {
    // Stateful fake: unlike makeChain (fixed resolvedValue regardless of
    // prior writes), this actually applies the UPDATE so the second call's
    // SELECT sees what the first call wrote -- the only way to prove a
    // retry doesn't drift the timestamp forward instead of just reporting
    // whatever the test told it to.
    let row: { id: string; ended_at: string | null } | null = { id: "s1", ended_at: null };
    const from = vi.fn(() => {
      let patch: Record<string, unknown> | null = null;
      let guardCol: string | null = null;
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.is = vi.fn((col: string) => {
        guardCol = col; // endWorkSessionCore only ever guards on "ended_at" -- if the guarded column isn't currently null, the write below must not apply
        return chain;
      });
      chain.maybeSingle = vi.fn(async () => ({ data: row ? { ...row } : null, error: null }));
      chain.update = vi.fn((p: Record<string, unknown>) => {
        patch = { ...p };
        return chain;
      });
      chain.then = (resolve: (v: { error: null }) => void) => {
        if (patch && row && (!guardCol || (row as Record<string, unknown>)[guardCol] === null)) {
          row = { ...row, ...patch } as typeof row;
        }
        return resolve({ error: null });
      };
      return chain;
    });
    const client = { from } as unknown as SupabaseClient;

    await endWorkSessionCore(client, "user-1", "s1");
    const firstEndedAt = row!.ended_at;
    expect(firstEndedAt).toEqual(expect.any(String));

    await new Promise((resolve) => setTimeout(resolve, 15)); // genuinely separate instants, not a transaction-frozen now()

    await endWorkSessionCore(client, "user-1", "s1"); // retry -- same call again
    const secondEndedAt = row!.ended_at;

    expect(secondEndedAt).toBe(firstEndedAt);
  });
});

describe("toggleSessionObjectiveCore — derive, not mirror", () => {
  it("throws when the objective doesn't exist or isn't the caller's", async () => {
    const chain = makeChain({ data: null, error: null });
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    await expect(toggleSessionObjectiveCore(client, "user-1", "obj-1")).rejects.toThrow();
  });

  it("kind=kill_list_item: writes through to kill_list_items, never to this table's own completed column", async () => {
    const objectives = makeChain({
      data: { id: "obj-1", kind: "kill_list_item", kill_list_item_id: "k1", task_id: null, completed: false },
      error: null,
    });
    const killListItems = makeChain({ data: { completed: false }, error: null });
    const from = vi.fn((table: string) => (table === "work_session_objectives" ? objectives : killListItems));
    const client = { from } as unknown as SupabaseClient;

    await toggleSessionObjectiveCore(client, "user-1", "obj-1");

    expect(from).toHaveBeenCalledWith("kill_list_items");
    expect(killListItems.update).toHaveBeenCalledWith(expect.objectContaining({ completed: true }));
    expect(objectives.update).not.toHaveBeenCalled();
  });

  it("kind=task: writes through to tasks, never to this table's own completed column", async () => {
    const objectives = makeChain({
      data: { id: "obj-1", kind: "task", kill_list_item_id: null, task_id: "t1", completed: false },
      error: null,
    });
    const tasks = makeChain({ data: { completed: false }, error: null });
    const from = vi.fn((table: string) => (table === "work_session_objectives" ? objectives : tasks));
    const client = { from } as unknown as SupabaseClient;

    await toggleSessionObjectiveCore(client, "user-1", "obj-1");

    expect(from).toHaveBeenCalledWith("tasks");
    expect(tasks.update).toHaveBeenCalledWith(expect.objectContaining({ completed: true }));
    expect(objectives.update).not.toHaveBeenCalled();
  });

  it("kind=custom: this table's own completed column IS the source of truth — writes it directly", async () => {
    const objectives = makeChain({
      data: { id: "obj-1", kind: "custom", kill_list_item_id: null, task_id: null, completed: false },
      error: null,
    });
    const from = vi.fn(() => objectives);
    const client = { from } as unknown as SupabaseClient;

    await toggleSessionObjectiveCore(client, "user-1", "obj-1");

    expect(objectives.update).toHaveBeenCalledWith(expect.objectContaining({ completed: true }));
  });
});
