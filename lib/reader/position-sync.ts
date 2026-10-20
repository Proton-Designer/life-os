// Server bookmark sync. The browser copy (reader-storage) is written on every change; this sends the newest value to
// the server at most every few seconds while reading, and immediately on pause / hide / close. A failed send is not
// retried on its own: the next push carries the newest position anyway, and the local copy never lost it.

export interface PositionPayload {
  bookId: string;
  wordIndex: number;
  wpm: number;
  /** ISO time of the last change on this device; the server keeps the newest. */
  clientUpdatedAt: string;
}

export interface PositionSync {
  push(index: number, updatedAt: number, wpm: number): void;
  /** Send now if there is something unsent. */
  flush(): void;
  cancel(): void;
}

export function createPositionSync(opts: {
  bookId: string;
  send: (p: PositionPayload) => void;
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}): PositionSync {
  const delay = opts.delayMs ?? 4000;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let pending: PositionPayload | null = null;
  let timer: unknown = null;

  function send() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (!pending) return;
    const p = pending;
    pending = null;
    opts.send(p);
  }

  return {
    push(index, updatedAt, wpm) {
      pending = { bookId: opts.bookId, wordIndex: index, wpm, clientUpdatedAt: new Date(updatedAt).toISOString() };
      if (timer === null) timer = setTimer(send, delay);
    },
    flush: send,
    cancel() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      pending = null;
    },
  };
}

/** Fire-and-forget POST that survives the page closing (the Server Action queue does not). */
export function sendPositionBeacon(p: PositionPayload): void {
  try {
    void fetch("/api/reader/position", {
      method: "POST",
      body: JSON.stringify(p),
      // text/plain keeps this a "simple" request (no CORS preflight), like navigator.sendBeacon.
      headers: { "content-type": "text/plain" },
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  } catch {
    // offline or blocked: the local copy still has the position
  }
}
