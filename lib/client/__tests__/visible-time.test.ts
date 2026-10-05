import { describe, expect, it, vi } from "vitest";
import { MAX_TICK_GAP_MS, accumulate, readVisibleMs, visibleTimeKey, writeVisibleMs } from "../visible-time";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("accumulate", () => {
  it("adds the gap only while the page is active (positive control: inactive adds nothing)", () => {
    expect(accumulate(1000, 0, 1000, true)).toBe(2000);
    expect(accumulate(1000, 0, 1000, false)).toBe(1000);
  });
  it("ignores a gap that is not believable (asleep / throttled) and a clock that went backwards", () => {
    expect(accumulate(0, 0, MAX_TICK_GAP_MS + 1, true)).toBe(0);
    expect(accumulate(0, 0, MAX_TICK_GAP_MS, true)).toBe(MAX_TICK_GAP_MS);
    expect(accumulate(500, 2000, 1000, true)).toBe(500);
  });
});

describe("storage", () => {
  it("round-trips per local date: a new day starts at zero", () => {
    const s = mem();
    writeVisibleMs(s, "2026-10-05", 90_000);
    expect(readVisibleMs(s, "2026-10-05")).toBe(90_000);
    expect(readVisibleMs(s, "2026-10-06")).toBe(0);
    expect(visibleTimeKey("2026-10-05")).not.toBe(visibleTimeKey("2026-10-06"));
  });
  it("never throws: blocked storage reads 0 and writes are dropped; garbage reads 0", () => {
    const blocked = { getItem: vi.fn(() => { throw new Error("denied"); }), setItem: vi.fn(() => { throw new Error("denied"); }) };
    expect(readVisibleMs(blocked, "d")).toBe(0);
    expect(() => writeVisibleMs(blocked, "d", 5)).not.toThrow();
    expect(readVisibleMs(null, "d")).toBe(0);
    const s = mem();
    s.setItem(visibleTimeKey("d"), "not-a-number");
    expect(readVisibleMs(s, "d")).toBe(0);
  });
});
