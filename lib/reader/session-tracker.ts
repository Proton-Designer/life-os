import type { ReaderMode } from "./reader-storage";

// Turns position changes into reading sessions (DESIGN §6). Pure: the clock is injected. A "stretch" is a run of forward
// progress in one mode; it closes on a mode change, an idle gap, or when the caller takes it (pause / hide / close).
// Big jumps (scrubber, chapter, tap far away) and going backwards are navigation, not reading, so they add no words.

export interface ReadingStretch {
  startedAt: number;
  endedAt: number;
  wordsRead: number;
  mode: "rsvp" | "page" | "listen";
  avgWpm: number | null;
}

export type TrackedMode = ReaderMode | "listen";

/** Forward moves larger than this are navigation. A long sentence skip is well under it. */
export const MAX_READING_JUMP = 120;
/** No progress for this long ends the stretch, and the gap itself is not counted as reading time. */
export const IDLE_GAP_MS = 2 * 60 * 1000;
/** A stretch this old is handed over so a hard close loses at most about a minute. */
export const FLUSH_AFTER_MS = 60 * 1000;
const MIN_STRETCH_MS_FOR_WPM = 5000;

export interface SessionTracker {
  /** Report the position after every change. */
  advance(index: number, mode: TrackedMode): void;
  /** True when the open stretch is old enough to be sent. */
  due(): boolean;
  /** Closed stretches plus the open one; resets. Empty stretches (no words) are dropped. */
  take(): ReadingStretch[];
}

export function createSessionTracker(now: () => number = Date.now): SessionTracker {
  let prev: number | null = null;
  let lastAt = 0;
  let open: { startedAt: number; endedAt: number; words: number; mode: TrackedMode } | null = null;
  const done: ReadingStretch[] = [];

  const finish = () => {
    if (!open) return;
    if (open.words > 0) {
      const ms = open.endedAt - open.startedAt;
      const wpm = ms >= MIN_STRETCH_MS_FOR_WPM ? Math.min(5000, Math.round(open.words / (ms / 60000))) : null;
      done.push({ startedAt: open.startedAt, endedAt: open.endedAt, wordsRead: open.words, mode: open.mode as ReadingStretch["mode"], avgWpm: wpm });
    }
    open = null;
  };

  return {
    advance(index, mode) {
      const t = now();
      const before = prev;
      const gap = t - lastAt;
      prev = index;
      lastAt = t;
      if (before === null) return;
      if (open && (open.mode !== mode || gap > IDLE_GAP_MS)) finish();
      const delta = index - before;
      if (delta < 1 || delta > MAX_READING_JUMP) return;
      if (!open) open = { startedAt: gap <= IDLE_GAP_MS ? t - gap : t, endedAt: t, words: 0, mode };
      open.words += delta;
      open.endedAt = t;
    },
    due() {
      return !!open && open.words > 0 && now() - open.startedAt >= FLUSH_AFTER_MS;
    },
    take() {
      finish();
      // Forget the position: the first step after a pause only re-anchors, so time spent paused is never counted.
      prev = null;
      return done.splice(0, done.length);
    },
  };
}
