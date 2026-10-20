import { afterEach, describe, expect, it, vi } from "vitest";
import { sendSessionAttempt, sendSessionBeacon, sendSettingsBeacon } from "../unload-beacon";

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
  it("sendSessionAttempt tells a refusal from a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
    expect(await sendSessionAttempt({})).toBe("ok");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    expect(await sendSessionAttempt({})).toBe("refused");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await sendSessionAttempt({})).toBe("network");
  });
});

import { PENDING_SESSIONS_KEY, createSessionSender, createSettingsSender } from "../unload-beacon";

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
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("offline: nothing is sent and no try is spent, so every stretch is delivered once the connection is back", async () => {
    let offline = true;
    const got: string[] = [];
    const s = createSessionSender(async (p) => (got.push(String(p.startedAt)), "ok" as const), undefined, () => offline);
    for (const n of [1, 2, 3, 4, 5]) s.submit(stretch(n));
    await tick();
    expect(got).toEqual([]);
    expect(s.waiting()).toBe(5);
    offline = false;
    s.submit(); // what the 'online' listener calls
    await tick();
    expect(got).toEqual(["1", "2", "3", "4", "5"]);
    expect(s.waiting()).toBe(0);
  });

  it("a network failure while the browser thinks it is online keeps the stretch and is not counted as a try", async () => {
    let result: "network" | "ok" = "network";
    const got: string[] = [];
    const s = createSessionSender(async (p) => (got.push(String(p.startedAt)), result), undefined, () => false);
    s.submit(stretch(1));
    for (let i = 0; i < 6; i++) {
      await tick();
      s.submit();
    }
    await tick();
    expect(s.waiting()).toBe(1); // still kept after 7 failed attempts (the old behaviour gave up after 3)
    result = "ok";
    s.submit();
    await tick();
    expect(s.waiting()).toBe(0);
    expect(got.at(-1)).toBe("1");
  });

  it("server refusals still stop after 3 tries (positive control for the counting)", async () => {
    const send = vi.fn(async () => "refused" as const);
    const s = createSessionSender(send, undefined, () => false);
    s.submit(stretch(1));
    for (let i = 0; i < 6; i++) {
      await tick();
      s.submit();
    }
    await tick();
    expect(send).toHaveBeenCalledTimes(3);
    expect(s.waiting()).toBe(0);
  });

  it("the offline queue is bounded: only the newest 10 are kept", () => {
    const s = createSessionSender(async () => "ok" as const, undefined, () => true);
    for (let n = 1; n <= 15; n++) s.submit(stretch(n));
    expect(s.waiting()).toBe(10);
  });

  describe("persisted queue (closed tab)", () => {
    const memStore = () => {
      const m = new Map<string, string>();
      return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
    };

    it("stretches queued offline survive a closed tab: a new sender on the same storage drains them", async () => {
      const store = memStore();
      const a = createSessionSender(async () => "ok" as const, undefined, () => true, store);
      for (const n of [1, 2, 3]) a.submit(stretch(n));
      // tab closes here; `a` is gone
      const got: string[] = [];
      const b = createSessionSender(async (p) => (got.push(String(p.startedAt)), "ok" as const), undefined, () => false, store);
      expect(b.waiting()).toBe(3);
      b.submit(); // reader mount
      await tick();
      expect(got).toEqual(["1", "2", "3"]);
      expect(JSON.parse(store.m.get(PENDING_SESSIONS_KEY) ?? "[]")).toEqual([]);
    });

    it("positive control: without storage the same sequence loses the stretches", async () => {
      const a = createSessionSender(async () => "ok" as const, undefined, () => true);
      a.submit(stretch(1));
      const b = createSessionSender(async () => "ok" as const, undefined, () => false);
      expect(b.waiting()).toBe(0);
    });

    it("a stretch in the air stays stored until the server confirms it", async () => {
      const store = memStore();
      let release: (v: "ok") => void = () => {};
      const s = createSessionSender(() => new Promise<"ok">((r) => (release = r)), undefined, () => false, store);
      s.submit(stretch(1));
      expect(JSON.parse(store.m.get(PENDING_SESSIONS_KEY)!)).toHaveLength(1);
      release("ok");
      await tick();
      expect(JSON.parse(store.m.get(PENDING_SESSIONS_KEY)!)).toHaveLength(0);
    });

    it("refusal counts persist across a reload and a stretch is dropped after 3 in total", async () => {
      const store = memStore();
      const send = vi.fn(async () => "refused" as const);
      const a = createSessionSender(send, undefined, () => false, store);
      a.submit(stretch(1));
      await tick();
      const b = createSessionSender(send, undefined, () => false, store);
      b.submit();
      await tick();
      const c = createSessionSender(send, undefined, () => false, store);
      c.submit();
      await tick();
      expect(send).toHaveBeenCalledTimes(3);
      expect(JSON.parse(store.m.get(PENDING_SESSIONS_KEY)!)).toEqual([]);
    });

    it("ignores corrupt storage, caps what it loads at 10, and survives a throwing setItem", async () => {
      const bad = { getItem: () => "{not json", setItem: () => {} };
      expect(createSessionSender(async () => "ok" as const, undefined, () => true, bad).waiting()).toBe(0);
      const many = memStore();
      many.m.set(PENDING_SESSIONS_KEY, JSON.stringify(Array.from({ length: 14 }, (_, n) => ({ payload: stretch(n), tries: 0 }))));
      expect(createSessionSender(async () => "ok" as const, undefined, () => true, many).waiting()).toBe(10);
      const full = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
      const s = createSessionSender(async () => "ok" as const, undefined, () => true, full);
      expect(() => s.submit(stretch(1))).not.toThrow();
      expect(s.waiting()).toBe(1);
    });
  });
});
