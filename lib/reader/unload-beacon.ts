// Writes that must survive the tab closing. A Server Action is queued behind others and cancelled with the page; a
// keepalive fetch is handed to the browser and finishes after it. text/plain keeps it a "simple" request (no CORS
// preflight), like navigator.sendBeacon. Position has its own sender in position-sync.ts.

/** "network": nothing came back (offline, blocked); "refused": the server answered with a non-2xx. */
export type SendOutcome = "ok" | "refused" | "network";

async function postOutcome(path: string, payload: unknown): Promise<SendOutcome> {
  try {
    const res = await fetch(path, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "content-type": "text/plain" },
      keepalive: true,
      credentials: "same-origin",
    });
    return res.ok ? "ok" : "refused";
  } catch {
    return "network"; // offline or blocked: the caller decides whether that matters
  }
}

async function post(path: string, payload: unknown): Promise<boolean> {
  return (await postOutcome(path, payload)) === "ok";
}

/** Resolves true when the server stored the stretch. */
export function sendSessionBeacon(stretch: unknown): Promise<boolean> {
  return post("/api/reader/session", stretch);
}

/** Like sendSessionBeacon but says why it failed, so a retry queue can tell "no connection" from "refused". */
export function sendSessionAttempt(stretch: unknown): Promise<SendOutcome> {
  return postOutcome("/api/reader/session", stretch);
}

/** Resolves true when the server stored the settings patch. */
export function sendSettingsBeacon(patch: unknown): Promise<boolean> {
  return post("/api/reader/settings", patch);
}

type Patch = Record<string, unknown>;

/**
 * Sends settings patches so the LAST change always wins. Two keepalive POSTs can land out of order, so ordinary sends go
 * one at a time (the next waits for the previous answer, patches meanwhile merge, newest value per key). On unload there
 * is no waiting: the body carries everything not yet acknowledged plus the newest changes. That makes the final request
 * hold the newest value of every key; it does not by itself stop an OLDER request that is still in the air from landing
 * after it (requests normally arrive in order, but the browser does not promise it).
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

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;
const toOutcome = (r: SendOutcome | boolean): SendOutcome => (r === true ? "ok" : r === false ? "refused" : r);

export const PENDING_SESSIONS_KEY = "lifeos.reader.pending-sessions";

type PendingStorage = Pick<Storage, "getItem" | "setItem">;
interface Pending {
  payload: StretchPayload;
  tries: number;
}

function loadPending(storage: PendingStorage | null): Pending[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(PENDING_SESSIONS_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is Pending => !!x && typeof x === "object" && typeof (x as Pending).payload?.bookId === "string")
      .map((x) => ({ payload: x.payload, tries: Number.isInteger(x.tries) && x.tries > 0 ? x.tries : 0 }))
      .slice(-MAX_QUEUED_SESSIONS);
  } catch {
    return [];
  }
}

/**
 * Sends finished reading stretches and keeps any whose send failed for the next call (bounded: at most 10 are kept, and a
 * stretch is given up on after 3 REFUSALS from the server). Having no connection is not a refusal: while offline nothing
 * is sent and no try is spent, and a network failure keeps the stretch queued for the next submit or the "online" event.
 * Safe to resend because the server stores a stretch with the same user, book and span once.
 *
 * With `storage`, every unconfirmed stretch (also one in the air) is mirrored there, so a tab closed while offline does
 * not lose it: the next sender built on the same storage starts with it, and `submit()` with no argument drains it. A
 * stretch for a book the signed-in user does not own is refused by the server and dropped after 3 tries. Two tabs share
 * the key last-write-wins; that can lose the other tab's queue (rare, bounded to 10 stretches).
 */
export function createSessionSender(
  send: (p: StretchPayload) => Promise<SendOutcome | boolean> = sendSessionAttempt,
  onStored?: () => void,
  offline: () => boolean = isOffline,
  storage: PendingStorage | null = null
) {
  let items: Pending[] = loadPending(storage);
  const inAir = new Set<Pending>();

  function persist() {
    if (!storage) return;
    try {
      storage.setItem(PENDING_SESSIONS_KEY, JSON.stringify(items));
    } catch {
      // Quota / blocked: the in-memory queue still works.
    }
  }
  function drop(item: Pending) {
    items = items.filter((x) => x !== item);
    persist();
  }

  return {
    submit(payload?: StretchPayload) {
      if (payload) items.push({ payload, tries: 0 });
      items = items.slice(-MAX_QUEUED_SESSIONS);
      persist();
      if (offline()) return;
      for (const item of items.filter((x) => !inAir.has(x))) {
        inAir.add(item);
        void send(item.payload).then((r) => {
          inAir.delete(item);
          const outcome = toOutcome(r);
          if (outcome === "ok") {
            drop(item);
            return onStored?.();
          }
          if (outcome === "refused") item.tries += 1;
          if (item.tries >= MAX_SESSION_TRIES) drop(item);
          else persist();
        });
      }
    },
    waiting: () => items.filter((x) => !inAir.has(x)).length,
  };
}
