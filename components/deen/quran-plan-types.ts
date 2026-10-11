/**
 * QURAN-02: the Quran khatm card's LOCAL interface. The card renders a plain view model and calls a small actions
 * object; both are defined here so the UI can be built and tested before (and independent of) eng1's QURAN-01 readers
 * and actions. When those land, one connector maps getQuranOverview() -> QuranPlanView and the real actions ->
 * QuranPlanActions; nothing in the card changes.
 */

import type { EntryPatch, LedgerEntry } from "@/lib/quran/ledger";

export const QURAN_TOTAL_PAGES = 604;

/** Any one of these is a way of saying how far you read; the server turns each into a span of whole pages. */
export type QuranLogInput =
  | { pages: number } // "I read N pages"
  | { toPage: number } // "I finished page N"
  | { nextPage: number } // "I'm on page N"
  | { ayah: number }; // "I'm on this ayah" (global ayah number 1..6236)

export type QuranPortion = { fromPage: number; toPage: number; pages: number; /** "Al-Baqarah · Juz 1" */ label: string };

export type QuranStatus = {
  kind: "on_track" | "behind" | "ahead";
  /** Pages behind / ahead (0 when on track). */
  pages: number;
  /** Roughly how many days that is at the plan's pace. */
  days: number | null;
  /** Pages/day needed from today to still finish on the target date. */
  neededPerDay: number;
  /** YYYY-MM-DD at the recent pace, or null when there is too little recent data (the plan pace would just repeat the target). */
  projectedFinish: string | null;
  /** The date to offer for "Move date" (the server's suggestion, else the projected finish). */
  suggestedDate: string | null;
  /** The needed pace is over 2x the original: suggest moving the date first. */
  suggestMove: boolean;
};

export type QuranPlanView =
  | { kind: "none" }
  | {
      kind: "plan";
      khatmNumber: number;
      state: "active" | "paused" | "completed";
      /** The NEXT page to read (1..604; 605 = finished). */
      currentPage: number;
      /** The exact ayah (global number) the reader is on inside currentPage; null = the top of that page. */
      currentAyah: number | null;
      startPage: number;
      /** YYYY-MM-DD the plan started. */
      startDate: string;
      /** The reading log, any order: History, the day-by-day chart and the "will this fit" preview all run on it. */
      ledger: LedgerEntry[];
      /** Pages read on each of the last 14 days, oldest first. */
      daily: { date: string; pages: number }[];
      percent: number;
      /** YYYY-MM-DD */
      targetDate: string;
      pagesPerDay: number;
      /** Today's pages; null when completed/paused. */
      portion: QuranPortion | null;
      /** Today's portion has been read. */
      portionDone: boolean;
      status: QuranStatus | null;
      /** Days read in the last 7 (0..7). */
      last7Days: number;
      /** Juz completed today (server-driven, overview.juz.completedToday): "Juz 7 complete · 7 of 30". */
      juzComplete: { juz: number } | null;
    };

export type QuranStartInput = { preset: "30d" | "60d" | "6m" | "ramadan" } | { targetDate: string } | { pagesPerDay: number };

export type QuranActionResult = { ok: true } | { ok: false; message: string };

export type QuranPlanActions = {
  start(input: QuranStartInput, startPage: number): Promise<QuranActionResult>;
  logPortion(forDate: "today" | "yesterday"): Promise<QuranActionResult>;
  /** Log reading in any of the four ways, filed under `forDate` ("today", "yesterday" or a YYYY-MM-DD day). */
  log(input: QuranLogInput, forDate: string): Promise<QuranActionResult>;
  undoLast(): Promise<QuranActionResult>;
  /** History: change one logged day. */
  editEntry(id: string, patch: EntryPatch): Promise<QuranActionResult>;
  /** History: remove one logged day. */
  deleteEntry(id: string): Promise<QuranActionResult>;
  /** Keep the date (acknowledge) or move it (null = to the projected finish). */
  keepDate(): Promise<QuranActionResult>;
  moveDate(newDate: string | null): Promise<QuranActionResult>;
  pause(): Promise<QuranActionResult>;
  resume(): Promise<QuranActionResult>;
  startNext(): Promise<QuranActionResult>;
};
