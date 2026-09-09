// @vitest-environment node
//
// Not a crypto-dependent file, but deliberately run under Node's real clock
// rather than jsdom's for this one: vi.setSystemTime + Intl.DateTimeFormat
// (which localDateString uses) behaved identically in both envs when
// spot-checked, but node is the closer match to where this code actually
// runs (a Vercel serverless function), and there is no reason to take on
// jsdom's timezone/Intl quirks for a test that doesn't need a DOM at all.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listTasksDueTodayTool } from "../list-tasks-due-today";

function makeClient(opts: { timezone: string | null; tasks: unknown[]; tasksError?: unknown }) {
  const tasksChain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) tasksChain[m] = vi.fn(() => tasksChain);
  const tasksResolved = { data: opts.tasksError ? null : opts.tasks, error: opts.tasksError ?? null };
  tasksChain.then = (resolve: (v: typeof tasksResolved) => void) => resolve(tasksResolved);

  const profileChain: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) profileChain[m] = vi.fn(() => profileChain);
  profileChain.maybeSingle = vi.fn(async () => ({ data: opts.timezone ? { timezone: opts.timezone } : null, error: null }));

  const from = vi.fn((table: string) => (table === "tasks" ? tasksChain : profileChain));
  return { client: { from } as unknown as SupabaseClient, from, tasksChain, profileChain };
}

describe("listTasksDueTodayTool — AGENTS.md's timezone rule, the class of bug hit three times in one night", () => {
  beforeEach(() => {
    // 23:30 UTC: already the next calendar day east of UTC, still the SAME
    // calendar day in America/Chicago (UTC-5 in September) — the exact
    // shape of the bug AGENTS.md documents (Ayman's own prayer-times
    // incident, 19:00 local onward reading as tomorrow in UTC).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T23:30:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the account's OWN timezone to compute 'today' — America/Chicago stays on the earlier date", async () => {
    const { client, tasksChain } = makeClient({ timezone: "America/Chicago", tasks: [] });
    const outcome = await listTasksDueTodayTool(client, "user-1");

    expect(tasksChain.eq).toHaveBeenCalledWith("due_date", "2026-09-08");
    expect(outcome.result.structuredContent).toEqual({ date: "2026-09-08", tasks: [] });
  });

  it("the SAME instant rolls over to the next date east of UTC — proves the bug would invert there, not just disappear", async () => {
    const { tasksChain, client } = makeClient({ timezone: "Asia/Tokyo", tasks: [] });
    const outcome = await listTasksDueTodayTool(client, "user-1");

    expect(tasksChain.eq).toHaveBeenCalledWith("due_date", "2026-09-09");
    expect(outcome.result.structuredContent).toEqual({ date: "2026-09-09", tasks: [] });
  });

  it("defaults to UTC when the account has no timezone set yet, rather than throwing", async () => {
    const { tasksChain, client } = makeClient({ timezone: null, tasks: [] });
    await listTasksDueTodayTool(client, "user-1");
    expect(tasksChain.eq).toHaveBeenCalledWith("due_date", "2026-09-08"); // UTC date at this instant
  });

  it("scopes the tasks query to this user and returns them with a count-bearing summary", async () => {
    const rows = [{ id: "1" }, { id: "2" }];
    const { tasksChain, client } = makeClient({ timezone: "UTC", tasks: rows });
    const outcome = await listTasksDueTodayTool(client, "user-42");

    expect(tasksChain.eq).toHaveBeenCalledWith("user_id", "user-42");
    expect(outcome.summary).toBe("returned 2 task(s) due 2026-09-08");
  });

  it("throws on a tasks query error", async () => {
    const { client } = makeClient({ timezone: "UTC", tasks: [], tasksError: { message: "query broke" } });
    await expect(listTasksDueTodayTool(client, "user-1")).rejects.toThrow(/query broke/);
  });
});
