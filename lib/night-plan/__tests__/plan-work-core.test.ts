import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { activeSessionForTaskCore, bankSecondsCore, endSessionAndBankCore, markSessionPausedCore, pauseTaskTimerCore, planTaskIdForSessionCore, resumePausedSessionCore, settleTaskWorkCore } from "../plan-work-core";

type Row = Record<string, unknown>;

/**
 * A STATEFUL in-memory fake of the Supabase builder (tasks, work_sessions, work_session_objectives): updates really change
 * rows and a guarded update (an `eq` on the value read) really matches nothing once another call changed it. That is what
 * lets these tests prove the banking is idempotent instead of just recording the calls.
 */
function fake(tables: Record<string, Row[]>) {
  const client = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters: ((r: Row) => boolean)[] = [];
      let patch: Row | null = null;
      let wantRows = false;
      const matched = () => rows.filter((r) => filters.every((f) => f(r)));
      const builder: Record<string, unknown> = {};
      builder.select = () => {
        wantRows = true;
        return builder;
      };
      builder.update = (p: Row) => {
        patch = p;
        return builder;
      };
      builder.eq = (col: string, v: unknown) => (filters.push((r) => r[col] === v), builder);
      builder.is = (col: string, v: unknown) => (filters.push((r) => (v === null ? r[col] === null || r[col] === undefined : r[col] === v)), builder);
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.in = (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), builder);
      builder.not = (col: string, _op: string, v: unknown) => (filters.push((r) => (v === null ? r[col] !== null && r[col] !== undefined : r[col] !== v)), builder);
      const run = () => {
        const hit = matched();
        if (patch) for (const r of hit) Object.assign(r, patch);
        return { data: patch && !wantRows ? null : hit.map((r) => ({ ...r })), error: null };
      };
      builder.maybeSingle = () => Promise.resolve({ data: run().data?.[0] ?? null, error: null });
      builder.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, err);
      return builder;
    },
  };
  return { client: client as never, tables };
}

const U = "u1";
const task = (over: Row = {}): Row => ({ id: "t1", user_id: U, kill_list_item_id: null, planned_date: "2026-10-07", timer_started_at: null, timer_elapsed_seconds: 0, ...over });
const session = (over: Row = {}): Row => ({ id: "s1", user_id: U, started_at: "2026-10-07T15:00:00.000Z", ended_at: null, counts_toward_hours: true, kind: "deep_work", ...over });
const objective = (over: Row = {}): Row => ({ session_id: "s1", kind: "task", task_id: "t1", kill_list_item_id: null, ...over });

describe("pauseTaskTimerCore: banks the running stretch once", () => {
  const NOW = new Date("2026-10-07T15:12:04.000Z");

  it("banks now - timer_started_at (server instants) and clears the start", async () => {
    const f = fake({ tasks: [task({ timer_started_at: "2026-10-07T15:00:00.000Z", timer_elapsed_seconds: 100 })] });
    const res = await pauseTaskTimerCore(f.client, U, "t1", NOW);
    expect(res).toEqual({ elapsedSeconds: 824, paused: true }); // 100 banked + 724 running
    expect(f.tables.tasks![0]).toMatchObject({ timer_started_at: null, timer_elapsed_seconds: 824 });
  });

  it("a SECOND call banks nothing (already paused)", async () => {
    const f = fake({ tasks: [task({ timer_started_at: "2026-10-07T15:00:00.000Z" })] });
    await pauseTaskTimerCore(f.client, U, "t1", NOW);
    const again = await pauseTaskTimerCore(f.client, U, "t1", new Date("2026-10-07T16:00:00.000Z"));
    expect(again).toEqual({ elapsedSeconds: 724, paused: false });
    expect(f.tables.tasks![0]!.timer_elapsed_seconds).toBe(724);
  });

  it("two CONCURRENT taps (both read the running timer) bank it exactly once: the guarded update matches only the first", async () => {
    const f = fake({ tasks: [task({ timer_started_at: "2026-10-07T15:00:00.000Z" })] });
    const [a, b] = await Promise.all([pauseTaskTimerCore(f.client, U, "t1", NOW), pauseTaskTimerCore(f.client, U, "t1", new Date(NOW.getTime() + 5000))]);
    expect([a.paused, b.paused].filter(Boolean)).toHaveLength(1);
    expect(f.tables.tasks![0]!.timer_elapsed_seconds).toBe(724); // not 724 + 729
  });

  it("not running: a no-op that reports what is banked; a missing task throws", async () => {
    const f = fake({ tasks: [task({ timer_elapsed_seconds: 300 })] });
    expect(await pauseTaskTimerCore(f.client, U, "t1", NOW)).toEqual({ elapsedSeconds: 300, paused: false });
    await expect(pauseTaskTimerCore(f.client, U, "nope", NOW)).rejects.toThrow("Task not found");
  });

  it("never banks a negative stretch (a start in the future)", async () => {
    const f = fake({ tasks: [task({ timer_started_at: "2026-10-07T16:00:00.000Z" })] });
    expect((await pauseTaskTimerCore(f.client, U, "t1", NOW)).elapsedSeconds).toBe(0);
  });
});

describe("bankSecondsCore", () => {
  it("adds to the bank; zero or negative adds nothing", async () => {
    const f = fake({ tasks: [task({ timer_elapsed_seconds: 10 })] });
    expect(await bankSecondsCore(f.client, U, "t1", 90)).toBe(100);
    expect(await bankSecondsCore(f.client, U, "t1", 0)).toBe(0);
    expect(await bankSecondsCore(f.client, U, "t1", -5)).toBe(0);
    expect(f.tables.tasks![0]!.timer_elapsed_seconds).toBe(100);
  });
});

describe("endSessionAndBankCore: ends through endWorkSessionCore and banks the DB-recorded duration, once", () => {
  const ENDED = "2026-10-07T15:12:04.000Z"; // 12m04s after the session started

  it("a session whose objective is a plan task banks ended_at - started_at into that task", async () => {
    const f = fake({ tasks: [task()], work_sessions: [session()], work_session_objectives: [objective()] });
    const res = await endSessionAndBankCore(f.client, U, "s1", ENDED);
    expect(res).toEqual({ ended: true, bankedSeconds: 724, taskId: "t1", elapsedSeconds: 724 });
    expect(f.tables.work_sessions![0]!.ended_at).toBe(ENDED);
    expect(f.tables.tasks![0]!.timer_elapsed_seconds).toBe(724);
  });

  it("IDEMPOTENT: ending the same session again (a retry, a double tap) banks nothing", async () => {
    const f = fake({ tasks: [task()], work_sessions: [session()], work_session_objectives: [objective()] });
    await endSessionAndBankCore(f.client, U, "s1", ENDED);
    const again = await endSessionAndBankCore(f.client, U, "s1", "2026-10-07T16:30:00.000Z");
    expect(again).toEqual({ ended: false, bankedSeconds: 0, taskId: null, elapsedSeconds: null });
    expect(f.tables.tasks![0]!.timer_elapsed_seconds).toBe(724);
    expect(f.tables.work_sessions![0]!.ended_at).toBe(ENDED); // never re-stamped forward
  });

  it("two CONCURRENT ends bank exactly once", async () => {
    const f = fake({ tasks: [task()], work_sessions: [session()], work_session_objectives: [objective()] });
    await Promise.all([endSessionAndBankCore(f.client, U, "s1", ENDED), endSessionAndBankCore(f.client, U, "s1", ENDED)]);
    expect(f.tables.tasks![0]!.timer_elapsed_seconds).toBe(724);
  });

  it("a session working on the line's PAIRED Kill List item banks into the plan task", async () => {
    const f = fake({ tasks: [task({ kill_list_item_id: "k1" })], work_sessions: [session()], work_session_objectives: [objective({ kind: "kill_list_item", task_id: null, kill_list_item_id: "k1" })] });
    expect((await endSessionAndBankCore(f.client, U, "s1", ENDED)).taskId).toBe("t1");
    expect(f.tables.tasks![0]!.timer_elapsed_seconds).toBe(724);
  });

  it("a session NOT working on a plan task (custom objective, or a task with no planned_date) ends normally and banks nothing", async () => {
    const custom = fake({ tasks: [task()], work_sessions: [session()], work_session_objectives: [objective({ kind: "custom", task_id: null })] });
    expect(await endSessionAndBankCore(custom.client, U, "s1", ENDED)).toMatchObject({ ended: true, bankedSeconds: 0, taskId: null });
    const unplanned = fake({ tasks: [task({ planned_date: null })], work_sessions: [session()], work_session_objectives: [objective()] });
    expect(await endSessionAndBankCore(unplanned.client, U, "s1", ENDED)).toMatchObject({ ended: true, bankedSeconds: 0, taskId: null });
    expect(unplanned.tables.tasks![0]!.timer_elapsed_seconds).toBe(0);
    expect(unplanned.tables.work_sessions![0]!.ended_at).toBe(ENDED);
  });

  it("a session over SEVERAL plan tasks is not 'a plan line's session': it ends and banks nothing (no double counting)", async () => {
    const f = fake({ tasks: [task(), task({ id: "t2" })], work_sessions: [session()], work_session_objectives: [objective(), objective({ task_id: "t2" })] });
    expect(await planTaskIdForSessionCore(f.client, U, "s1")).toBeNull();
    expect(await endSessionAndBankCore(f.client, U, "s1", ENDED)).toMatchObject({ ended: true, bankedSeconds: 0 });
    expect(f.tables.tasks!.map((t) => t.timer_elapsed_seconds)).toEqual([0, 0]);
  });

  it("a caller that already knows the plan line (Pause / Mark Done pressed on it) banks into it without the lookup", async () => {
    // the objectives are not even needed: the line is named by the caller
    const f = fake({ tasks: [task()], work_sessions: [session()], work_session_objectives: [] });
    expect(await endSessionAndBankCore(f.client, U, "s1", ENDED, "t1")).toEqual({ ended: true, bankedSeconds: 724, taskId: "t1", elapsedSeconds: 724 });
    // and a SECOND call with the hint still banks nothing: the guard is the end, not the lookup
    expect((await endSessionAndBankCore(f.client, U, "s1", ENDED, "t1")).ended).toBe(false);
    expect(f.tables.tasks![0]!.timer_elapsed_seconds).toBe(724);
  });

  it("a RESUMED session banks on top of what was already banked", async () => {
    const f = fake({ tasks: [task({ timer_elapsed_seconds: 600 })], work_sessions: [session()], work_session_objectives: [objective()] });
    expect((await endSessionAndBankCore(f.client, U, "s1", ENDED)).elapsedSeconds).toBe(1324);
  });
});

describe("activeSessionForTaskCore / settleTaskWorkCore", () => {
  it("finds the active session working on this line, and not one working on another", async () => {
    const f = fake({ tasks: [task()], work_sessions: [session()], work_session_objectives: [objective({ task_id: "other" })] });
    expect(await activeSessionForTaskCore(f.client, U, { id: "t1", kill_list_item_id: null })).toBeNull();
    const g = fake({ tasks: [task()], work_sessions: [session()], work_session_objectives: [objective()] });
    expect(await activeSessionForTaskCore(g.client, U, { id: "t1", kill_list_item_id: null })).toBe("s1");
  });

  it("Mark Done while a session runs: ends it, banks it once, and reports the session ended", async () => {
    const f = fake({ tasks: [task()], work_sessions: [session({ started_at: new Date(Date.now() - 600_000).toISOString() })], work_session_objectives: [objective()] });
    const res = await settleTaskWorkCore(f.client, U, "t1", new Date());
    expect(res.sessionEnded).toBe(true);
    expect(f.tables.work_sessions![0]!.ended_at).not.toBeNull();
    expect(f.tables.tasks![0]!.timer_elapsed_seconds as number).toBeGreaterThanOrEqual(599);
  });

  it("Mark Done while an inline timer runs banks the stretch; while idle it changes nothing", async () => {
    const running = fake({ tasks: [task({ timer_started_at: "2026-10-07T15:00:00.000Z" })] });
    expect(await settleTaskWorkCore(running.client, U, "t1", new Date("2026-10-07T15:05:00.000Z"))).toEqual({ sessionEnded: false });
    expect(running.tables.tasks![0]).toMatchObject({ timer_started_at: null, timer_elapsed_seconds: 300 });
    const idle = fake({ tasks: [task()] });
    await settleTaskWorkCore(idle.client, U, "t1", new Date());
    expect(idle.tables.tasks![0]!.timer_elapsed_seconds).toBe(0);
  });
});

describe("pause keeps the session; resume re-opens the same row", () => {
  const T = { id: "t1", kill_list_item_id: null };
  it("pause -> resume -> pause: ONE row, active time only, nothing counted twice", async () => {
    const f = fake({ tasks: [task()], work_sessions: [session({ started_at: "2026-10-07T15:00:00.000Z" })], work_session_objectives: [objective()] });
    // Pause after 10 minutes of work.
    await endSessionAndBankCore(f.client, U, "s1", "2026-10-07T15:10:00.000Z", "t1");
    await markSessionPausedCore(f.client, U, "s1");
    expect(f.tables.tasks![0]!.timer_elapsed_seconds).toBe(600);
    expect(f.tables.work_sessions![0]).toMatchObject({ ended_at: "2026-10-07T15:10:00.000Z", paused_at: "2026-10-07T15:10:00.000Z" });

    // Resume 5 minutes later: the same row is open again, its start moved forward by the 5 paused minutes.
    const id = await resumePausedSessionCore(f.client, U, T, new Date("2026-10-07T15:15:00.000Z"));
    expect(id).toBe("s1");
    expect(f.tables.work_sessions).toHaveLength(1);
    expect(f.tables.work_sessions![0]).toMatchObject({ ended_at: null, paused_at: null, started_at: "2026-10-07T15:05:00.000Z", original_started_at: "2026-10-07T15:00:00.000Z" });
    expect(f.tables.tasks![0]!.timer_elapsed_seconds).toBe(0); // the running session counts its own 10 minutes

    // 4 more minutes of work, pause again: the bank is the whole 14 active minutes.
    await endSessionAndBankCore(f.client, U, "s1", "2026-10-07T15:19:00.000Z", "t1");
    expect(f.tables.tasks![0]!.timer_elapsed_seconds).toBe(840);
  });

  it("a double tap on Resume re-opens once; a line with no paused session gets null (the caller starts a new one)", async () => {
    const f = fake({ tasks: [task({ timer_elapsed_seconds: 600 })], work_sessions: [session({ ended_at: "2026-10-07T15:10:00.000Z", paused_at: "2026-10-07T15:10:00.000Z" })], work_session_objectives: [objective()] });
    expect(await resumePausedSessionCore(f.client, U, T, new Date("2026-10-07T15:12:00.000Z"))).toBe("s1");
    await expect(resumePausedSessionCore(f.client, U, T, new Date("2026-10-07T15:12:01.000Z"))).resolves.toBeNull();
    expect(await resumePausedSessionCore(fake({ tasks: [task()], work_sessions: [session({ ended_at: "2026-10-07T15:10:00.000Z" })], work_session_objectives: [objective()] }).client, U, T, new Date())).toBeNull();
  });

  it("refuses while another session is running", async () => {
    const f = fake({ tasks: [task()], work_sessions: [session({ ended_at: "2026-10-07T15:10:00.000Z", paused_at: "2026-10-07T15:10:00.000Z" }), session({ id: "s2" })], work_session_objectives: [objective()] });
    await expect(resumePausedSessionCore(f.client, U, T, new Date("2026-10-07T15:12:00.000Z"))).rejects.toThrow(/already active/);
  });
});
