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

import { createSessionSender, createSettingsSender } from "../unload-beacon";

describe("createSettingsSender (last write wins)", () => {
  it("sends one at a time: the second patch waits for the first answer, newest value per key", async () => {
    const resolvers: ((ok: boolean) => void)[] = [];
    const sent: unknown[] = [];
    const s = createSettingsSender((p) => new Promise((r) => (sent.push(p), resolvers.push(r))));
    s.submit({ wpm: 300 });
    s.submit({ wpm: 350 });
    s.submit({ wpm: 400, theme: "dark" });
    expect(sent).toEqual([{ wpm: 300 }]); // positive control: nothing overtakes the first
    resolvers[0](true);
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([{ wpm: 300 }, { wpm: 400, theme: "dark" }]);
  });
  it("on unload one request carries everything unconfirmed plus the newest change", () => {
    const sent: unknown[] = [];
    const s = createSettingsSender((p) => (sent.push(p), new Promise(() => {})));
    s.submit({ wpm: 300 }); // in flight, never answered
    s.submit({ theme: "dark" }); // queued behind it
    s.submitNow({ wpm: 450 });
    expect(sent.at(-1)).toEqual({ wpm: 450, theme: "dark" });
  });
  it("a refused send is retried with the newer value kept", async () => {
    const sent: unknown[] = [];
    let ok = false;
    const s = createSettingsSender(async (p) => (sent.push(p), ok));
    s.submit({ wpm: 300 });
    s.submit({ wpm: 320 });
    await new Promise((r) => setTimeout(r, 0));
    ok = true;
    s.submit({ theme: "dark" });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.at(-1)).toEqual({ wpm: 320, theme: "dark" });
  });
});

describe("createSessionSender (retry a failed stretch)", () => {
  const stretch = (n: number) => ({ bookId: "b", startedAt: String(n) });
  it("keeps a stretch whose send failed and retries it on the next call, then stops after 3 tries", async () => {
    const sent: string[] = [];
    const s = createSessionSender(async (p) => (sent.push(String(p.startedAt)), false));
    s.submit(stretch(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(s.waiting()).toBe(1);
    s.submit();
    await new Promise((r) => setTimeout(r, 0));
    s.submit();
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual(["1", "1", "1"]);
    expect(s.waiting()).toBe(0); // given up
    s.submit();
    expect(sent).toHaveLength(3);
  });
  it("a stretch that went through is not kept or resent, and onStored fires", async () => {
    const stored = vi.fn();
    const send = vi.fn(async () => true);
    const s = createSessionSender(send, stored);
    s.submit(stretch(1));
    await new Promise((r) => setTimeout(r, 0));
    s.submit(stretch(2));
    expect(send).toHaveBeenCalledTimes(2);
    expect(s.waiting()).toBe(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(stored).toHaveBeenCalledTimes(2);
  });
});
