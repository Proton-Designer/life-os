/**
 * When today's Quran portion shows on Home. The window is two local clock times ("HH:MM", 24-hour storage); null in
 * settings means the default 22:00 -> 01:00, which CROSSES midnight. The end is exclusive.
 *
 * Inside the part of a midnight-crossing window that is AFTER midnight the portion belongs to the evening that started it,
 * so the answer is `forDate: "yesterday"` (the row shows, and a "Read" files, the previous local date's reading).
 */
export const DEFAULT_QURAN_REMINDER_START = "22:00";
export const DEFAULT_QURAN_REMINDER_END = "01:00";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type QuranReminderState = null | { forDate: "today" | "yesterday" };

export function quranReminderState(nowLocalHHMM: string, startHHMM: string | null | undefined, endHHMM: string | null | undefined): QuranReminderState {
  const start = startHHMM ?? DEFAULT_QURAN_REMINDER_START;
  const end = endHHMM ?? DEFAULT_QURAN_REMINDER_END;
  if (![nowLocalHHMM, start, end].every((v) => HHMM.test(v))) return null;
  if (start === end) return null; // refused upstream (settings); an empty window shows nothing rather than all day
  // Zero-padded "HH:MM" compares correctly as a string.
  if (start < end) return nowLocalHHMM >= start && nowLocalHHMM < end ? { forDate: "today" } : null;
  if (nowLocalHHMM >= start) return { forDate: "today" };
  if (nowLocalHHMM < end) return { forDate: "yesterday" };
  return null;
}
