// Writes that must survive the tab closing. A Server Action is queued behind others and cancelled with the page; a
// keepalive fetch is handed to the browser and finishes after it. text/plain keeps it a "simple" request (no CORS
// preflight), like navigator.sendBeacon. Position has its own sender in position-sync.ts.

async function post(path: string, payload: unknown): Promise<boolean> {
  try {
    const res = await fetch(path, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "content-type": "text/plain" },
      keepalive: true,
      credentials: "same-origin",
    });
    return res.ok;
  } catch {
    return false; // offline or blocked: the caller decides whether that matters
  }
}

/** Resolves true when the server stored the stretch. */
export function sendSessionBeacon(stretch: unknown): Promise<boolean> {
  return post("/api/reader/session", stretch);
}

/** Resolves true when the server stored the settings patch. */
export function sendSettingsBeacon(patch: unknown): Promise<boolean> {
  return post("/api/reader/settings", patch);
}

type Patch = Record<string, unknown>;

/**
 * Sends settings patches so the LAST change always wins. Two keepalive POSTs can land out of order, so ordinary sends go
 * one at a time (the next waits for the previous answer, patches meanwhile merge, newest value per key). On unload there
 * is no waiting: the body carries everything not yet acknowledged plus the newest changes, so whichever request lands
 * last still holds the latest value of every key.
 */
export function createSettingsSender(send: (patch: Patch) => Promise<boolean> = sendSettingsBeacon) {
  let inFlight: Promise<void> | null = null;
  let unacked: Patch = {}; // sent, answer not seen yet
  let queued: Patch = {}; // waiting for the in-flight send

  function pump() {
    if (inFlight || Object.keys(queued).length === 0) return;
    const body = queued;
    queued = {};
    unacked = { ...unacked, ...body };
    inFlight = send(body)
      .then((ok) => {
        inFlight = null;
        if (ok) {
          for (const k of Object.keys(body)) if (unacked[k] === body[k]) delete unacked[k];
          pump(); // whatever changed while that was in the air
        } else {
          // Retrying here could loop on a refusal: the next change (or the unload send) retries, newest value kept.
          queued = { ...body, ...queued };
        }
      });
  }

  return {
    submit(patch: Patch) {
      queued = { ...queued, ...patch };
      pump();
    },
    /** Tab hiding or closing: one request with the newest value of everything not yet confirmed. */
    submitNow(patch: Patch = {}) {
      const body = { ...unacked, ...queued, ...patch };
      queued = {};
      if (Object.keys(body).length === 0) return;
      unacked = { ...unacked, ...body };
      void send(body).then((ok) => {
        if (ok) for (const k of Object.keys(body)) if (unacked[k] === body[k]) delete unacked[k];
      });
    },
    pendingKeys: () => Object.keys({ ...unacked, ...queued }),
  };
}

export interface StretchPayload {
  bookId: string;
  [k: string]: unknown;
}

const MAX_SESSION_TRIES = 3;
const MAX_QUEUED_SESSIONS = 10;

/**
 * Sends finished reading stretches and keeps any whose send failed for the next call (bounded: a stretch is given up on
 * after 3 tries, and at most 10 are kept). Safe to resend because the server stores a stretch with the same book and span once.
 */
export function createSessionSender(send: (p: StretchPayload) => Promise<boolean> = sendSessionBeacon, onStored?: () => void) {
  let waiting: { payload: StretchPayload; tries: number }[] = [];
  return {
    submit(payload?: StretchPayload) {
      if (payload) waiting.push({ payload, tries: 0 });
      const batch = waiting;
      waiting = [];
      for (const item of batch) {
        void send(item.payload).then((ok) => {
          if (ok) return onStored?.();
          item.tries += 1;
          if (item.tries < MAX_SESSION_TRIES) waiting = [...waiting, item].slice(-MAX_QUEUED_SESSIONS);
        });
      }
    },
    waiting: () => waiting.length,
  };
}
