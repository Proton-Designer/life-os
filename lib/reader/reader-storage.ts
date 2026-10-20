import { DEFAULT_READER_SETTINGS, type ReaderSettings, type ReaderTheme } from "./types";
import { clampWpm } from "./rsvp";
import { READER_THEMES } from "./themes";

// Browser-local reader state: position per book (written on every change, throttled), settings, view mode.
// Every access is wrapped: storage can be absent, full or blocked (private windows), and the reader must still work.

export type ReaderStorage = Pick<Storage, "getItem" | "setItem">;
export type ReaderMode = "rsvp" | "page";

export interface StoredPosition {
  /** Global word index. */
  index: number;
  /** Client clock (ms since epoch) of the last change; "newest wins" against the server copy. */
  updatedAt: number;
}

const POSITION_PREFIX = "lifeos.reader.position.";
const MODE_PREFIX = "lifeos.reader.mode.";
const SETTINGS_KEY = "lifeos.reader.settings";

export function browserStorage(): ReaderStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readJson(storage: ReaderStorage | null, key: string): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(storage: ReaderStorage | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota / blocked: position is a convenience, never a reason to break reading.
  }
}

export function loadPosition(storage: ReaderStorage | null, bookId: string): StoredPosition | null {
  const v = readJson(storage, POSITION_PREFIX + bookId) as Partial<StoredPosition> | null;
  if (!v || typeof v.index !== "number" || !Number.isInteger(v.index) || v.index < 0) return null;
  return { index: v.index, updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : 0 };
}

export function savePosition(storage: ReaderStorage | null, bookId: string, pos: StoredPosition): void {
  writeJson(storage, POSITION_PREFIX + bookId, pos);
}

/** The newer of two positions by client timestamp (ties keep the local one); either may be absent. */
export function pickNewestPosition(local: StoredPosition | null, remote: StoredPosition | null): StoredPosition | null {
  if (!local) return remote;
  if (!remote) return local;
  return remote.updatedAt > local.updatedAt ? remote : local;
}

export function loadMode(storage: ReaderStorage | null, bookId: string): ReaderMode | null {
  const v = readJson(storage, MODE_PREFIX + bookId);
  return v === "rsvp" || v === "page" ? v : null;
}

export function saveMode(storage: ReaderStorage | null, bookId: string, mode: ReaderMode): void {
  writeJson(storage, MODE_PREFIX + bookId, mode);
}

function num(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

/** Coerce anything (stored JSON, a server row) into valid settings; unknown/invalid fields fall back to defaults. */
export function sanitizeSettings(raw: unknown): ReaderSettings {
  const d = DEFAULT_READER_SETTINGS;
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const goal = v.dailyWordGoal;
  return {
    wpm: typeof v.wpm === "number" ? clampWpm(v.wpm) : d.wpm,
    fontScale: num(v.fontScale, 0.75, 2, d.fontScale),
    theme: READER_THEMES.includes(v.theme as ReaderTheme) ? (v.theme as ReaderTheme) : d.theme,
    voiceUri: typeof v.voiceUri === "string" && v.voiceUri.length > 0 ? v.voiceUri : null,
    speechRate: num(v.speechRate, 0.5, 3, d.speechRate),
    focalLines: typeof v.focalLines === "boolean" ? v.focalLines : d.focalLines,
    dailyWordGoal: typeof goal === "number" && Number.isInteger(goal) && goal > 0 ? goal : null,
  };
}

export function loadSettings(storage: ReaderStorage | null): ReaderSettings {
  return sanitizeSettings(readJson(storage, SETTINGS_KEY));
}

export function saveSettings(storage: ReaderStorage | null, settings: ReaderSettings): void {
  writeJson(storage, SETTINGS_KEY, settings);
}

export interface PositionSaver {
  /** Record the latest position; the write happens at most once per `intervalMs`. */
  push(index: number): void;
  /** Write any pending position now (pause, tab hidden, unload). */
  flush(): void;
  cancel(): void;
}

/** Leading-edge + trailing throttle with an injectable clock/timer so it is testable without fake globals. */
export function createPositionSaver(opts: {
  storage: ReaderStorage | null;
  bookId: string;
  intervalMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onWrite?: (pos: StoredPosition) => void;
}): PositionSaver {
  const interval = opts.intervalMs ?? 500;
  const now = opts.now ?? Date.now;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let pending: number | null = null;
  let pendingAt = 0;
  let lastWrite = -Infinity;
  let timer: unknown = null;

  function write() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (pending === null) return;
    const pos = { index: pending, updatedAt: pendingAt };
    pending = null;
    lastWrite = now();
    savePosition(opts.storage, opts.bookId, pos);
    opts.onWrite?.(pos);
  }

  return {
    push(index) {
      pending = index;
      pendingAt = now();
      const wait = interval - (now() - lastWrite);
      if (wait <= 0) write();
      else if (timer === null) timer = setTimer(write, wait);
    },
    flush: write,
    cancel() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      pending = null;
    },
  };
}
