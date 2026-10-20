import { describe, expect, it } from "vitest";
import { createSessionTracker, FLUSH_AFTER_MS, IDLE_GAP_MS, MAX_READING_JUMP } from "../session-tracker";

function setup() {
  let t = 1_000_000;
  const tr = createSessionTracker(() => t);
  return { tr, tick: (ms: number) => (t += ms), at: () => t };
}

describe("session tracker", () => {
  it("counts forward steps and reports speed", () => {
    const s = setup();
    s.tr.advance(0, "rsvp");
    for (let i = 1; i <= 100; i++) {
      s.tick(200);
      s.tr.advance(i, "rsvp");
    }
    const [x] = s.tr.take();
    expect(x.wordsRead).toBe(100);
    expect(x.mode).toBe("rsvp");
    expect(x.avgWpm).toBe(300); // 100 words in 20 s
  });
  it("ignores going backwards and big jumps (navigation, not reading)", () => {
    const s = setup();
    s.tr.advance(500, "page");
    s.tick(1000);
    s.tr.advance(499, "page");
    s.tick(1000);
    s.tr.advance(499 + MAX_READING_JUMP + 1, "page");
    expect(s.tr.take()).toEqual([]);
  });
  it("a mode change closes the stretch", () => {
    const s = setup();
    s.tr.advance(0, "rsvp");
    s.tick(500);
    s.tr.advance(2, "rsvp");
    s.tick(500);
    s.tr.advance(3, "listen");
    s.tick(500);
    s.tr.advance(6, "listen");
    const out = s.tr.take();
    expect(out.map((o) => [o.mode, o.wordsRead])).toEqual([["rsvp", 2], ["listen", 4]]);
  });
  it("an idle gap closes the stretch and is not counted as reading time", () => {
    const s = setup();
    s.tr.advance(0, "page");
    s.tick(1000);
    s.tr.advance(30, "page");
    s.tick(IDLE_GAP_MS + 1);
    s.tr.advance(60, "page");
    s.tick(1000);
    s.tr.advance(90, "page");
    const out = s.tr.take();
    expect(out).toHaveLength(2);
    expect(out[0].wordsRead).toBe(30);
    expect(out[1].endedAt - out[1].startedAt).toBeLessThan(IDLE_GAP_MS);
  });
  it("take() resets: time paused is never counted and the first step after only re-anchors", () => {
    const s = setup();
    s.tr.advance(0, "rsvp");
    s.tick(300);
    s.tr.advance(1, "rsvp");
    expect(s.tr.take()).toHaveLength(1);
    expect(s.tr.take()).toEqual([]);
    s.tick(60_000);
    s.tr.advance(50, "rsvp"); // anchor only
    s.tick(300);
    s.tr.advance(51, "rsvp");
    expect(s.tr.take()[0].wordsRead).toBe(1);
  });
  it("due() turns true once the open stretch is a minute old", () => {
    const s = setup();
    s.tr.advance(0, "rsvp");
    s.tick(100);
    s.tr.advance(1, "rsvp");
    expect(s.tr.due()).toBe(false);
    s.tick(FLUSH_AFTER_MS);
    s.tr.advance(2, "rsvp");
    expect(s.tr.due()).toBe(true);
  });
});
