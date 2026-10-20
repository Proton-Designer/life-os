import { afterEach, describe, expect, it, vi } from "vitest";
import { sendSessionBeacon, sendSettingsBeacon } from "../unload-beacon";

afterEach(() => vi.unstubAllGlobals());

describe("unload beacons", () => {
  it("POST keepalive text/plain to the right route and resolve true on 2xx", async () => {
    const f = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", f);
    expect(await sendSessionBeacon({ a: 1 })).toBe(true);
    expect(await sendSettingsBeacon({ wpm: 400 })).toBe(true);
    expect(f).toHaveBeenNthCalledWith(1, "/api/reader/session", expect.objectContaining({ method: "POST", keepalive: true, body: '{"a":1}', headers: { "content-type": "text/plain" } }));
    expect(f).toHaveBeenNthCalledWith(2, "/api/reader/settings", expect.objectContaining({ keepalive: true, body: '{"wpm":400}' }));
  });
  it("resolves false on a refusal or a network error, never throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    expect(await sendSessionBeacon({})).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await sendSettingsBeacon({})).toBe(false);
  });
});
