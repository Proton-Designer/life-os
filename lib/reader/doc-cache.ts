import { READER_DOC_VERSION, type ReaderDoc } from "./types";

// The reader document is fetched from a short-lived signed URL. A copy is kept in IndexedDB (keyed by book + doc
// version) so reopening a book is instant and a book already opened on this device still opens with no network.

export interface DocCache {
  get(key: string): Promise<ReaderDoc | null>;
  put(key: string, doc: ReaderDoc): Promise<void>;
}

export const docCacheKey = (bookId: string, version: number | null) => `${bookId}@${version ?? READER_DOC_VERSION}`;

const DB_NAME = "lifeos-reader";
const STORE = "docs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB-backed cache; every call swallows failure (private windows, blocked storage) and behaves as a miss. */
export function indexedDbDocCache(): DocCache | null {
  if (typeof indexedDB === "undefined") return null;
  return {
    async get(key) {
      try {
        const db = await openDb();
        return await new Promise<ReaderDoc | null>((resolve) => {
          const r = db.transaction(STORE).objectStore(STORE).get(key);
          r.onsuccess = () => resolve((r.result as ReaderDoc | undefined) ?? null);
          r.onerror = () => resolve(null);
        });
      } catch {
        return null;
      }
    },
    async put(key, doc) {
      try {
        const db = await openDb();
        await new Promise<void>((resolve) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put(doc, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
      } catch {
        // ignore
      }
    },
  };
}

export type LoadDocResult = { ok: true; doc: ReaderDoc; fromCache: boolean } | { ok: false; message: string };

/** Cache first (instant, offline-safe); otherwise fetch the signed URL and remember the result. */
export async function loadReaderDoc(args: {
  bookId: string;
  version: number | null;
  docUrl: string | null;
  cache?: DocCache | null;
  fetchImpl?: typeof fetch;
}): Promise<LoadDocResult> {
  const key = docCacheKey(args.bookId, args.version);
  const cached = await args.cache?.get(key);
  if (cached && cached.version === READER_DOC_VERSION && Array.isArray(cached.blocks)) return { ok: true, doc: cached, fromCache: true };
  if (!args.docUrl) return { ok: false, message: "This book isn't ready to read yet." };
  try {
    const res = await (args.fetchImpl ?? fetch)(args.docUrl);
    if (!res.ok) return { ok: false, message: "The book couldn't be downloaded. Check your connection and try again." };
    const doc = (await res.json()) as ReaderDoc;
    if (doc.version !== READER_DOC_VERSION || !Array.isArray(doc.blocks)) return { ok: false, message: "This book was saved in a format this version can't open." };
    await args.cache?.put(key, doc);
    return { ok: true, doc, fromCache: false };
  } catch {
    return { ok: false, message: "The book couldn't be downloaded. Check your connection and try again." };
  }
}
