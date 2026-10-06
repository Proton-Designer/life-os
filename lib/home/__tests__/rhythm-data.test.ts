import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
const hours = vi.fn(async (..._a: unknown[]) => 90);
vi.mock("@/lib/evening-close/hours-today", () => ({ getHoursTodayMinutes: (...a: unknown[]) => hours(...a) }));

import { getRhythmData } from "../rhythm-data";

type Rows = { day_starts: unknown[]; evening_closes: unknown[]; tasks: unknown[] };
function fake(rows: Rows) {
  const tables: string[] = [];
  const eqs: [string, string, unknown][] = [];
  const from = vi.fn((table: keyof Rows) => {
    tables.push(table);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "gte", "lt", "not", "order"]) chain[m] = vi.fn(() => chain);
    chain.eq = vi.fn((c: string, v: unknown) => {
      eqs.push([table, c, v]);
      return chain;
    });
    chain.maybeSingle = vi.fn(async () => ({ data: rows[table][0] ?? null, error: null }));
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: rows[table], error: null });
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, tables, eqs };
}

const CHI = "America/Chicago";
const at = (l: string) => new Date(`${l}-05:00`);
const WOKE = { local_date: "2026-10-05", woke_at: "2026-10-05T12:00:00Z" };

describe("getRhythmData", () => {
  beforeEach(() => vi.clearAllMocks());

  it("morning (before Start Day): reads last night's ranked tasks only -- no hours query", async () => {
    const f = fake({ day_starts: [], evening_closes: [], tasks: [{ id: "a", title: "Ship", mit_rank: 1, completed: false }] });
    const d = await getRhythmData(f.client, "u", at("2026-10-05T09:00:00"), CHI);
    expect(d.state).toBe("morning");
    expect(d.state === "morning" && d.plan).toHaveLength(1);
    expect(hours).not.toHaveBeenCalled();
    expect(f.eqs).toContainEqual(["tasks", "planned_date", "2026-10-05"]);
  });

  it("today (after Start Day): runs the hours read, no tasks plan query", async () => {
    const f = fake({ day_starts: [WOKE], evening_closes: [], tasks: [] });
    const d = await getRhythmData(f.client, "u", at("2026-10-05T13:00:00"), CHI);
    expect(d.state).toBe("today");
    expect(hours).toHaveBeenCalledTimes(1);
    expect(f.tables).not.toContain("tasks");
  });

  it("wind_down from 21:00: only the two state reads, nothing else", async () => {
    const f = fake({ day_starts: [WOKE], evening_closes: [], tasks: [] });
    const d = await getRhythmData(f.client, "u", at("2026-10-05T21:00:00"), CHI);
    expect(d.state).toBe("wind_down");
    expect(f.tables.sort()).toEqual(["day_starts", "evening_closes"]);
  });

  it("done: the close for the effective day exists -> tomorrow's three (effective day + 1)", async () => {
    const f = fake({ day_starts: [WOKE], evening_closes: [{ local_date: "2026-10-05", closed_at: "x" }], tasks: [{ id: "t", title: "Essay", mit_rank: 1 }] });
    const d = await getRhythmData(f.client, "u", at("2026-10-05T22:00:00"), CHI);
    expect(d).toMatchObject({ state: "done", tomorrow: [{ id: "t", title: "Essay", mitRank: 1 }] });
    expect(f.eqs).toContainEqual(["tasks", "planned_date", "2026-10-06"]);
  });

  it("00:30 on Oct 5 looks up the close of OCT 4 (the 4 AM rollover), not Oct 5", async () => {
    const f = fake({ day_starts: [], evening_closes: [{ local_date: "2026-10-04", closed_at: "x" }], tasks: [] });
    const d = await getRhythmData(f.client, "u", at("2026-10-05T00:30:00"), CHI);
    expect(d.state).toBe("done");
    expect(f.eqs).toContainEqual(["tasks", "planned_date", "2026-10-05"]); // tomorrow of Oct 4
  });

  // IA-P4b: the wind-down plan moves the flip and supplies "Lights out by".
  it("a plan's windDownStart moves the wind_down flip (22:15 start: 21:30 is still 'today'), and bedtime rides along", async () => {
    const f = fake({ day_starts: [WOKE], evening_closes: [], tasks: [] });
    const early = await getRhythmData(f.client, "u", at("2026-10-05T21:30:00"), CHI, { windDownStart: "22:15", bedtime: "23:00" });
    expect(early.state).toBe("today");
    const late = await getRhythmData(fake({ day_starts: [WOKE], evening_closes: [], tasks: [] }).client, "u", at("2026-10-05T22:15:00"), CHI, { windDownStart: "22:15", bedtime: "23:00" });
    expect(late).toEqual({ state: "wind_down", bedtime: "23:00" });
    const done = await getRhythmData(fake({ day_starts: [WOKE], evening_closes: [{ local_date: "2026-10-05", closed_at: "x" }], tasks: [] }).client, "u", at("2026-10-05T23:00:00"), CHI, { windDownStart: "22:15", bedtime: "23:00" });
    expect(done).toMatchObject({ state: "done", bedtime: "23:00" });
  });
});
