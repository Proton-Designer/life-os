import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { correctSessionLengthCore } from "../session-correction-core";
import { checkCorrectedLength, looksLeftRunning } from "../session-correction";

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
const START = "2026-10-12T22:00:00.000Z";
const END = "2026-10-13T12:00:00.000Z"; // left running 14h
const session = (over: Row = {}): Row => ({ id: "s1", user_id: U, started_at: START, ended_at: END, counts_toward_hours: true, ...over });

describe("looksLeftRunning", () => {
  it("flags 4h+ and far-past-plan sessions, not ordinary ones", () => {
    expect(looksLeftRunning(14 * 60, null)).toBe(true);
    expect(looksLeftRunning(60, 60)).toBe(false);
    expect(looksLeftRunning(200, 60)).toBe(true);
    expect(looksLeftRunning(90, 60)).toBe(false);
  });
});

describe("checkCorrectedLength", () => {
  it("only accepts a shorter whole-minute length", () => {
    expect(checkCorrectedLength(START, END, 60)).toMatchObject({ ok: true, endedAtIso: "2026-10-12T23:00:00.000Z", newSeconds: 3600 });
    expect(checkCorrectedLength(START, END, 0).ok).toBe(false);
    expect(checkCorrectedLength(START, END, 1.5).ok).toBe(false);
    expect(checkCorrectedLength(START, END, 14 * 60).ok).toBe(false);
    expect(checkCorrectedLength(START, END, 20 * 60).ok).toBe(false);
  });
});

describe("correctSessionLengthCore", () => {
  it("moves ended_at and takes the extra time back out of the plan line's bank", async () => {
    const f = fake({
      work_sessions: [session()],
      work_session_objectives: [{ session_id: "s1", kind: "task", task_id: "t1", kill_list_item_id: null }],
      tasks: [{ id: "t1", user_id: U, kill_list_item_id: null, planned_date: "2026-10-12", timer_elapsed_seconds: 14 * 3600 }],
    });
    const res = await correctSessionLengthCore(f.client, U, "s1", 60);
    expect(res).toEqual({ ok: true, endedAtIso: "2026-10-12T23:00:00.000Z" });
    expect(f.tables.work_sessions![0]!.ended_at).toBe("2026-10-12T23:00:00.000Z");
    expect(f.tables.tasks![0]!.timer_elapsed_seconds).toBe(3600);
  });

  it("works for a session with no plan line (nothing to un-bank)", async () => {
    const f = fake({ work_sessions: [session()] });
    expect((await correctSessionLengthCore(f.client, U, "s1", 45)).ok).toBe(true);
    expect(f.tables.work_sessions![0]!.ended_at).toBe("2026-10-12T22:45:00.000Z");
  });

  it("refuses a running session, a non-counting one, another user's, and a longer length - changing nothing", async () => {
    const running = fake({ work_sessions: [session({ ended_at: null })] });
    expect((await correctSessionLengthCore(running.client, U, "s1", 30)).ok).toBe(false);
    const learn = fake({ work_sessions: [session({ counts_toward_hours: false })] });
    expect((await correctSessionLengthCore(learn.client, U, "s1", 30)).ok).toBe(false);
    const other = fake({ work_sessions: [session({ user_id: "u2" })] });
    expect((await correctSessionLengthCore(other.client, U, "s1", 30)).ok).toBe(false);
    expect(other.tables.work_sessions![0]!.ended_at).toBe(END);
    const longer = fake({ work_sessions: [session()] });
    expect((await correctSessionLengthCore(longer.client, U, "s1", 15 * 60)).ok).toBe(false);
    expect(longer.tables.work_sessions![0]!.ended_at).toBe(END);
  });
});
