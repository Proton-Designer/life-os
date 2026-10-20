import { describe, expect, it, vi } from "vitest";
import { SAMPLE_DOC } from "../__fixtures__/sample-doc";
import { docCacheKey, loadReaderDoc, type DocCache } from "../doc-cache";

function memCache(): DocCache & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return { store, get: async (k) => (store.get(k) as typeof SAMPLE_DOC) ?? null, put: async (k, d) => void store.set(k, d) };
}
const okFetch = () => vi.fn(async () => ({ ok: true, json: async () => SAMPLE_DOC }) as Response);

describe("loadReaderDoc", () => {
  it("fetches once, caches, and then opens from the cache with no network", async () => {
    const cache = memCache();
    const f = okFetch();
    const first = await loadReaderDoc({ bookId: "b", version: 1, docUrl: "https://x/doc", cache, fetchImpl: f as unknown as typeof fetch });
    expect(first).toMatchObject({ ok: true, fromCache: false });
    expect(cache.store.has(docCacheKey("b", 1))).toBe(true);
    const offline = vi.fn(async () => { throw new Error("offline"); });
    const second = await loadReaderDoc({ bookId: "b", version: 1, docUrl: "https://x/doc", cache, fetchImpl: offline as unknown as typeof fetch });
    expect(second).toMatchObject({ ok: true, fromCache: true });
    expect(offline).not.toHaveBeenCalled();
  });
  it("positive control: with no cache and no network it reports a clear failure", async () => {
    const f = vi.fn(async () => { throw new Error("offline"); });
    const r = await loadReaderDoc({ bookId: "b", version: 1, docUrl: "https://x/doc", cache: memCache(), fetchImpl: f as unknown as typeof fetch });
    expect(r.ok).toBe(false);
  });
  it("rejects a document in an unknown format and a missing url", async () => {
    const bad = vi.fn(async () => ({ ok: true, json: async () => ({ version: 99, blocks: [] }) }) as Response);
    expect((await loadReaderDoc({ bookId: "b", version: 1, docUrl: "u", fetchImpl: bad as unknown as typeof fetch })).ok).toBe(false);
    expect((await loadReaderDoc({ bookId: "b", version: 1, docUrl: null })).ok).toBe(false);
  });
});
