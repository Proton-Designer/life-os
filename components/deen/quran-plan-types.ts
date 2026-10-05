/**
 * QURAN-02: the Quran khatm card's LOCAL interface. The card renders a plain view model and calls a small actions
 * object; both are defined here so the UI can be built and tested before (and independent of) eng1's QURAN-01 readers
 * and actions. When those land, one connector maps getQuranOverview() -> QuranPlanView and the real actions ->
 * QuranPlanActions; nothing in the card changes.
 */

export const QURAN_TOTAL_PAGES = 604;

export type QuranPortion = { fromPage: number; toPage: number; pages: number; /** "Al-Baqarah · Juz 1" */ label: string };

export type QuranStatus = {
  kind: "on_track" | "behind" | "ahead";
  /** Pages behind / ahead (0 when on track). */
  pages: number;
  /** Roughly how many days that is at the plan's pace. */
  days: number | null;
  /** Pages/day needed from today to still finish on the target date. */
  neededPerDay: number;
  /** YYYY-MM-DD at the recent pace, or null when there is too little data. */
  projectedFinish: string | null;
  /** The needed pace is over 2x the original: suggest moving the date first. */
  suggestMove: boolean;
};

export type QuranPlanView =
  | { kind: "none"; /** The bookmark of a past/legacy reading, for "start from my current page". */ currentPage: number | null }
  | {
      kind: "plan";
      khatmNumber: number;
      state: "active" | "paused" | "completed";
      /** The NEXT page to read (1..604; 605 = finished). */
      currentPage: number;
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
      /** Set right after a juz completes ("Juz 7 complete · 7 of 30"). */
      juzComplete: { juz: number } | null;
    };

export type QuranStartInput = { preset: "30d" | "60d" | "6m" | "ramadan" } | { targetDate: string } | { pagesPerDay: number };

export type QuranActionResult = { ok: true } | { ok: false; message: string };

export type QuranPlanActions = {
  start(input: QuranStartInput, startPage: number): Promise<QuranActionResult>;
  logPortion(forDate: "today" | "yesterday"): Promise<QuranActionResult>;
  logToPage(toPage: number, forDate: "today" | "yesterday"): Promise<QuranActionResult>;
  undoLast(): Promise<QuranActionResult>;
  setBookmark(page: number): Promise<QuranActionResult>;
  /** Keep the date (acknowledge) or move it (null = to the projected finish). */
  keepDate(): Promise<QuranActionResult>;
  moveDate(newDate: string | null): Promise<QuranActionResult>;
  pause(): Promise<QuranActionResult>;
  resume(): Promise<QuranActionResult>;
  startNext(): Promise<QuranActionResult>;
};
