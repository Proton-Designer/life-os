import type { QuranOverview } from "@/lib/quran/plan-core";

/**
 * QURAN-01: small PURE adapters from the one QuranOverview read to what each surface shows (Home -> Now, the Deen row of
 * Home's sector progress, the evening close, the Sunday reset look-back, the khatm screen), so every surface reads the same
 * numbers and none re-derives plan maths. Type-only import of plan-core: client-safe, no server-only at runtime. Callers
 * gate on Deen Mode BEFORE loading the overview (OFF hides everything, data kept); a null overview means "show nothing".
 */

export type HomeNowItem = { title: string; from: number; to: number; pages: number; surahLabel: string; juz: number; /** The juz range of the portion ("Juz 1–10"). Always set by homeNowItem; optional so older fixtures still type-check. */ juzFrom?: number; juzTo?: number; done: boolean };

/** Home -> Now: "Quran · pages a-b" while there is a portion to read (also when today's is already done, so the row can show it ticked). */
export function homeNowItem(o: QuranOverview | null): HomeNowItem | null {
  if (!o?.plan || o.plan.status !== "active" || !o.portion) return null;
  const { from, to, pages, done, surahLabel, juz, juzFrom, juzTo } = o.portion;
  return { title: from === to ? `Quran · page ${from}` : `Quran · pages ${from}–${to}`, from, to, pages, surahLabel, juz, juzFrom, juzTo, done };
}

export type SectorRow = { label: string; percent: number; kind: "on_track" | "behind" | "ahead" | "paused" | "completed"; onTrack: boolean };

/** Home -> Sector progress, Deen row: "Khatm 2 · 14%" and whether it's on track. */
export function sectorRow(o: QuranOverview | null): SectorRow | null {
  if (!o?.plan || !o.status) return null;
  return {
    label: `Khatm ${o.plan.khatmNumber} · ${o.plan.percent}%`,
    percent: o.plan.percent,
    kind: o.status.kind,
    onTrack: o.status.kind === "on_track" || o.status.kind === "ahead" || o.status.kind === "completed",
  };
}

export type CloseLine = { kind: "done"; pages: number; text: string } | { kind: "not_yet"; text: string };

/** Evening close, reflect stage: "Quran today ✓ N pages" or "Not yet — log?". null when there is no active plan (nothing to ask). */
export function closeLine(o: QuranOverview | null): CloseLine | null {
  if (!o?.plan || o.plan.status !== "active") return null;
  if (o.pagesReadToday > 0) return { kind: "done", pages: o.pagesReadToday, text: `Quran today ✓ ${o.pagesReadToday} page${o.pagesReadToday === 1 ? "" : "s"}` };
  return { kind: "not_yet", text: "Quran today: not yet. Log it?" };
}

export type WeeklyLookBack = {
  pagesRead: number;
  plannedToDate: number;
  status: NonNullable<QuranOverview["status"]>["kind"];
  /** The finish day including paused days (the Keep / Move choice is about this date). */
  finishDate: string;
  projectedFinish: string | null;
  suggestMoveDate: boolean;
  suggestedDate: string | null;
  readingDaysLast7: number;
};

/** Sunday reset look-back: pages this week vs the plan, and the finish date to keep or move. */
export function weeklyLookBack(o: QuranOverview | null): WeeklyLookBack | null {
  if (!o?.plan || !o.status || o.plan.status === "completed") return null;
  return {
    pagesRead: o.week.pagesRead,
    plannedToDate: o.week.plannedToDate,
    status: o.status.kind,
    finishDate: o.status.effectiveTargetDate,
    projectedFinish: o.status.projectedFinish,
    suggestMoveDate: o.status.suggestMoveDate,
    suggestedDate: o.status.suggestedDate,
    readingDaysLast7: o.readingDaysLast7,
  };
}

export type KhatmScreen = { khatmNumber: number; completedOn: string | null; juzCompleted: number };

/** The "Khatm N complete" screen (with the offer to start Khatm N+1): only for a finished plan. */
export function khatmScreen(o: QuranOverview | null): KhatmScreen | null {
  if (!o?.plan || o.plan.status !== "completed") return null;
  return { khatmNumber: o.plan.khatmNumber, completedOn: o.plan.completedOn, juzCompleted: o.juz.completed };
}

/** The weekly Quran page target: the plan's (daily pace x 7) while a plan is ACTIVE, else the manually typed one. */
export function weeklyQuranTarget(o: QuranOverview | null, manualTarget: number | null): number | null {
  return (o?.plan?.status === "active" ? o.week.weeklyTargetPages : null) ?? manualTarget;
}
