import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  deleteQuranLogEntryCore,
  derivedWeeklyQuranTarget,
  editQuranLogEntryCore,
  getQuranLedgerCore,
  getOpenPlanCore,
  getQuranOverviewCore,
  keepOrMoveFinishDateCore,
  logQuranReadingCore,
  pauseQuranPlanCore,
  resumeQuranPlanCore,
  setQuranBookmarkCore,
  startNextKhatmCore,
  startQuranPlanCore,
  undoLastQuranLogCore,
} from "../plan-core";
import { U, fakeSupabase, planRow } from "./fake-supabase";

const TODAY = "2026-10-05"; // day 2 of a plan that started 2026-10-04

describe("startQuranPlanCore", () => {
  it("defaults to 'Finish in 60 days' from page 1 and numbers the khatm", async () => {
    const f = fakeSupabase();
    const res = await startQuranPlanCore(f.client, U, "2026-10-04");
    expect(res).toMatchObject({ ok: true, khatmNumber: 1 });
    expect(f.tables.quran_plans[0]).toMatchObject({ user_id: U, khatm_number: 1, start_page: 1, current_page: 1, target_date: "2026-12-02", pace_pages_per_day: null, status: "active" });
    expect(Number(f.tables.quran_plans[0].original_pace_pages_per_day)).toBeCloseTo(10.07, 2);
  });
  it("refuses a second open plan; validates the preset", async () => {
    const f = fakeSupabase({ quran_plans: [planRow()] });
    expect(await startQuranPlanCore(f.client, U, TODAY)).toMatchObject({ ok: false, message: expect.stringMatching(/already have/) });
    const g = fakeSupabase();
    expect(await startQuranPlanCore(g.client, U, TODAY, { preset: { kind: "custom_pace", pagesPerDay: 0.1 } })).toMatchObject({ ok: false });
    expect(g.tables.quran_plans).toHaveLength(0);
  });
  it("a unique-index collision (two devices racing) is a message, not a crash", async () => {
    const f = fakeSupabase();
    f.failNext("quran_plans", "insert", { code: "23505", message: "dup" });
    expect(await startQuranPlanCore(f.client, U, TODAY)).toMatchObject({ ok: false });
  });
  it("starting from the current page uses the pages left", async () => {
    const f = fakeSupabase();
    await startQuranPlanCore(f.client, U, "2026-10-04", { preset: { kind: "days", days: 30 }, startPage: 301 });
    expect(f.tables.quran_plans[0]).toMatchObject({ start_page: 301, plan_set_page: 301, current_page: 301 });
    expect(Number(f.tables.quran_plans[0].original_pace_pages_per_day)).toBeCloseTo(304 / 30, 2);
  });
});

describe("logQuranReadingCore", () => {
  it("todaysPortion: reads through today's target, moves the bookmark, writes a log with the span + plan + legacy columns", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ start_page: 11, current_page: 11 })] });
    const res = await logQuranReadingCore(f.client, U, TODAY, { todaysPortion: true });
    expect(res).toMatchObject({ ok: true, fromPage: 11, toPage: 20, newCurrentPage: 21, pagesRead: 10, khatmComplete: false, date: TODAY });
    expect(f.tables.quran_plans[0].current_page).toBe(21);
    expect(f.tables.quran_sessions[0]).toMatchObject({ user_id: U, date: TODAY, pages_read: 10, from_page: 11, to_page: 20, plan_id: "plan-1", juz: 1 });
    expect(typeof f.tables.quran_sessions[0].surah).toBe("string");
  });
  it("toPage / nextPage ('I'm on page N' = toPage N-1)", async () => {
    const a = fakeSupabase({ quran_plans: [planRow({ start_page: 11, current_page: 11 })] });
    expect(await logQuranReadingCore(a.client, U, TODAY, { toPage: 15 })).toMatchObject({ ok: true, newCurrentPage: 16, pagesRead: 5 });
    const b = fakeSupabase({ quran_plans: [planRow({ start_page: 11, current_page: 11 })] });
    expect(await logQuranReadingCore(b.client, U, TODAY, { nextPage: 16 })).toMatchObject({ ok: true, toPage: 15, newCurrentPage: 16 });
  });
  it("can log several times a day (adds), and 'yesterday' files it under yesterday", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ start_page: 11, current_page: 11 })] });
    await logQuranReadingCore(f.client, U, TODAY, { toPage: 15 }, "yesterday");
    await logQuranReadingCore(f.client, U, TODAY, { toPage: 20 });
    await logQuranReadingCore(f.client, U, TODAY, { toPage: 25 });
    expect(f.tables.quran_sessions.map((s) => [s.date, s.pages_read])).toEqual([["2026-10-04", 5], [TODAY, 5], [TODAY, 5]]);
    expect(f.tables.quran_plans[0].current_page).toBe(26);
  });
  it("any way of saying it works and they mix in any order: pages, page I'm on, ayah I'm on, finished page", async () => {
    const f = fakeSupabase({ quran_plans: [planRow()] });
    expect(await logQuranReadingCore(f.client, U, TODAY, { pages: 3 }, "2026-10-04")).toMatchObject({ ok: true, fromPage: 1, toPage: 3, newCurrentPage: 4 });
    expect(await logQuranReadingCore(f.client, U, TODAY, { nextPage: 9 })).toMatchObject({ ok: true, fromPage: 4, toPage: 8, newCurrentPage: 9 });
    // 2:142 is the first ayah of page 22 (global 1+7+... see ayah-map); "I'm on" it = through page 21
    expect(await logQuranReadingCore(f.client, U, TODAY, { ayah: 1 + 7 + 141 })).toMatchObject({ ok: true, toPage: 21, newCurrentPage: 22 });
    expect(await logQuranReadingCore(f.client, U, TODAY, { toPage: 24 })).toMatchObject({ ok: true, fromPage: 22, toPage: 24, newCurrentPage: 25 });
    expect(f.tables.quran_plans[0].current_page).toBe(25);
  });
  it("an ayah inside the current page only remembers the exact place (no whole page, no log row) and survives until the page moves", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ start_page: 22, current_page: 22 })] });
    const res = await logQuranReadingCore(f.client, U, TODAY, { ayah: 7 + 145 }); // 2:145, still on page 22
    expect(res).toMatchObject({ ok: true, sessionId: null, pagesRead: 0, newCurrentPage: 22 });
    expect(f.tables.quran_sessions).toHaveLength(0);
    expect(f.tables.quran_plans[0].current_ayah).toBe(7 + 145);
    await logQuranReadingCore(f.client, U, TODAY, { toPage: 22 });
    expect(f.tables.quran_plans[0]).toMatchObject({ current_page: 23, current_ayah: null });
  });
  it("a day in the middle must fit between the days around it (page order, no overlap), and is placed after the day before it", async () => {
    const f = fakeSupabase({ quran_plans: [planRow()] });
    await logQuranReadingCore(f.client, U, TODAY, { toPage: 10 }, "2026-10-04"); // Oct 4: 1-10
    await logQuranReadingCore(f.client, U, TODAY, { toPage: 30 }, TODAY); // Oct 5: 11-30
    // Oct 4 again would have to come after Oct 4's own entry and before Oct 5's: only if it fits (none free) -> refused
    const refused = await logQuranReadingCore(f.client, U, TODAY, { pages: 3 }, "2026-10-04");
    expect(refused).toMatchObject({ ok: false, message: expect.stringMatching(/no pages fit|Only/) });
    expect(f.tables.quran_sessions).toHaveLength(2);
    expect(f.tables.quran_plans[0].current_page).toBe(31);
    // open a gap by shrinking Oct 5, then the same log fits and the bookmark does not move
    const oct5 = f.tables.quran_sessions[1].id as string;
    expect(await editQuranLogEntryCore(f.client, U, TODAY, oct5, { from: 14 })).toMatchObject({ ok: true });
    expect(await logQuranReadingCore(f.client, U, TODAY, { pages: 3 }, "2026-10-04")).toMatchObject({ ok: true, fromPage: 11, toPage: 13, newCurrentPage: 31 });
    expect(f.tables.quran_plans[0].current_page).toBe(31);
  });
  it("refuses: no plan, paused, a page behind the bookmark, before the plan started", async () => {
    expect(await logQuranReadingCore(fakeSupabase().client, U, TODAY, { toPage: 5 })).toMatchObject({ ok: false, message: expect.stringMatching(/Start a Quran plan/) });
    const paused = fakeSupabase({ quran_plans: [planRow({ status: "paused", paused_on: "2026-10-05" })] });
    expect(await logQuranReadingCore(paused.client, U, TODAY, { toPage: 5 })).toMatchObject({ ok: false, message: expect.stringMatching(/paused/) });
    const f = fakeSupabase({ quran_plans: [planRow({ start_page: 50, current_page: 50 })] });
    expect(await logQuranReadingCore(f.client, U, TODAY, { toPage: 40 })).toMatchObject({ ok: false, message: expect.stringMatching(/starts at page 50/) });
    expect(await logQuranReadingCore(f.client, U, "2026-10-04", { toPage: 60 }, "yesterday")).toMatchObject({ ok: false, message: expect.stringMatching(/before your plan/) });
    expect(f.tables.quran_sessions).toHaveLength(0);
    expect(f.tables.quran_plans[0].current_page).toBe(50);
  });
  it("a second device moving the bookmark between our read and our write cannot be overwritten (guarded UPDATE)", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ start_page: 11, current_page: 11 })] });
    const row = f.tables.quran_plans[0];
    const realFrom = f.client.from.bind(f.client);
    let planCalls = 0;
    (f.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      if (t === "quran_plans" && ++planCalls === 2) row.current_page = 99; // after getOpenPlanCore, right before the bookmark UPDATE
      return realFrom(t);
    };
    const res = await logQuranReadingCore(f.client, U, TODAY, { toPage: 20 });
    expect(res).toMatchObject({ ok: false, message: expect.stringMatching(/another device/) });
    expect(row.current_page).toBe(99); // their move survives
    expect(f.tables.quran_sessions).toHaveLength(0); // and nothing was logged
  });
  it("finishing page 604 completes the khatm (status completed, completed_on) and reports the juz", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ start_page: 600, current_page: 600 })] });
    const res = await logQuranReadingCore(f.client, U, "2026-12-02", { toPage: 604 });
    expect(res).toMatchObject({ ok: true, khatmComplete: true, newCurrentPage: 605, juzCompleted: [30] });
    expect(f.tables.quran_plans[0]).toMatchObject({ status: "completed", completed_on: "2026-12-02", current_page: 605 });
  });
  it("a failed log insert puts the bookmark back (no page counted without a log)", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ start_page: 11, current_page: 11 })] });
    f.failNext("quran_sessions", "insert");
    await expect(logQuranReadingCore(f.client, U, TODAY, { toPage: 20 })).rejects.toThrow();
    expect(f.tables.quran_plans[0].current_page).toBe(11);
  });
});

describe("undoLastQuranLogCore", () => {
  it("puts the bookmark back to where the last log started and deletes that log", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ start_page: 11, current_page: 11 })] });
    await logQuranReadingCore(f.client, U, TODAY, { toPage: 20 });
    expect(await undoLastQuranLogCore(f.client, U)).toMatchObject({ ok: true, currentPage: 11 });
    expect(f.tables.quran_plans[0].current_page).toBe(11);
    expect(f.tables.quran_sessions).toHaveLength(0);
  });
  it("undoes only the NEWEST log, one step at a time", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ start_page: 11, current_page: 11 })] });
    await logQuranReadingCore(f.client, U, TODAY, { toPage: 15 });
    await logQuranReadingCore(f.client, U, TODAY, { toPage: 20 });
    await undoLastQuranLogCore(f.client, U);
    expect(f.tables.quran_plans[0].current_page).toBe(16);
    expect(f.tables.quran_sessions).toHaveLength(1);
  });
  it("reopens a khatm that the last log completed", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ start_page: 600, current_page: 600 })] });
    await logQuranReadingCore(f.client, U, "2026-12-02", { toPage: 604 });
    expect(await undoLastQuranLogCore(f.client, U)).toMatchObject({ ok: true, currentPage: 600 });
    expect(f.tables.quran_plans[0]).toMatchObject({ status: "active", completed_on: null });
  });
  it("refuses when there is nothing to undo; undoing after a bookmark jump removes that jump's log", async () => {
    expect(await undoLastQuranLogCore(fakeSupabase().client, U)).toMatchObject({ ok: false });
    const f = fakeSupabase({ quran_plans: [planRow({ start_page: 11, current_page: 11 })] });
    await logQuranReadingCore(f.client, U, TODAY, { toPage: 20 });
    await setQuranBookmarkCore(f.client, U, 100, TODAY);
    expect(f.tables.quran_plans[0].current_page).toBe(100);
    expect(await undoLastQuranLogCore(f.client, U, TODAY)).toMatchObject({ ok: true, currentPage: 21 });
    expect(f.tables.quran_sessions).toHaveLength(1);
  });
  it("legacy sessions with no span are never touched", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ start_page: 11, current_page: 11 })], quran_sessions: [{ id: "old", user_id: U, plan_id: "plan-1", date: TODAY, pages_read: 3, from_page: null, to_page: null, created_at: "2026-10-05T00:00:00Z" }] });
    expect(await undoLastQuranLogCore(f.client, U)).toMatchObject({ ok: false });
    expect(f.tables.quran_sessions).toHaveLength(1);
  });
});

describe("bookmark, keep/move date, pause/resume, next khatm", () => {
  it("setQuranBookmark is absolute: forward logs the skipped pages, back trims the log; validates the range; needs a plan", async () => {
    const f = fakeSupabase({
      quran_plans: [planRow({ current_page: 100 })],
      quran_sessions: [{ id: "s1", user_id: U, plan_id: "plan-1", date: "2026-10-04", pages_read: 99, from_page: 1, to_page: 99, created_at: "2026-10-04T10:00:00Z" }],
    });
    expect(await setQuranBookmarkCore(f.client, U, 40, TODAY)).toMatchObject({ ok: true, currentPage: 40 });
    expect(f.tables.quran_plans[0].current_page).toBe(40);
    expect(f.tables.quran_sessions[0]).toMatchObject({ from_page: 1, to_page: 39, pages_read: 39 });
    expect(await setQuranBookmarkCore(f.client, U, 60, TODAY)).toMatchObject({ ok: true, currentPage: 60 });
    expect(f.tables.quran_sessions.map((r) => [r.from_page, r.to_page])).toEqual([[1, 39], [40, 59]]);
    expect(await setQuranBookmarkCore(f.client, U, 0)).toMatchObject({ ok: false });
    expect(await setQuranBookmarkCore(f.client, U, 605)).toMatchObject({ ok: false });
    expect(await setQuranBookmarkCore(fakeSupabase().client, U, 5)).toMatchObject({ ok: false });
  });
  it("keep the date re-bases at today + the bookmark with the same effective finish day", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ current_page: 100, paused_days: 2 })] });
    const res = await keepOrMoveFinishDateCore(f.client, U, "2026-10-20", null);
    expect(res).toMatchObject({ ok: true, targetDate: "2026-12-04" }); // 2026-12-02 + 2 paused days
    expect(f.tables.quran_plans[0]).toMatchObject({ plan_set_on: "2026-10-20", plan_set_page: 100, target_date: "2026-12-04", pace_pages_per_day: null, paused_days: 0 });
    expect(f.tables.quran_plans[0].original_pace_pages_per_day).toBe(10.07); // never changes
  });
  it("move the date sets the new finish day; a past date and a paused plan are refused", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ current_page: 100 })] });
    expect(await keepOrMoveFinishDateCore(f.client, U, "2026-10-20", "2027-01-31")).toMatchObject({ ok: true, targetDate: "2027-01-31" });
    expect(await keepOrMoveFinishDateCore(f.client, U, "2026-10-20", "2026-10-01")).toMatchObject({ ok: false });
    const p = fakeSupabase({ quran_plans: [planRow({ status: "paused", paused_on: "2026-10-05" })] });
    expect(await keepOrMoveFinishDateCore(p.client, U, "2026-10-20", null)).toMatchObject({ ok: false, message: expect.stringMatching(/Resume/) });
  });
  it("pause freezes from today; resume adds the frozen days and reopens; both are absolute", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ paused_days: 1 })] });
    expect(await pauseQuranPlanCore(f.client, U, "2026-10-10")).toMatchObject({ ok: true });
    expect(f.tables.quran_plans[0]).toMatchObject({ status: "paused", paused_on: "2026-10-10" });
    expect(await pauseQuranPlanCore(f.client, U, "2026-10-12")).toMatchObject({ ok: true }); // already paused: no-op
    expect(f.tables.quran_plans[0].paused_on).toBe("2026-10-10");
    expect(await resumeQuranPlanCore(f.client, U, "2026-10-15")).toMatchObject({ ok: true });
    expect(f.tables.quran_plans[0]).toMatchObject({ status: "active", paused_on: null, paused_days: 6 }); // 1 + (10..14)
    expect(await resumeQuranPlanCore(f.client, U, "2026-10-16")).toMatchObject({ ok: true }); // already running: no-op
    expect(f.tables.quran_plans[0].paused_days).toBe(6);
  });
  it("the next khatm: only after a completed one, same pace, page 1, khatm number + 1", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ status: "completed", completed_on: "2026-12-02", current_page: 605 })] });
    const res = await startNextKhatmCore(f.client, U, "2026-12-03");
    expect(res).toMatchObject({ ok: true, khatmNumber: 2 });
    expect(f.tables.quran_plans[1]).toMatchObject({ khatm_number: 2, start_page: 1, current_page: 1, status: "active", target_date: null });
    expect(Number(f.tables.quran_plans[1].pace_pages_per_day)).toBeCloseTo(10.07, 2);
    expect(await startNextKhatmCore(f.client, U, "2026-12-03")).toMatchObject({ ok: false, message: expect.stringMatching(/current khatm/) });
    expect(await startNextKhatmCore(fakeSupabase({ quran_plans: [planRow()] }).client, U, TODAY)).toMatchObject({ ok: false });
  });
});

describe("getQuranOverviewCore", () => {
  it("no plan: an empty overview that still reports this week's reading", async () => {
    const f = fakeSupabase({ quran_sessions: [{ id: "s", user_id: U, date: TODAY, pages_read: 4, created_at: "x" }] });
    const o = await getQuranOverviewCore(f.client, U, TODAY);
    expect(o.plan).toBeNull();
    expect(o.portion).toBeNull();
    expect(o.week.pagesRead).toBe(4);
    expect(o.pagesReadToday).toBe(4);
  });
  it("with an active plan: portion with surah/juz labels, status, 'N of last 7', week vs plan, derived weekly target", async () => {
    const f = fakeSupabase({
      quran_plans: [planRow({ current_page: 11 })],
      quran_sessions: [
        { id: "a", user_id: U, date: "2026-10-04", pages_read: 10, created_at: "x" },
        { id: "b", user_id: U, date: "2026-10-05", pages_read: 3, created_at: "y" },
      ],
    });
    const o = await getQuranOverviewCore(f.client, U, TODAY);
    expect(o.plan).toMatchObject({ khatmNumber: 1, status: "active", currentPage: 11, percent: 1, pagesLeft: 594, targetDate: "2026-12-02" });
    expect(o.portion).toMatchObject({ from: 11, to: 20, pages: 10, done: false, juz: 1 });
    expect(o.portion!.surahLabel).toBe("Al-Baqara");
    expect(o.status).toMatchObject({ kind: "on_track" });
    expect(o.readingDaysLast7).toBe(2);
    expect(o.pagesReadToday).toBe(3);
    expect(o.week.pagesRead).toBe(13);
    expect(o.week.plannedToDate).toBe(20); // days 1-2 of the plan fall in the 2026-10-04 (Sun) week
    expect(o.week.weeklyTargetPages).toBe(70);
    expect(derivedWeeklyQuranTarget(o)).toBe(70);
    expect(o.juz).toEqual({ current: 1, completed: 0, completedToday: [] });
  });
  it("behind: the overview's portion is the even re-spread with its juz range (11-27 -> Juz 1-2)", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ current_page: 11 })] });
    const o = await getQuranOverviewCore(f.client, U, "2026-10-28"); // day 25
    expect(o.portion).toMatchObject({ from: 11, to: 27, pages: 17, juz: 1, juzFrom: 1, juzTo: 2, surahLabel: "Al-Baqara" });
    expect(o.status).toMatchObject({ kind: "behind" });
  });
  it("juz.completedToday: the juz whose last page today's logs crossed (server-driven milestone note)", async () => {
    // juz 1 ends on page 21, juz 2 on page 41
    const f = fakeSupabase({
      quran_plans: [planRow({ current_page: 38 })],
      quran_sessions: [
        { id: "a", user_id: U, date: TODAY, pages_read: 5, from_page: 17, to_page: 21, plan_id: "plan-1", created_at: "x" }, // crosses juz 1
        { id: "b", user_id: U, date: TODAY, pages_read: 4, from_page: 38, to_page: 41, plan_id: "plan-1", created_at: "y" }, // crosses juz 2
        { id: "c", user_id: U, date: "2026-10-04", pages_read: 5, from_page: 58, to_page: 62, plan_id: "plan-1", created_at: "z" }, // yesterday's (crosses juz 3): not today
        { id: "d", user_id: U, date: TODAY, pages_read: 30, from_page: null, to_page: null, plan_id: null, created_at: "w" }, // legacy: no span
      ],
    });
    expect((await getQuranOverviewCore(f.client, U, TODAY)).juz.completedToday).toEqual([1, 2]);
    // a log that ends INSIDE a juz completes nothing
    const g = fakeSupabase({ quran_plans: [planRow({ current_page: 12 })], quran_sessions: [{ id: "e", user_id: U, date: TODAY, pages_read: 5, from_page: 7, to_page: 11, plan_id: "plan-1", created_at: "x" }] });
    expect((await getQuranOverviewCore(g.client, U, TODAY)).juz.completedToday).toEqual([]);
    expect((await getQuranOverviewCore(fakeSupabase().client, U, TODAY)).juz.completedToday).toEqual([]);
  });
  it("end to end: logging through a juz boundary shows it in today's overview", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ current_page: 18 })] });
    await logQuranReadingCore(f.client, U, TODAY, { toPage: 22 });
    expect((await getQuranOverviewCore(f.client, U, TODAY)).juz.completedToday).toEqual([1]);
  });
  it("paused: no portion, no derived weekly target (callers fall back to the manual one)", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ status: "paused", paused_on: TODAY })] });
    const o = await getQuranOverviewCore(f.client, U, TODAY);
    expect(o.portion).toBeNull();
    expect(o.status!.kind).toBe("paused");
    expect(derivedWeeklyQuranTarget(o)).toBeNull();
  });
  it("a finished khatm is still reported (the khatm screen) with 100% and no portion", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ status: "completed", completed_on: "2026-12-02", current_page: 605 })] });
    const o = await getQuranOverviewCore(f.client, U, "2026-12-03");
    expect(o.plan).toMatchObject({ status: "completed", percent: 100, completedOn: "2026-12-02", pagesLeft: 0 });
    expect(o.portion).toBeNull();
    expect(o.juz.completed).toBe(30);
    expect(derivedWeeklyQuranTarget(o)).toBeNull();
  });
  it("getOpenPlanCore ignores finished khatms", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ status: "completed", completed_on: "2026-12-02", current_page: 605 })] });
    expect(await getOpenPlanCore(f.client, U)).toBeNull();
  });
});

describe("history: edit / delete keep the plan consistent", () => {
  const seed = () =>
    fakeSupabase({
      quran_plans: [planRow({ current_page: 31 })],
      quran_sessions: [
        { id: "a", user_id: U, plan_id: "plan-1", date: "2026-10-04", pages_read: 10, from_page: 1, to_page: 10, created_at: "2026-10-04T10:00:00Z" },
        { id: "b", user_id: U, plan_id: "plan-1", date: "2026-10-05", pages_read: 20, from_page: 11, to_page: 30, created_at: "2026-10-05T10:00:00Z" },
      ],
    });
  it("editing the LAST day's end moves the bookmark; a middle day's end can't run into the next day", async () => {
    const f = seed();
    expect(await editQuranLogEntryCore(f.client, U, TODAY, "a", { to: 12 })).toMatchObject({ ok: false, message: expect.stringMatching(/doesn't fit/) });
    expect(f.tables.quran_sessions[0].to_page).toBe(10);
    expect(await editQuranLogEntryCore(f.client, U, TODAY, "a", { to: 8 })).toMatchObject({ ok: true, currentPage: 31 }); // shrinks into a gap
    expect(await editQuranLogEntryCore(f.client, U, TODAY, "b", { to: 40 })).toMatchObject({ ok: true, currentPage: 41 });
    expect(f.tables.quran_plans[0].current_page).toBe(41);
    expect(f.tables.quran_sessions[1]).toMatchObject({ to_page: 40, pages_read: 30 });
  });
  it("a day can't move to before an earlier day's pages", async () => {
    const f = seed();
    expect(await editQuranLogEntryCore(f.client, U, TODAY, "b", { date: "2026-10-04" })).toMatchObject({ ok: true }); // same day, saved later: still in order
    expect(await editQuranLogEntryCore(f.client, U, TODAY, "a", { date: "2026-10-05" })).toMatchObject({ ok: false });
  });
  it("deleting a day leaves a gap and the bookmark follows the furthest page still logged; deleting the last one steps back", async () => {
    const f = seed();
    expect(await deleteQuranLogEntryCore(f.client, U, TODAY, "a")).toMatchObject({ ok: true, currentPage: 31 });
    const ledger = await getQuranLedgerCore(f.client, U);
    expect(ledger?.gaps).toEqual([{ from: 1, to: 10 }]);
    expect(await deleteQuranLogEntryCore(f.client, U, TODAY, "b")).toMatchObject({ ok: true, currentPage: 1 });
    expect(f.tables.quran_plans[0].current_page).toBe(1);
  });
  it("editing a finished khatm below page 604 reopens it", async () => {
    const f = fakeSupabase({
      quran_plans: [planRow({ status: "completed", completed_on: "2026-12-02", current_page: 605 })],
      quran_sessions: [{ id: "z", user_id: U, plan_id: "plan-1", date: "2026-12-02", pages_read: 604, from_page: 1, to_page: 604, created_at: "2026-12-02T10:00:00Z" }],
    });
    expect(await editQuranLogEntryCore(f.client, U, "2026-12-02", "z", { to: 600 })).toMatchObject({ ok: true, currentPage: 601 });
    expect(f.tables.quran_plans[0]).toMatchObject({ status: "active", completed_on: null, current_page: 601 });
  });
  it("an unknown entry is a message, not a crash", async () => {
    const f = seed();
    expect(await editQuranLogEntryCore(f.client, U, TODAY, "nope", { to: 5 })).toMatchObject({ ok: false });
    expect(await deleteQuranLogEntryCore(f.client, U, TODAY, "nope")).toMatchObject({ ok: false });
  });
});
