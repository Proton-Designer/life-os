import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWriteAction, listWriteEntities, listWriteActions, WRITE_REGISTRY } from "../write-registry";
import { ToolNotFoundError } from "../tool-input-error";

function makeClient(opts: { existing?: { completed: boolean } | null; id?: string; error?: unknown } = {}) {
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) chain[m] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () => ({ data: opts.existing ?? null, error: null }));
    chain.upsert = vi.fn(() => chain);
    chain.single = vi.fn(async () => ({
      data: opts.error ? null : { id: opts.id ?? "row-1", logged_at: "2026-09-08T12:00:00.000Z" },
      error: opts.error ?? null,
    }));
    return chain;
  });
  return { from } as unknown as SupabaseClient;
}

describe("write-registry dispatch shape", () => {
  it("getWriteAction finds deen.prayer.log", () => {
    expect(getWriteAction("deen", "prayer", "log")).not.toBeNull();
  });

  it("getWriteAction finds deen.prayer.unlog — R9, wired for real (a status change, never a DELETE)", () => {
    expect(getWriteAction("deen", "prayer", "unlog")).not.toBeNull();
  });

  it("getWriteAction returns null for an unknown domain/entity/action at every level", () => {
    expect(getWriteAction("fitness", "prayer", "log")).toBeNull();
    expect(getWriteAction("deen", "workout", "log")).toBeNull();
    expect(getWriteAction("deen", "prayer", "delete")).toBeNull();
  });

  it("listWriteEntities/listWriteActions reflect exactly what's registered", () => {
    // P4-06 added profile/quran_session/reflection_entry/habit/habit_log/weekly_focus/weekly_goal.
    expect(listWriteEntities("deen").sort()).toEqual([
      "adhkar",
      "habit",
      "habit_log",
      "prayer",
      "profile",
      "quran_session",
      "reflection_entry",
      "sunnah_log",
      "weekly_focus",
      "weekly_goal",
    ]);
    expect(listWriteActions("deen", "prayer")).toEqual(["log", "unlog"]); // R9
    expect(listWriteActions("deen", "sunnah_log")).toEqual(["toggle"]);
    expect(listWriteActions("deen", "adhkar")).toEqual(["toggle"]);
    expect(listWriteActions("deen", "quran_session")).toEqual(["log"]);
    expect(listWriteActions("deen", "profile").sort()).toEqual(["adjust_qada", "set_traveling_mode"]);
    expect(listWriteActions("deen", "reflection_entry")).toEqual(["log"]);
    expect(listWriteActions("deen", "habit").sort()).toEqual(["archive", "create", "set_committed_date", "set_stage_override", "update"]);
    expect(listWriteActions("deen", "habit_log").sort()).toEqual(["set_status", "toggle"]);
    expect(listWriteActions("deen", "weekly_focus")).toEqual(["set"]);
    expect(listWriteActions("deen", "weekly_goal")).toEqual(["save"]);
  });

  it("deen.profile does not collide with settings.profile — the registry keys by domain.entity, not entity alone (P4-06)", () => {
    expect(getWriteAction("deen", "profile", "adjust_qada")).not.toBeNull();
    expect(getWriteAction("deen", "profile", "set_traveling_mode")).not.toBeNull();
    expect(getWriteAction("settings", "profile", "adjust_qada")).toBeNull();
    expect(getWriteAction("deen", "profile", "update")).toBeNull(); // settings.profile's own action, not deen's
    expect(getWriteAction("settings", "profile", "update")).not.toBeNull();
  });

  it("listWriteEntities returns [] for a domain with no write surface at all", () => {
    // self_mastery USED to be this example -- it now writes review/
    // lesson_promotion/self_explanation. calendar is a genuine zero-entity
    // aggregation domain (lib/mcp/registry.ts: "it has no table of its
    // own"), never registered for write at all.
    expect(listWriteEntities("calendar")).toEqual([]);
  });

  it("self_mastery's write surface is exactly grade/record_verdict/log -- never lessons/cards/source_chunks", () => {
    expect(listWriteEntities("self_mastery").sort()).toEqual(["lesson_promotion", "review", "self_explanation"]);
    expect(listWriteActions("self_mastery", "review")).toEqual(["grade"]);
    expect(listWriteActions("self_mastery", "lesson_promotion")).toEqual(["record_verdict"]);
    expect(listWriteActions("self_mastery", "self_explanation")).toEqual(["log"]);
    for (const neverWritable of ["lesson", "card", "card_state", "source_chunks", "book", "book_section", "lesson_verdict"]) {
      expect(listWriteEntities("self_mastery")).not.toContain(neverWritable);
    }
  });
});

describe("deen.prayer.log handler", () => {
  const now = new Date("2026-09-08T20:00:00.000Z");

  it("validates patch.date/prayer_name/status and calls through to markPrayerCore", async () => {
    const action = getWriteAction("deen", "prayer", "log")!;
    const client = makeClient({ id: "p-1" });

    const outcome = await action.handler(
      { userClient: client, userId: "user-1", timezone: "UTC", now },
      { date: "2026-09-08", prayer_name: "fajr", status: "on_time" },
    );

    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toMatchObject({ id: "p-1", date: "2026-09-08", status: "on_time" });
    expect(outcome.summary).toMatch(/fajr/);
  });

  it("REJECTS a missing patch.date", async () => {
    const action = getWriteAction("deen", "prayer", "log")!;
    const client = makeClient();
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { prayer_name: "fajr", status: "on_time" }),
    ).rejects.toThrow(/patch\.date/i);
  });

  it("REJECTS an invalid prayer_name", async () => {
    const action = getWriteAction("deen", "prayer", "log")!;
    const client = makeClient();
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08", prayer_name: "jummah", status: "on_time" }),
    ).rejects.toThrow(/prayer_name/i);
  });

  it("REJECTS an invalid status — never silently coerced", async () => {
    const action = getWriteAction("deen", "prayer", "log")!;
    const client = makeClient();
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08", prayer_name: "fajr", status: "pending" }),
    ).rejects.toThrow(/status/i);
  });

  it("propagates the future-date guard from markPrayerCore (UTC rollover already pinned in actions-core.test.ts)", async () => {
    const action = getWriteAction("deen", "prayer", "log")!;
    const client = makeClient();
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2099-01-01", prayer_name: "fajr", status: "on_time" }),
    ).rejects.toThrow(/after today/i);
  });
});

describe("deen.sunnah_log.toggle handler", () => {
  const now = new Date("2026-09-08T20:00:00.000Z");

  it("validates patch.date/prayer_name/slot and calls through to toggleSunnahCore", async () => {
    const action = getWriteAction("deen", "sunnah_log", "toggle")!;
    const client = makeClient({ existing: { completed: false }, id: "s-1" });

    const outcome = await action.handler(
      { userClient: client, userId: "user-1", timezone: "UTC", now },
      { date: "2026-09-08", prayer_name: "fajr", slot: "before" },
    );

    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toMatchObject({ id: "s-1", completed: true });
  });

  it("REJECTS an invalid slot", async () => {
    const action = getWriteAction("deen", "sunnah_log", "toggle")!;
    const client = makeClient();
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08", prayer_name: "fajr", slot: "during" }),
    ).rejects.toThrow(/slot/i);
  });
});

describe("deen.adhkar.toggle handler", () => {
  const now = new Date("2026-09-08T20:00:00.000Z");

  it("validates patch.date/period and calls through to toggleAdhkarCore — no timezone/now used for the date guard (adhkar has none)", async () => {
    const action = getWriteAction("deen", "adhkar", "toggle")!;
    const client = makeClient({ existing: { completed: true }, id: "a-1" });

    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2099-01-01", period: "morning" });

    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toMatchObject({ id: "a-1", completed: false });
  });

  it("REJECTS an invalid period", async () => {
    const action = getWriteAction("deen", "adhkar", "toggle")!;
    const client = makeClient();
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08", period: "afternoon" }),
    ).rejects.toThrow(/period/i);
  });
});

describe("WRITE_REGISTRY shape — the deliverable the team-lead asked for", () => {
  it("every registered action's handler is an actual function, not a stub", () => {
    for (const domain of Object.values(WRITE_REGISTRY)) {
      for (const entity of Object.values(domain.entities)) {
        for (const action of Object.values(entity.actions)) {
          expect(typeof action.handler).toBe("function");
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// P4-06: quran_session, profile, reflection_entry, habit, habit_log,
// weekly_focus, weekly_goal. Per-table thenable-chain mock (same shape as
// app/(app)/deen/__tests__/actions.test.ts's makeChain) rather than the
// single-table makeClient above — several of these cores touch more than
// one table (profile read-then-write, habit insert-then-select).
// ---------------------------------------------------------------------------

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "update", "insert", "upsert", "delete"]) chain[m] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.single = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

function makeTableClient(chains: Record<string, ReturnType<typeof makeChain>>) {
  const from = vi.fn((table: string) => chains[table] ?? makeChain());
  return { from } as unknown as SupabaseClient;
}

describe("deen.quran_session.log handler", () => {
  const now = new Date("2026-09-08T20:00:00.000Z");

  // The handler itself REQUIRES patch.date (requireString) — a missing date
  // is filled in with the account's local today by write.ts's
  // withDateDefault BEFORE the handler ever runs (lib/agent-api/
  // write-action-meta.ts's DATE_DEFAULTS_TO_TODAY, drift-guarded against
  // write-registry.ts by write-action-meta.test.ts), not by this handler —
  // see that test file for the "defaults to today" proof.

  it("inserts with the given date/pages/surah/juz", async () => {
    const action = getWriteAction("deen", "quran_session", "log")!;
    const client = makeTableClient({ quran_sessions: makeChain({ data: { id: "qs-1" }, error: null }) });

    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08", pages: 5 });

    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toMatchObject({ id: "qs-1", date: "2026-09-08", pagesRead: 5 });
  });

  it("REJECTS a missing patch.date", async () => {
    const action = getWriteAction("deen", "quran_session", "log")!;
    const client = makeTableClient({ quran_sessions: makeChain({ data: { id: "qs-1" }, error: null }) });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { pages: 5 })).rejects.toThrow(/patch\.date/i);
  });

  it("REJECTS a missing patch.pages", async () => {
    const action = getWriteAction("deen", "quran_session", "log")!;
    const client = makeTableClient({ quran_sessions: makeChain({ data: { id: "qs-1" }, error: null }) });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08" })).rejects.toThrow(/patch\.pages/i);
  });

  it("REJECTS an explicit date after today", async () => {
    const action = getWriteAction("deen", "quran_session", "log")!;
    const client = makeTableClient({ quran_sessions: makeChain() });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2099-01-01", pages: 5 }),
    ).rejects.toThrow(/after today/i);
  });
});

describe("deen.profile handlers", () => {
  const now = new Date("2026-09-08T20:00:00.000Z");

  it("adjust_qada clamps at zero", async () => {
    const action = getWriteAction("deen", "profile", "adjust_qada")!;
    const client = makeTableClient({ profiles: makeChain({ data: { qada_owed: 1 }, error: null }) });

    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { delta: -5 });

    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toEqual({ qadaOwed: 0 });
  });

  it("adjust_qada REJECTS a non-number delta", async () => {
    const action = getWriteAction("deen", "profile", "adjust_qada")!;
    const client = makeTableClient({ profiles: makeChain({ data: { qada_owed: 1 }, error: null }) });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { delta: "x" })).rejects.toThrow(/patch\.delta/i);
  });

  it("set_traveling_mode REJECTS a non-boolean enabled", async () => {
    const action = getWriteAction("deen", "profile", "set_traveling_mode")!;
    const client = makeTableClient({ profiles: makeChain() });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { enabled: "yes" })).rejects.toThrow(/patch\.enabled/i);
  });

  it("set_traveling_mode sets the value verbatim", async () => {
    const action = getWriteAction("deen", "profile", "set_traveling_mode")!;
    const client = makeTableClient({ profiles: makeChain() });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { enabled: true });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toEqual({ travelingMode: true });
  });
});

describe("deen.reflection_entry.log handler", () => {
  const now = new Date("2026-09-08T20:00:00.000Z");

  // Same DATE_DEFAULTS_TO_TODAY note as deen.quran_session.log above — a
  // missing date is filled in by write.ts, not this handler.

  it("inserts a tally row for the given date/tier", async () => {
    const action = getWriteAction("deen", "reflection_entry", "log")!;
    const client = makeTableClient({ reflection_entries: makeChain({ data: { id: "re-1" }, error: null }) });

    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08", tier: 2 });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toMatchObject({ id: "re-1", date: "2026-09-08", tier: 2 });
  });

  it("REJECTS a missing patch.date", async () => {
    const action = getWriteAction("deen", "reflection_entry", "log")!;
    const client = makeTableClient({ reflection_entries: makeChain() });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { tier: 2 })).rejects.toThrow(/patch\.date/i);
  });

  it("REJECTS an invalid tier", async () => {
    const action = getWriteAction("deen", "reflection_entry", "log")!;
    const client = makeTableClient({ reflection_entries: makeChain() });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08", tier: 4 }),
    ).rejects.toThrow(/patch\.tier/i);
  });
});

describe("deen.habit handlers", () => {
  const now = new Date("2026-09-08T20:00:00.000Z");

  it("create inserts with committed_date = today", async () => {
    const action = getWriteAction("deen", "habit", "create")!;
    const client = makeTableClient({ deen_habits: makeChain({ data: { id: "habit-1" }, error: null }) });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { name: "Read Qur'an daily" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toEqual({ id: "habit-1" });
  });

  it("create REJECTS a missing name", async () => {
    const action = getWriteAction("deen", "habit", "create")!;
    const client = makeTableClient({ deen_habits: makeChain() });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, {})).rejects.toThrow(/patch\.name/i);
  });

  it("update REQUIRES the top-level id", async () => {
    const action = getWriteAction("deen", "habit", "update")!;
    const client = makeTableClient({ deen_habits: makeChain({ data: [{ id: "habit-1" }], error: null }) });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { name: "x" }),
    ).rejects.toThrow(/requires the top-level.*id/i);
  });

  it("update throws ToolNotFoundError when 0 rows are updated (a9's ruling)", async () => {
    const action = getWriteAction("deen", "habit", "update")!;
    const client = makeTableClient({ deen_habits: makeChain({ data: [], error: null }) });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "not-mine" }, { name: "x" }),
    ).rejects.toBeInstanceOf(ToolNotFoundError);
  });

  it("update succeeds when a row is affected", async () => {
    const action = getWriteAction("deen", "habit", "update")!;
    const client = makeTableClient({ deen_habits: makeChain({ data: [{ id: "habit-1" }], error: null }) });
    const outcome = await action.handler(
      { userClient: client, userId: "user-1", timezone: "UTC", now, id: "habit-1" },
      { name: "Read Qur'an daily", anchor_cue: null },
    );
    expect(outcome.summary).toMatch(/habit-1/);
  });

  it("set_stage_override REJECTS an invalid stage", async () => {
    const action = getWriteAction("deen", "habit", "set_stage_override")!;
    const client = makeTableClient({ deen_habits: makeChain({ data: [{ id: "habit-1" }], error: null }) });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "habit-1" }, { stage: "bogus" }),
    ).rejects.toThrow(/patch\.stage/i);
  });

  it("set_stage_override accepts null (reset to automatic)", async () => {
    const action = getWriteAction("deen", "habit", "set_stage_override")!;
    const client = makeTableClient({ deen_habits: makeChain({ data: [{ id: "habit-1" }], error: null }) });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "habit-1" }, { stage: null });
    expect(outcome.summary).toMatch(/automatic/);
  });

  it("set_committed_date REJECTS a date after today", async () => {
    const action = getWriteAction("deen", "habit", "set_committed_date")!;
    const client = makeTableClient({ deen_habits: makeChain({ data: [{ id: "habit-1" }], error: null }) });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "habit-1" }, { committed_date: "2099-01-01" }),
    ).rejects.toThrow(/after today/i);
  });

  it("set_committed_date REQUIRES committed_date (never defaults to today)", async () => {
    const action = getWriteAction("deen", "habit", "set_committed_date")!;
    const client = makeTableClient({ deen_habits: makeChain({ data: [{ id: "habit-1" }], error: null }) });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "habit-1" }, {}),
    ).rejects.toThrow(/patch\.committed_date/i);
  });
});

describe("deen.habit_log handlers", () => {
  const now = new Date("2026-09-08T20:00:00.000Z");

  // Same DATE_DEFAULTS_TO_TODAY note as quran_session.log/reflection_entry.log above.

  it("toggle flips false->true for the given date", async () => {
    const action = getWriteAction("deen", "habit_log", "toggle")!;
    const client = makeTableClient({ deen_habit_logs: makeChain({ data: { completed: false }, error: null }) });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "habit-1" }, { date: "2026-09-08" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toMatchObject({ habitId: "habit-1", date: "2026-09-08", completed: true });
  });

  it("toggle REJECTS a missing patch.date", async () => {
    const action = getWriteAction("deen", "habit_log", "toggle")!;
    const client = makeTableClient({ deen_habit_logs: makeChain({ data: { completed: false }, error: null }) });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "habit-1" }, {})).rejects.toThrow(/patch\.date/i);
  });

  it("toggle REQUIRES the top-level id", async () => {
    const action = getWriteAction("deen", "habit_log", "toggle")!;
    const client = makeTableClient({ deen_habit_logs: makeChain() });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08" })).rejects.toThrow(/requires the top-level.*id/i);
  });

  it("toggle translates a composite-FK violation (bad habit id) into ToolNotFoundError, not a raw Postgres error", async () => {
    const action = getWriteAction("deen", "habit_log", "toggle")!;
    const client = makeTableClient({
      deen_habit_logs: (() => {
        const chain = makeChain({ data: null, error: null });
        chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
        chain.upsert = vi.fn(() => ({ then: (resolve: (v: unknown) => void) => resolve({ data: null, error: { code: "23503", message: "fk violation" } }) }));
        return chain;
      })(),
    });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "not-a-real-habit" }, { date: "2026-09-08" }),
    ).rejects.toBeInstanceOf(ToolNotFoundError);
  });

  it("set_status REJECTS a missing patch.date", async () => {
    const action = getWriteAction("deen", "habit_log", "set_status")!;
    const client = makeTableClient({ deen_habit_logs: makeChain() });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "habit-1" }, { completed: true }),
    ).rejects.toThrow(/patch\.date/i);
  });

  it("set_status REJECTS a missing completed", async () => {
    const action = getWriteAction("deen", "habit_log", "set_status")!;
    const client = makeTableClient({ deen_habit_logs: makeChain() });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "habit-1" }, { date: "2026-09-08" }),
    ).rejects.toThrow(/patch\.completed/i);
  });

  it("set_status REJECTS a date after today", async () => {
    const action = getWriteAction("deen", "habit_log", "set_status")!;
    const client = makeTableClient({ deen_habit_logs: makeChain() });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "habit-1" }, { date: "2099-01-01", completed: true }),
    ).rejects.toThrow(/after today/i);
  });
});

describe("deen.weekly_focus.set handler", () => {
  const now = new Date("2026-09-08T20:00:00.000Z");

  it("computes week_start_date server-side and upserts", async () => {
    const action = getWriteAction("deen", "weekly_focus", "set")!;
    const client = makeTableClient({ deen_weekly_focus: makeChain() });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "habit-1" }, {});
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toMatchObject({ habitId: "habit-1" });
    expect(JSON.parse(block.text).weekStartDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("REQUIRES the top-level id", async () => {
    const action = getWriteAction("deen", "weekly_focus", "set")!;
    const client = makeTableClient({ deen_weekly_focus: makeChain() });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, {})).rejects.toThrow(/requires the top-level.*id/i);
  });
});

describe("deen.weekly_goal.save handler", () => {
  const now = new Date("2026-09-08T20:00:00.000Z");

  it("upserts with domain fixed to 'deen', milestones/quran_page_target passed through", async () => {
    const action = getWriteAction("deen", "weekly_goal", "save")!;
    const client = makeTableClient({ weekly_goals: makeChain() });
    const outcome = await action.handler(
      { userClient: client, userId: "user-1", timezone: "UTC", now },
      { week_start_date: "2026-09-07", headline: "Finish Juz 3", milestones: ["read daily"], quran_page_target: 10 },
    );
    expect(outcome.summary).toMatch(/2026-09-07/);
  });

  it("REJECTS milestones that aren't an array of strings", async () => {
    const action = getWriteAction("deen", "weekly_goal", "save")!;
    const client = makeTableClient({ weekly_goals: makeChain() });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { week_start_date: "2026-09-07", headline: "x", milestones: [1, 2] }),
    ).rejects.toThrow(/patch\.milestones/i);
  });

  it("REJECTS a missing week_start_date", async () => {
    const action = getWriteAction("deen", "weekly_goal", "save")!;
    const client = makeTableClient({ weekly_goals: makeChain() });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { headline: "x", milestones: [] }),
    ).rejects.toThrow(/patch\.week_start_date/i);
  });
});

// ---------------------------------------------------------------------------
// P4-07: review.night_plan_task/worry/sleep_intent, day.day_start,
// goals.goal/milestone, habits.identity_habit/vote.
// ---------------------------------------------------------------------------

describe("review.night_plan_task handlers", () => {
  const now = new Date("2026-09-08T20:00:00.000Z"); // UTC evening -> local date depends on tz below

  it("dump inserts a note-dumped row for tomorrow (default mode) and returns its id", async () => {
    const action = getWriteAction("review", "night_plan_task", "dump")!;
    const client = makeTableClient({ tasks: makeChain({ data: { id: "t-1" }, error: null }) });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { title: "Buy milk" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toMatchObject({ id: "t-1", planned_date: "2026-09-09" }); // tomorrow of 2026-09-08 UTC
  });

  it("dump REJECTS a missing title", async () => {
    const action = getWriteAction("review", "night_plan_task", "dump")!;
    const client = makeTableClient({ tasks: makeChain() });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, {})).rejects.toThrow(/patch\.title/i);
  });

  it("dump with mode='today' plans local today, not tomorrow", async () => {
    const action = getWriteAction("review", "night_plan_task", "dump")!;
    const client = makeTableClient({ tasks: makeChain({ data: { id: "t-1" }, error: null }) });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { title: "x", mode: "today" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text).planned_date).toBe("2026-09-08");
  });

  it("dump REJECTS an invalid mode", async () => {
    const action = getWriteAction("review", "night_plan_task", "dump")!;
    const client = makeTableClient({ tasks: makeChain() });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { title: "x", mode: "yesterday" })).rejects.toThrow(/patch\.mode/i);
  });

  it("claim_seeds REJECTS an empty/missing seeds array", async () => {
    const action = getWriteAction("review", "night_plan_task", "claim_seeds")!;
    const client = makeTableClient({ tasks: makeChain() });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { seeds: [] })).rejects.toThrow(/patch\.seeds/i);
  });

  it("claim_seeds REJECTS an invalid seed source", async () => {
    const action = getWriteAction("review", "night_plan_task", "claim_seeds")!;
    const client = makeTableClient({ tasks: makeChain() });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { seeds: [{ id: "s1", title: "x", source: "bogus" }] }),
    ).rejects.toThrow(/patch\.seeds\[0\]\.source/i);
  });

  it("claim_seeds claims a worry seed (update path) and a milestone seed (insert path) in one call", async () => {
    const action = getWriteAction("review", "night_plan_task", "claim_seeds")!;
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "update", "insert"]) chain[m] = vi.fn(() => chain);
    let call = 0;
    chain.then = (resolve: (v: unknown) => void) => {
      call += 1;
      // 1st table op is the worry UPDATE...select (array result); 2nd is the milestone INSERT...select (single result via .single()).
      return resolve(call === 1 ? { data: [{ id: "worry-1" }], error: null } : { data: null, error: null });
    };
    chain.single = vi.fn(async () => ({ data: { id: "new-task-1" }, error: null }));
    const client = makeTableClient({ tasks: chain as unknown as ReturnType<typeof makeChain> });

    const outcome = await action.handler(
      { userClient: client, userId: "user-1", timezone: "UTC", now },
      { seeds: [{ id: "worry-1", title: "A worry", source: "worry" }, { id: "milestone-1", title: "A milestone", source: "goal_milestone" }] },
    );
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    const parsed = JSON.parse(block.text);
    expect(parsed.claimed).toEqual(
      expect.arrayContaining([{ seedId: "worry-1", taskId: "worry-1" }, { seedId: "milestone-1", taskId: "new-task-1" }]),
    );
  });

  it("save_ranks REJECTS starred that isn't an array of strings", async () => {
    const action = getWriteAction("review", "night_plan_task", "save_ranks")!;
    const client = makeTableClient({ tasks: makeChain() });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { starred: [1, 2], crowned: null }),
    ).rejects.toThrow(/patch\.starred/i);
  });

  it("save_ranks REJECTS an invalid assignRanks input (crown not in starred) via the core's own error, not a raw exception escaping", async () => {
    const action = getWriteAction("review", "night_plan_task", "save_ranks")!;
    const client = makeTableClient({ tasks: makeChain() });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { starred: ["a", "b"], crowned: "c" }),
    ).rejects.toThrow();
  });

  it("save_ranks with an empty computed rank set (nothing starred) is a clean ok, no writes attempted", async () => {
    const action = getWriteAction("review", "night_plan_task", "save_ranks")!;
    const client = makeTableClient({ tasks: makeChain() });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { starred: [], crowned: null });
    expect(outcome.summary).toMatch(/0 starred/);
  });
});

describe("review.worry handlers", () => {
  const now = new Date("2026-09-08T20:00:00.000Z");

  it("set_handled REQUIRES the top-level id", async () => {
    const action = getWriteAction("review", "worry", "set_handled")!;
    const client = makeTableClient({ tasks: makeChain() });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, {})).rejects.toThrow(/requires the top-level.*id/i);
  });

  it("set_handled throws ToolNotFoundError when the worry doesn't exist for this user", async () => {
    const action = getWriteAction("review", "worry", "set_handled")!;
    const client = makeTableClient({ tasks: makeChain({ data: null, error: null }) }); // findWorry's maybeSingle -> null
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "bad-id" }, {})).rejects.toBeInstanceOf(ToolNotFoundError);
  });

  it("set_handled marks it handled when found", async () => {
    const action = getWriteAction("review", "worry", "set_handled")!;
    const client = makeTableClient({ tasks: makeChain({ data: { id: "w-1" }, error: null }) }); // maybeSingle finds it; subsequent update resolves via same chain's `.then`
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "w-1" }, {});
    expect(outcome.summary).toMatch(/w-1/);
  });

  it("reopen throws ToolNotFoundError when the worry doesn't exist", async () => {
    const action = getWriteAction("review", "worry", "reopen")!;
    const client = makeTableClient({ tasks: makeChain({ data: null, error: null }) });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "bad-id" }, {})).rejects.toBeInstanceOf(ToolNotFoundError);
  });
});

describe("review.sleep_intent handlers", () => {
  const now = new Date("2026-09-08T20:00:00.000Z");

  it("set REJECTS an invalid bedtime", async () => {
    const action = getWriteAction("review", "sleep_intent", "set")!;
    const client = makeTableClient({ sleep_intents: makeChain() });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { time: "not-a-time" })).rejects.toThrow(/24-hour/i);
  });

  it("set REJECTS a missing time", async () => {
    const action = getWriteAction("review", "sleep_intent", "set")!;
    const client = makeTableClient({ sleep_intents: makeChain() });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, {})).rejects.toThrow(/patch\.time/i);
  });

  it("set upserts a valid bedtime for local today", async () => {
    const action = getWriteAction("review", "sleep_intent", "set")!;
    const client = makeTableClient({ sleep_intents: makeChain() });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { time: "22:30" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toEqual({ date: "2026-09-08", time: "22:30" });
  });

  it("clear clears today's intent", async () => {
    const action = getWriteAction("review", "sleep_intent", "clear")!;
    const client = makeTableClient({ sleep_intents: makeChain() });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, {});
    expect(outcome.summary).toMatch(/2026-09-08/);
  });
});

describe("day.day_start.start handler", () => {
  const now = new Date("2026-09-08T20:00:00.000Z");

  it("marks today started and returns the local date + woke_at", async () => {
    const action = getWriteAction("day", "day_start", "start")!;
    const client = makeTableClient({
      day_starts: makeChain({ data: { local_date: "2026-09-08", woke_at: now.toISOString() }, error: null }),
    });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, {});
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toEqual({ localDate: "2026-09-08", wokeAtIso: now.toISOString() });
  });
});

describe("goals.goal handlers", () => {
  const now = new Date("2026-09-08T20:00:00.000Z");

  it("create REJECTS an invalid rank", async () => {
    const action = getWriteAction("goals", "goal", "create")!;
    const client = makeTableClient({ goals: makeChain() });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { month_start: "2026-09-01", title: "x", reason: "y", rank: 6 }),
    ).rejects.toThrow(/patch\.rank/i);
  });

  it("create inserts with the given fields", async () => {
    const action = getWriteAction("goals", "goal", "create")!;
    const client = makeTableClient({
      goals: makeChain({ data: { id: "g-1", month_start: "2026-09-01", domain: null, title: "Ship it", reason: "y", rank: 1, status: "active", completed_at: null }, error: null }),
    });
    const outcome = await action.handler(
      { userClient: client, userId: "user-1", timezone: "UTC", now },
      { month_start: "2026-09-01", title: "Ship it", reason: "y", rank: 1 },
    );
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toMatchObject({ id: "g-1", title: "Ship it" });
  });

  it("set_status REQUIRES the top-level id", async () => {
    const action = getWriteAction("goals", "goal", "set_status")!;
    const client = makeTableClient({ goals: makeChain() });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { status: "done" })).rejects.toThrow(/requires the top-level.*id/i);
  });

  it("set_status REJECTS a status other than done/dropped", async () => {
    const action = getWriteAction("goals", "goal", "set_status")!;
    const client = makeTableClient({ goals: makeChain() });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "g-1" }, { status: "active" }),
    ).rejects.toThrow(/patch\.status/i);
  });

  it("set_status does NOT throw ToolNotFoundError on 0 rows -- a deliberate no-op, matching the core's own design", async () => {
    const action = getWriteAction("goals", "goal", "set_status")!;
    const client = makeTableClient({ goals: makeChain({ data: null, error: null }) }); // update matches 0 rows, no error surfaced by the mock
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "already-done-or-missing" }, { status: "done" });
    expect(outcome.summary).toMatch(/already-done-or-missing/);
  });
});

describe("goals.milestone handlers", () => {
  const now = new Date("2026-09-08T20:00:00.000Z");

  it("add inserts a milestone under the given goal", async () => {
    const action = getWriteAction("goals", "milestone", "add")!;
    const client = makeTableClient({
      goal_milestones: makeChain({ data: { id: "m-1", goal_id: "g-1", month_start: "2026-09-01", title: "Draft v1", done_at: null }, error: null }),
    });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { goal_id: "g-1", month_start: "2026-09-01", title: "Draft v1" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toMatchObject({ id: "m-1", goalId: "g-1" });
  });

  it("add translates a composite-FK violation (bad goal_id) into ToolNotFoundError", async () => {
    const action = getWriteAction("goals", "milestone", "add")!;
    const client = makeTableClient({
      goal_milestones: makeChain({ data: null, error: { code: "23503", message: "fk violation" } }),
    });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { goal_id: "not-real", month_start: "2026-09-01", title: "x" }),
    ).rejects.toBeInstanceOf(ToolNotFoundError);
  });

  it("set_done REQUIRES the top-level id", async () => {
    const action = getWriteAction("goals", "milestone", "set_done")!;
    const client = makeTableClient({ goal_milestones: makeChain() });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { done: true })).rejects.toThrow(/requires the top-level.*id/i);
  });

  it("set_done throws ToolNotFoundError when the milestone doesn't exist for this user (unlike goal.set_status, no ambiguous no-op here)", async () => {
    const action = getWriteAction("goals", "milestone", "set_done")!;
    const client = makeTableClient({ goal_milestones: makeChain({ data: null, error: null }) }); // existence check's maybeSingle -> null
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "bad-id" }, { done: true }),
    ).rejects.toBeInstanceOf(ToolNotFoundError);
  });

  it("set_done REJECTS a missing done", async () => {
    const action = getWriteAction("goals", "milestone", "set_done")!;
    const client = makeTableClient({ goal_milestones: makeChain({ data: { id: "m-1" }, error: null }) });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "m-1" }, {})).rejects.toThrow(/patch\.done/i);
  });
});

describe("habits.identity_habit handlers", () => {
  const now = new Date("2026-09-08T20:00:00.000Z");

  it("create REJECTS a missing identity_statement", async () => {
    const action = getWriteAction("habits", "identity_habit", "create")!;
    const client = makeTableClient({ identity_habits: makeChain() });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, {})).rejects.toThrow(/patch\.identity_statement/i);
  });

  it("create inserts at the lowest free rank", async () => {
    const action = getWriteAction("habits", "identity_habit", "create")!;
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "insert"]) chain[m] = vi.fn(() => chain);
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null }); // no active habits -> rank 1 free
    chain.single = vi.fn(async () => ({ data: { id: "h-1", identity_statement: "I am disciplined", rank: 1, created_at: now.toISOString() }, error: null }));
    const client = makeTableClient({ identity_habits: chain as unknown as ReturnType<typeof makeChain> });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { identity_statement: "I am disciplined" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toMatchObject({ id: "h-1" });
  });

  it("archive REQUIRES the top-level id", async () => {
    const action = getWriteAction("habits", "identity_habit", "archive")!;
    const client = makeTableClient({ identity_habits: makeChain() });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, {})).rejects.toThrow(/requires the top-level.*id/i);
  });

  it("archive does NOT throw on 0 rows -- deliberate no-op matching the core's own design", async () => {
    const action = getWriteAction("habits", "identity_habit", "archive")!;
    const client = makeTableClient({ identity_habits: makeChain({ data: null, error: null }) });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "already-archived-or-missing" }, {});
    expect(outcome.summary).toMatch(/already-archived-or-missing/);
  });
});

describe("habits.vote handlers", () => {
  const now = new Date("2026-09-08T20:00:00.000Z");

  it("cast REJECTS a missing patch.date", async () => {
    const action = getWriteAction("habits", "vote", "cast")!;
    const client = makeTableClient({ habit_votes: makeChain() });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "h-1" }, {})).rejects.toThrow(/patch\.date/i);
  });

  it("cast REJECTS a date other than local today", async () => {
    const action = getWriteAction("habits", "vote", "cast")!;
    const client = makeTableClient({ habit_votes: makeChain() });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "h-1" }, { date: "2020-01-01" }),
    ).rejects.toThrow(/today/i);
  });

  it("cast REQUIRES the top-level id", async () => {
    const action = getWriteAction("habits", "vote", "cast")!;
    const client = makeTableClient({ habit_votes: makeChain() });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08" })).rejects.toThrow(/requires the top-level.*id/i);
  });

  it("cast upserts for local today when the date matches", async () => {
    const action = getWriteAction("habits", "vote", "cast")!;
    const client = makeTableClient({ habit_votes: makeChain({ data: null, error: null }) });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "h-1" }, { date: "2026-09-08" });
    expect(outcome.summary).toMatch(/h-1/);
  });

  it("cast translates a composite-FK violation (bad habit id) into ToolNotFoundError", async () => {
    const action = getWriteAction("habits", "vote", "cast")!;
    const client = makeTableClient({ habit_votes: makeChain({ data: null, error: { code: "23503", message: "fk violation" } }) });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "not-real" }, { date: "2026-09-08" }),
    ).rejects.toBeInstanceOf(ToolNotFoundError);
  });

  it("retract REJECTS a date other than local today", async () => {
    const action = getWriteAction("habits", "vote", "retract")!;
    const client = makeTableClient({ habit_votes: makeChain() });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "h-1" }, { date: "2020-01-01" }),
    ).rejects.toThrow(/today/i);
  });

  it("retract deletes today's vote when it exists (a no-op on 0 rows, not an error)", async () => {
    const action = getWriteAction("habits", "vote", "retract")!;
    const client = makeTableClient({ habit_votes: makeChain({ data: null, error: null }) });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "h-1" }, { date: "2026-09-08" });
    expect(outcome.summary).toMatch(/h-1/);
  });
});
