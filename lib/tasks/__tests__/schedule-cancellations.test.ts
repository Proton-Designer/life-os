import { describe, expect, it, vi } from "vitest";
import {
  getCancelledDatesByEvent,
  isOccurrenceCancelled,
  getScheduleExceptions,
  resolveOccurrence,
  type ExceptionsByEvent,
} from "../schedule-cancellations";

function makeSupabase({
  cancelRows = [] as { event_id: string; date: string }[],
  overrideRows = [] as { event_id: string; date: string; event_time: string; end_time: string | null }[],
}) {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(async () => {
            if (table === "schedule_event_cancellations") return { data: cancelRows, error: null };
            if (table === "schedule_event_overrides") return { data: overrideRows, error: null };
            throw new Error(`unexpected table ${table}`);
          }),
        })),
      })),
    })),
  } as unknown as Parameters<typeof getCancelledDatesByEvent>[0];
}

describe("getCancelledDatesByEvent / isOccurrenceCancelled (legacy narrow API)", () => {
  it("still answers a plain yes/no cancelled question", async () => {
    const supabase = makeSupabase({ cancelRows: [{ event_id: "e1", date: "2026-08-26" }] });
    const map = await getCancelledDatesByEvent(supabase, "user-1", ["e1"]);
    expect(isOccurrenceCancelled(map, "e1", "2026-08-26")).toBe(true);
    expect(isOccurrenceCancelled(map, "e1", "2026-08-27")).toBe(false);
  });

  it("returns an empty map with no event ids, without querying", async () => {
    const supabase = makeSupabase({});
    const map = await getCancelledDatesByEvent(supabase, "user-1", []);
    expect(map.size).toBe(0);
  });
});

describe("getScheduleExceptions / resolveOccurrence", () => {
  it("resolves a plain date with no exceptions as normal", async () => {
    const supabase = makeSupabase({});
    const exceptions = await getScheduleExceptions(supabase, "user-1", ["e1"]);
    expect(resolveOccurrence(exceptions, "e1", "2026-08-26")).toEqual({ kind: "normal" });
  });

  it("resolves a cancelled date as cancelled", async () => {
    const supabase = makeSupabase({ cancelRows: [{ event_id: "e1", date: "2026-08-26" }] });
    const exceptions = await getScheduleExceptions(supabase, "user-1", ["e1"]);
    expect(resolveOccurrence(exceptions, "e1", "2026-08-26")).toEqual({ kind: "cancelled" });
  });

  it("resolves an overridden date with its replacement time", async () => {
    const supabase = makeSupabase({
      overrideRows: [{ event_id: "e1", date: "2026-08-26", event_time: "12:00", end_time: "15:00" }],
    });
    const exceptions = await getScheduleExceptions(supabase, "user-1", ["e1"]);
    expect(resolveOccurrence(exceptions, "e1", "2026-08-26")).toEqual({
      kind: "override",
      eventTime: "12:00",
      endTime: "15:00",
    });
  });

  it("cancellation wins display precedence when a date carries both (Opus Lead ruling)", async () => {
    const supabase = makeSupabase({
      cancelRows: [{ event_id: "e1", date: "2026-08-26" }],
      overrideRows: [{ event_id: "e1", date: "2026-08-26", event_time: "12:00", end_time: "15:00" }],
    });
    const exceptions = await getScheduleExceptions(supabase, "user-1", ["e1"]);
    expect(resolveOccurrence(exceptions, "e1", "2026-08-26")).toEqual({ kind: "cancelled" });
  });

  it("keeps the override data intact underneath a cancellation, resolvable once constructed by hand (undo path)", () => {
    // Simulates the state right after cancelScheduleOccurrenceCore runs on
    // an already-overridden date: it must not delete the override row, so
    // the exceptions map still carries both facts.
    const exceptions: ExceptionsByEvent = new Map([
      ["e1", new Map([["2026-08-26", { cancelled: true, override: { eventTime: "12:00", endTime: "15:00" } }]])],
    ]);
    expect(resolveOccurrence(exceptions, "e1", "2026-08-26")).toEqual({ kind: "cancelled" });

    // Undo removes only the cancellation fact — same map, cancelled flipped false.
    const afterUndo: ExceptionsByEvent = new Map([
      ["e1", new Map([["2026-08-26", { cancelled: false, override: { eventTime: "12:00", endTime: "15:00" } }]])],
    ]);
    expect(resolveOccurrence(afterUndo, "e1", "2026-08-26")).toEqual({
      kind: "override",
      eventTime: "12:00",
      endTime: "15:00",
    });
  });

  it("returns an empty map with no event ids, without querying either table", async () => {
    const supabase = makeSupabase({});
    const exceptions = await getScheduleExceptions(supabase, "user-1", []);
    expect(exceptions.size).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
