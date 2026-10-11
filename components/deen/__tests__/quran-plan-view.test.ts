import { describe, expect, it } from "vitest";
import { toQuranPlanView } from "../quran-plan-view";
import type { QuranOverview } from "@/lib/quran/plan-core";

const overview = (over: Partial<QuranOverview> = {}, statusOver: Record<string, unknown> = {}): QuranOverview =>
  ({
    plan: { id: "p", khatmNumber: 2, status: "active", currentPage: 41, currentAyah: null, startPage: 1, startDate: "2026-10-01", targetDate: "2026-12-04", completedOn: null, percent: 6, pagesLeft: 564, pacePagesPerDay: 9.97 },
    portion: { from: 41, to: 50, pages: 10, done: false, surahLabel: "Al-Baqarah", juz: 2, juzFrom: 2, juzTo: 2 },
    status: { kind: "behind", pages: 30, days: 3, pagesLeft: 564, daysLeft: 47, neededPerDay: 11.2, planPace: 9.97, effectiveTargetDate: "2026-12-06", projectedFinish: "2026-12-20", recent: { pagesPerDay: 8, dataPoints: 5, usedPlanPace: false }, suggestMoveDate: false, suggestedDate: null, ...statusOver },
    readingDaysLast7: 5,
    week: { pagesRead: 20, plannedToDate: 30, weeklyTargetPages: 70 },
    pagesReadToday: 0,
    daily: [{ date: "2026-10-05", pages: 4 }],
    juz: { current: 2, completed: 1 },
    ...over,
  }) as unknown as QuranOverview;

describe("toQuranPlanView", () => {
  it("no overview or no plan -> the setup state", () => {
    expect(toQuranPlanView(null)).toEqual({ kind: "none" });
    expect(toQuranPlanView(overview({ plan: null }))).toEqual({ kind: "none" });
  });

  it("maps the plan: label, whole pages-per-day, effective target date, ceil'd needed pace, last-7", () => {
    const v = toQuranPlanView(overview());
    expect(v).toMatchObject({ kind: "plan", khatmNumber: 2, state: "active", currentPage: 41, pagesPerDay: 10, targetDate: "2026-12-06", last7Days: 5 });
    if (v.kind !== "plan") throw new Error("plan");
    expect(v.portion).toEqual({ fromPage: 41, toPage: 50, pages: 10, label: "Al-Baqarah · Juz 2" });
    expect(v.status).toMatchObject({ kind: "behind", pages: 30, days: 3, neededPerDay: 12 }); // 11.2 -> 12
  });

  it("carries the ledger, the 14-day series and the exact ayah through to the card", () => {
    const ledger = [{ id: "a", date: "2026-10-04", from: 1, to: 40, seq: 1 }];
    const v = toQuranPlanView(overview({ plan: { ...overview().plan!, currentAyah: 149 } }), ledger);
    if (v.kind !== "plan") throw new Error("plan");
    expect(v).toMatchObject({ currentAyah: 149, startPage: 1, startDate: "2026-10-01", ledger, daily: [{ date: "2026-10-05", pages: 4 }] });
    const bare = toQuranPlanView(overview());
    if (bare.kind !== "plan") throw new Error("plan");
    expect(bare.ledger).toEqual([]); // no ledger read yet = an empty log, never undefined
  });

  it("a portion that spans several juz is labelled 'Juz a–b' (positive control: one juz stays 'Juz n')", () => {
    const wide = toQuranPlanView(overview({ portion: { from: 1, to: 200, pages: 200, done: false, surahLabel: "Al-Fatiha – Al-Anfal", juz: 1, juzFrom: 1, juzTo: 10 } as unknown as QuranOverview["portion"] }));
    const one = toQuranPlanView(overview());
    if (wide.kind !== "plan" || one.kind !== "plan") throw new Error("plan");
    expect(wide.portion?.label).toBe("Al-Fatiha – Al-Anfal · Juz 1–10");
    expect(one.portion?.label).toBe("Al-Baqarah · Juz 2");
  });

  it("the projected finish is hidden when it only repeats the plan pace (too little data), and shown with real data (positive control)", () => {
    const sparse = toQuranPlanView(overview({}, { recent: { pagesPerDay: 9.97, dataPoints: 1, usedPlanPace: true }, suggestedDate: null }));
    const real = toQuranPlanView(overview());
    if (sparse.kind !== "plan" || real.kind !== "plan") throw new Error("plan");
    expect(sparse.status?.projectedFinish).toBeNull();
    expect(real.status?.projectedFinish).toBe("2026-12-20");
  });

  it("paused/completed have no on-track status; the move suggestion prefers suggestedDate", () => {
    const paused = toQuranPlanView(overview({ plan: { ...overview().plan!, status: "paused" } }, { kind: "paused" }));
    if (paused.kind !== "plan") throw new Error("plan");
    expect(paused.status).toBeNull();
    const suggest = toQuranPlanView(overview({}, { suggestMoveDate: true, suggestedDate: "2027-01-10" }));
    if (suggest.kind !== "plan") throw new Error("plan");
    expect(suggest.status).toMatchObject({ suggestMove: true, suggestedDate: "2027-01-10" });
  });

  it("the juz note comes from the overview (juz.completedToday), not from an action result", () => {
    const withJuz = toQuranPlanView(overview({ juz: { current: 3, completed: 2, completedToday: [2] } as unknown as QuranOverview["juz"] }));
    const without = toQuranPlanView(overview());
    if (withJuz.kind !== "plan" || without.kind !== "plan") throw new Error("plan");
    expect(withJuz.juzComplete).toEqual({ juz: 2 });
    expect(without.juzComplete).toBeNull();
  });
});
