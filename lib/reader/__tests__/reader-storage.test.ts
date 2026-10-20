import { describe, expect, it, vi } from "vitest";
import {
  createPositionSaver,
  loadMode,
  loadPosition,
  loadSettings,
  pickNewestPosition,
  sanitizeSettings,
  saveMode,
  savePosition,
  saveSettings,
  type ReaderStorage,
} from "../reader-storage";
import { DEFAULT_READER_SETTINGS } from "../types";

function memoryStorage(initial: Record<string, string> = {}): ReaderStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe("position storage", () => {
  it("round-trips and keys by book", () => {
    const s = memoryStorage();
    savePosition(s, "a", { index: 42, updatedAt: 1000 });
    expect(loadPosition(s, "a")).toEqual({ index: 42, updatedAt: 1000 });
    expect(loadPosition(s, "b")).toBeNull();
  });
  it("rejects corrupt values instead of throwing", () => {
    expect(loadPosition(memoryStorage({ "lifeos.reader.position.a": "{nope" }), "a")).toBeNull();
    expect(loadPosition(memoryStorage({ "lifeos.reader.position.a": JSON.stringify({ index: -3 }) }), "a")).toBeNull();
    expect(loadPosition(memoryStorage({ "lifeos.reader.position.a": JSON.stringify({ index: 1.5 }) }), "a")).toBeNull();
  });
  it("survives a missing or throwing storage", () => {
    expect(loadPosition(null, "a")).toBeNull();
    expect(() => savePosition(null, "a", { index: 1, updatedAt: 1 })).not.toThrow();
    const full: ReaderStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(loadPosition(full, "a")).toBeNull();
    expect(() => savePosition(full, "a", { index: 1, updatedAt: 1 })).not.toThrow();
  });
  it("newest client timestamp wins", () => {
    const a = { index: 10, updatedAt: 100 };
    const b = { index: 99, updatedAt: 200 };
    expect(pickNewestPosition(a, b)).toBe(b);
    expect(pickNewestPosition(b, a)).toBe(b);
    expect(pickNewestPosition(a, { index: 5, updatedAt: 100 })).toBe(a);
    expect(pickNewestPosition(null, b)).toBe(b);
    expect(pickNewestPosition(a, null)).toBe(a);
    expect(pickNewestPosition(null, null)).toBeNull();
  });
});

describe("settings storage", () => {
  it("defaults when empty and round-trips", () => {
    const s = memoryStorage();
    expect(loadSettings(s)).toEqual(DEFAULT_READER_SETTINGS);
    saveSettings(s, { ...DEFAULT_READER_SETTINGS, wpm: 450, theme: "sepia", focalLines: false });
    expect(loadSettings(s)).toMatchObject({ wpm: 450, theme: "sepia", focalLines: false });
  });
  it("clamps and repairs bad values", () => {
    expect(
      sanitizeSettings({ wpm: 5000, fontScale: 9, theme: "neon", speechRate: 0, focalLines: "yes", dailyWordGoal: -4, voiceUri: "" })
    ).toEqual({ ...DEFAULT_READER_SETTINGS, wpm: 1000, fontScale: 2, speechRate: 0.5 });
    expect(sanitizeSettings(null)).toEqual(DEFAULT_READER_SETTINGS);
    expect(sanitizeSettings({ dailyWordGoal: 500, voiceUri: "x" })).toMatchObject({ dailyWordGoal: 500, voiceUri: "x" });
  });
  it("mode", () => {
    const s = memoryStorage();
    expect(loadMode(s, "a")).toBeNull();
    saveMode(s, "a", "page");
    expect(loadMode(s, "a")).toBe("page");
  });
});

describe("createPositionSaver", () => {
  function harness(interval = 500) {
    let t = 0;
    const timers: { fn: () => void; at: number; id: number }[] = [];
    let nextId = 1;
    const storage = memoryStorage();
    const writes: number[] = [];
    const saver = createPositionSaver({
      storage,
      bookId: "b",
      intervalMs: interval,
      now: () => t,
      setTimer: (fn, ms) => {
        const id = nextId++;
        timers.push({ fn, at: t + ms, id });
        return id;
      },
      clearTimer: (h) => {
        const i = timers.findIndex((x) => x.id === h);
        if (i >= 0) timers.splice(i, 1);
      },
      onWrite: (p) => writes.push(p.index),
    });
    return {
      saver,
      storage,
      writes,
      advance(ms: number) {
        t += ms;
        for (const x of [...timers]) if (x.at <= t) {
          timers.splice(timers.indexOf(x), 1);
          x.fn();
        }
      },
      stored: () => loadPosition(storage, "b"),
    };
  }

  it("writes the first push at once, then at most once per interval with the latest value", () => {
    const h = harness();
    h.saver.push(1);
    expect(h.writes).toEqual([1]);
    h.saver.push(2);
    h.saver.push(3);
    expect(h.writes).toEqual([1]);
    h.advance(499);
    expect(h.writes).toEqual([1]);
    h.advance(1);
    expect(h.writes).toEqual([1, 3]);
    expect(h.stored()?.index).toBe(3);
  });
  it("flush writes the pending position immediately and clears the timer", () => {
    const h = harness();
    h.saver.push(1);
    h.saver.push(7);
    h.saver.flush();
    expect(h.writes).toEqual([1, 7]);
    h.advance(1000);
    expect(h.writes).toEqual([1, 7]);
  });
  it("flush with nothing pending is a no-op; cancel drops the pending write", () => {
    const h = harness();
    h.saver.flush();
    expect(h.writes).toEqual([]);
    h.saver.push(1);
    h.saver.push(2);
    h.saver.cancel();
    h.advance(1000);
    expect(h.writes).toEqual([1]);
  });
  it("uses the real clock by default without throwing", () => {
    vi.useFakeTimers();
    const s = memoryStorage();
    const saver = createPositionSaver({ storage: s, bookId: "x" });
    saver.push(5);
    expect(loadPosition(s, "x")?.index).toBe(5);
    vi.useRealTimers();
  });
});
