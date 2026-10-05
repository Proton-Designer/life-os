// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  deenOn: vi.fn(),
  revalidate: vi.fn(),
  start: vi.fn(), log: vi.fn(), undo: vi.fn(), bookmark: vi.fn(), keepMove: vi.fn(), pause: vi.fn(), resume: vi.fn(), next: vi.fn(), overview: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/lib/supabase/auth", () => ({ requireUser: async () => ({ supabase: { tag: "sb" }, userId: "user-1" }) }));
vi.mock("@/lib/deen/deen-mode-guard", () => ({
  isDeenModeOnForRequest: m.deenOn,
  getRequestTimezone: async () => "America/Chicago",
  DEEN_MODE_OFF_MESSAGE: "Deen Mode is off",
}));
vi.mock("@/lib/quran/plan-core", () => ({
  startQuranPlanCore: m.start, logQuranReadingCore: m.log, undoLastQuranLogCore: m.undo, setQuranBookmarkCore: m.bookmark,
  keepOrMoveFinishDateCore: m.keepMove, pauseQuranPlanCore: m.pause, resumeQuranPlanCore: m.resume, startNextKhatmCore: m.next, getQuranOverviewCore: m.overview,
}));

import {
  getMyQuranOverview, keepOrMoveFinishDate, logQuranReading, pauseQuranPlan, resumeQuranPlan, setQuranBookmark, startNextKhatm, startQuranPlan, undoLastQuranLog,
} from "../quran-plan-actions";

const ALL = ["/deen", "/", "/close", "/week", "/insights"];
const ACTIONS: Array<[string, () => Promise<unknown>, ReturnType<typeof vi.fn>]> = [
  ["startQuranPlan", () => startQuranPlan({}), m.start],
  ["logQuranReading", () => logQuranReading({ todaysPortion: true }), m.log],
  ["undoLastQuranLog", () => undoLastQuranLog(), m.undo],
  ["setQuranBookmark", () => setQuranBookmark(50), m.bookmark],
  ["keepOrMoveFinishDate", () => keepOrMoveFinishDate(null), m.keepMove],
  ["pauseQuranPlan", () => pauseQuranPlan(), m.pause],
  ["resumeQuranPlan", () => resumeQuranPlan(), m.resume],
  ["startNextKhatm", () => startNextKhatm(), m.next],
];

beforeEach(() => {
  vi.clearAllMocks();
  m.deenOn.mockResolvedValue(true);
  for (const fn of [m.start, m.log, m.undo, m.bookmark, m.keepMove, m.pause, m.resume, m.next]) fn.mockResolvedValue({ ok: true });
});

describe("Deen gate", () => {
  it.each(ACTIONS)("%s: Deen Mode OFF is refused server-side, touches no data and revalidates nothing", async (_n, call, core) => {
    m.deenOn.mockResolvedValue(false);
    expect(await call()).toEqual({ ok: false, message: "Deen Mode is off" });
    expect(core).not.toHaveBeenCalled();
    expect(m.revalidate).not.toHaveBeenCalled();
  });
  it("positive control: the same calls with Deen Mode ON DO reach their core and revalidate every page", async () => {
    for (const [, call, core] of ACTIONS) {
      m.revalidate.mockClear();
      expect(await call()).toMatchObject({ ok: true });
      expect(core).toHaveBeenCalledTimes(1);
      expect(m.revalidate.mock.calls.map((c) => c[0])).toEqual(ALL);
    }
  });
  it("the overview reads null while Deen Mode is off, data otherwise", async () => {
    m.deenOn.mockResolvedValue(false);
    expect(await getMyQuranOverview()).toBeNull();
    expect(m.overview).not.toHaveBeenCalled();
    m.deenOn.mockResolvedValue(true);
    m.overview.mockResolvedValue({ plan: null });
    expect(await getMyQuranOverview()).toEqual({ plan: null });
  });
});

describe("local date + errors", () => {
  it("uses the user's LOCAL date (Chicago), not UTC, and passes the log options through", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T03:30:00Z")); // 22:30 on Oct 4 in Chicago
    await logQuranReading({ toPage: 20 }, { forDate: "yesterday" });
    expect(m.log).toHaveBeenCalledWith({ tag: "sb" }, "user-1", "2026-10-04", { toPage: 20 }, "yesterday");
    await pauseQuranPlan();
    expect(m.pause).toHaveBeenCalledWith({ tag: "sb" }, "user-1", "2026-10-04");
    vi.useRealTimers();
  });
  it("an expected refusal from the core is returned untouched and revalidates nothing; a thrown error becomes { ok:false, message }", async () => {
    m.log.mockResolvedValue({ ok: false, message: "Your plan is paused." });
    expect(await logQuranReading({ toPage: 5 })).toEqual({ ok: false, message: "Your plan is paused." });
    expect(m.revalidate).not.toHaveBeenCalled();
    m.log.mockRejectedValue(new Error("db down"));
    expect(await logQuranReading({ toPage: 5 })).toEqual({ ok: false, message: "db down" });
    expect(m.revalidate).not.toHaveBeenCalled();
  });
});
