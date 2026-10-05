// Accumulates how long a page has been OPEN AND VISIBLE per local day, on this device (HOME-01b: the Lock-In
// hint retires itself after 3 visible minutes). Pure core + a small storage layer; the React hook is
// components/home/use-home-visible-time.ts. Storage is best-effort (private mode / blocked storage / quota
// all throw): every access is in try/catch and the feature degrades to "not retired yet", never an error.

export const HINT_VISIBLE_LIMIT_MS = 3 * 60 * 1000;
/** A tick gap longer than this (laptop asleep, backgrounded timer throttling) is not counted as visible time. */
export const MAX_TICK_GAP_MS = 5_000;

export const visibleTimeKey = (localDate: string) => `lifeos:home-visible-ms:${localDate}`;

export type TimeStorage = Pick<Storage, "getItem" | "setItem">;

export function readVisibleMs(storage: TimeStorage | null, localDate: string): number {
  try {
    const raw = storage?.getItem(visibleTimeKey(localDate));
    const n = raw === null || raw === undefined ? 0 : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function writeVisibleMs(storage: TimeStorage | null, localDate: string, ms: number): void {
  try {
    storage?.setItem(visibleTimeKey(localDate), String(Math.round(ms)));
  } catch {
    /* best-effort */
  }
}

/** Adds the time since `lastTickAt` to `ms` ONLY while the page is active (visible and focused) and the gap is believable. */
export function accumulate(ms: number, lastTickAt: number, nowAt: number, active: boolean): number {
  const gap = nowAt - lastTickAt;
  if (!active || gap <= 0 || gap > MAX_TICK_GAP_MS) return ms;
  return ms + gap;
}

export function safeLocalStorage(): TimeStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
