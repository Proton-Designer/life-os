import { describe, expect, it } from "vitest";
import { createSessionTracker, FLUSH_AFTER_MS, IDLE_GAP_MS, MAX_CREDIT_WPM, MAX_READING_JUMP } from "../session-tracker";

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
    s.tick(5000);
    s.tr.advance(30, "page");
    s.tick(IDLE_GAP_MS + 1);
    s.tr.advance(60, "page");
    s.tick(5000);
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
  describe("accuracy (R7-F1)", () => {
    it("a one-second scrub of 1000 words in 100-word steps credits nothing", () => {
      const s = setup();
      s.tr.advance(0, "page");
      for (let i = 1; i <= 10; i++) {
        s.tick(100);
        s.tr.advance(i * 100, "page");
      }
      expect(s.tr.take()).toEqual([]);
    });
    it("50 Left/Right cycles credit at most the one new word", () => {
      const s = setup();
      s.tr.advance(10, "rsvp");
      for (let i = 0; i < 50; i++) {
        s.tick(150);
        s.tr.advance(11, "rsvp");
        s.tick(150);
        s.tr.advance(10, "rsvp");
      }
      const words = s.tr.take().reduce((n, x) => n + x.wordsRead, 0);
      expect(words).toBeLessThanOrEqual(1);
    });
    it("re-reading after Back does not count the same words twice", () => {
      const s = setup();
      s.tr.advance(0, "rsvp");
      for (let i = 1; i <= 40; i++) {
        s.tick(200);
        s.tr.advance(i, "rsvp");
      }
      for (let i = 39; i >= 20; i--) {
        s.tick(200);
        s.tr.advance(i, "rsvp");
      }
      for (let i = 21; i <= 50; i++) {
        s.tick(200);
        s.tr.advance(i, "rsvp");
      }
      expect(s.tr.take().reduce((n, x) => n + x.wordsRead, 0)).toBe(50);
    });
    it("holding a key faster than anyone reads is capped by the stretch budget", () => {
      const s = setup();
      s.tr.advance(0, "rsvp");
      for (let i = 1; i <= 300; i++) {
        s.tick(20); // 3000 wpm
        s.tr.advance(i, "rsvp");
      }
      const [x] = s.tr.take();
      const seconds = 300 * 0.02;
      expect(x.wordsRead).toBeLessThanOrEqual(3 + (seconds * MAX_CREDIT_WPM) / 60);
    });
    it("normal play at 900 wpm still counts every word", () => {
      const s = setup();
      s.tr.advance(0, "rsvp");
      for (let i = 1; i <= 90; i++) {
        s.tick(Math.round(60000 / 900));
        s.tr.advance(i, "rsvp");
      }
      expect(s.tr.take()[0].wordsRead).toBe(90);
    });
    it("scrubbing ahead and then reading back from the earlier point credits those words (a high-water mark would not)", () => {
      const s = setup();
      s.tr.advance(100, "page");
      s.tick(100);
      s.tr.advance(220, "page"); // implausible scrub, credits nothing and marks nothing as read
      s.tick(100);
      s.tr.advance(100, "page"); // back to where the person was
      for (let i = 101; i <= 150; i++) {
        s.tick(300);
        s.tr.advance(i, "page");
      }
      expect(s.tr.take()[0].wordsRead).toBe(50);
    });
    it("the credited ranges survive take(): pause, jump back, read on credits only new ground", () => {
      const s = setup();
      s.tr.advance(0, "page");
      for (let i = 1; i <= 20; i++) {
        s.tick(300);
        s.tr.advance(i, "page");
      }
      s.tr.take();
      s.tr.advance(5, "page"); // anchor after a pause, behind the furthest point
      for (let i = 6; i <= 25; i++) {
        s.tick(300);
        s.tr.advance(i, "page");
      }
      expect(s.tr.take()[0].wordsRead).toBe(5); // only 21..25 are new
    });
  });
});
