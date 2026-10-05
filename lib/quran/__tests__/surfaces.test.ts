import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { closeLine, homeNowItem, khatmScreen, sectorRow, weeklyLookBack, weeklyQuranTarget } from "../surfaces";
import { getQuranOverviewCore } from "../plan-core";
import { U, fakeSupabase, planRow } from "./fake-supabase";

const TODAY = "2026-10-05";
const overview = (plan: Record<string, unknown> | null, sessions: Array<Record<string, unknown>> = [], date = TODAY) =>
  getQuranOverviewCore(fakeSupabase({ quran_plans: plan ? [planRow(plan)] : [], quran_sessions: sessions }).client, U, date);
const session = (date: string, pages: number) => ({ id: `s-${date}-${pages}`, user_id: U, date, pages_read: pages, created_at: "x" });

describe("surfaces read the same overview", () => {
  it("Home Now: 'Quran · pages a–b' from the portion; one page reads 'page a'; nothing without an active plan", async () => {
    const o = await overview({ current_page: 11 });
    expect(homeNowItem(o)).toMatchObject({ title: "Quran · pages 11–20", from: 11, to: 20, pages: 10, done: false, surahLabel: "Al-Baqara", juz: 1 });
    const one = await overview({ current_page: 21 }); // today's target met: min one page
    expect(homeNowItem(one)).toMatchObject({ title: "Quran · page 21", done: true });
    expect(homeNowItem(await overview(null))).toBeNull();
    expect(homeNowItem(await overview({ status: "paused", paused_on: TODAY }))).toBeNull();
    expect(homeNowItem(null)).toBeNull();
  });
  it("sector row: khatm number + percent + on-track flag (behind is not on track)", async () => {
    expect(sectorRow(await overview({ current_page: 31 }, [], "2026-10-05"))).toMatchObject({ label: "Khatm 1 · 4%", kind: "ahead", onTrack: true });
    expect(sectorRow(await overview({ current_page: 21 }, [], "2026-10-05"))).toMatchObject({ kind: "on_track", onTrack: true });
    const behind = sectorRow(await overview({ current_page: 11 }, [], "2026-10-09"));
    expect(behind).toMatchObject({ kind: "behind", onTrack: false });
    expect(sectorRow(await overview(null))).toBeNull();
  });
  it("evening close: ticked with the pages read today, or 'not yet'; nothing for no/paused plans", async () => {
    expect(closeLine(await overview({ current_page: 21 }, [session(TODAY, 10)]))).toEqual({ kind: "done", pages: 10, text: "Quran today ✓ 10 pages" });
    expect(closeLine(await overview({ current_page: 21 }, [session(TODAY, 1)]))).toMatchObject({ kind: "done", text: "Quran today ✓ 1 page" });
    expect(closeLine(await overview({ current_page: 11 }, [session("2026-10-04", 10)]))).toMatchObject({ kind: "not_yet" });
    expect(closeLine(await overview(null))).toBeNull();
    expect(closeLine(await overview({ status: "paused", paused_on: TODAY }))).toBeNull();
  });
  it("Sunday look-back: pages vs plan and the finish date to keep or move; none for a finished khatm", async () => {
    const o = await overview({ current_page: 11 }, [session("2026-10-04", 10)]);
    expect(weeklyLookBack(o)).toMatchObject({ pagesRead: 10, plannedToDate: 20, finishDate: "2026-12-02", readingDaysLast7: 1 });
    expect(weeklyLookBack(await overview({ status: "completed", completed_on: "2026-12-02", current_page: 605 }, [], "2026-12-03"))).toBeNull();
  });
  it("khatm screen only for a completed plan", async () => {
    expect(khatmScreen(await overview({ status: "completed", completed_on: "2026-12-02", current_page: 605 }, [], "2026-12-03"))).toEqual({ khatmNumber: 1, completedOn: "2026-12-02", juzCompleted: 30 });
    expect(khatmScreen(await overview({ current_page: 11 }))).toBeNull();
  });
  it("weekly target: derived (pace x 7) while a plan is active, the manual one otherwise", async () => {
    expect(weeklyQuranTarget(await overview({ current_page: 11 }), 25)).toBe(70);
    expect(weeklyQuranTarget(await overview(null), 25)).toBe(25);
    expect(weeklyQuranTarget(await overview({ status: "paused", paused_on: TODAY }), 25)).toBe(25);
    expect(weeklyQuranTarget(null, null)).toBeNull();
  });
});
