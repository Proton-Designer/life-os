import { describe, expect, it } from "vitest";
import { DEFAULT_QURAN_REMINDER_END, DEFAULT_QURAN_REMINDER_START, quranReminderState } from "../quran-reminder";

describe("quranReminderState (default window 22:00 -> 01:00, crossing midnight)", () => {
  const s = (now: string) => quranReminderState(now, null, null);
  it("22:30 is inside, for today", () => expect(s("22:30")).toEqual({ forDate: "today" }));
  it("00:30 is inside, for YESTERDAY (the evening that started the window)", () => expect(s("00:30")).toEqual({ forDate: "yesterday" }));
  it("01:00 is outside (end exclusive); 00:59 is inside", () => {
    expect(s("01:00")).toBeNull();
    expect(s("00:59")).toEqual({ forDate: "yesterday" });
  });
  it("21:59 is outside; 22:00 is inside (start inclusive)", () => {
    expect(s("21:59")).toBeNull();
    expect(s("22:00")).toEqual({ forDate: "today" });
  });
  it("midnight itself is the post-midnight part", () => expect(s("00:00")).toEqual({ forDate: "yesterday" }));
  it("daytime is outside", () => expect(s("13:00")).toBeNull());
  it("the defaults are exposed as 22:00 / 01:00", () => {
    expect([DEFAULT_QURAN_REMINDER_START, DEFAULT_QURAN_REMINDER_END]).toEqual(["22:00", "01:00"]);
  });
});

describe("quranReminderState (custom windows)", () => {
  it("a non-crossing window (20:00-21:00) is always for today", () => {
    expect(quranReminderState("20:30", "20:00", "21:00")).toEqual({ forDate: "today" });
    expect(quranReminderState("21:00", "20:00", "21:00")).toBeNull();
    expect(quranReminderState("19:59", "20:00", "21:00")).toBeNull();
    expect(quranReminderState("00:30", "20:00", "21:00")).toBeNull(); // never "yesterday" without a midnight crossing
  });
  it("a crossing window with custom times", () => {
    expect(quranReminderState("23:15", "23:00", "02:00")).toEqual({ forDate: "today" });
    expect(quranReminderState("01:30", "23:00", "02:00")).toEqual({ forDate: "yesterday" });
    expect(quranReminderState("02:00", "23:00", "02:00")).toBeNull();
  });
  it("only one bound set: the other falls back to its default", () => {
    expect(quranReminderState("23:00", "21:00", null)).toEqual({ forDate: "today" });
    expect(quranReminderState("00:30", null, "02:00")).toEqual({ forDate: "yesterday" });
  });
  it("start == end shows nothing (settings refuse it); malformed input shows nothing", () => {
    expect(quranReminderState("22:30", "22:00", "22:00")).toBeNull();
    expect(quranReminderState("25:00", null, null)).toBeNull();
    expect(quranReminderState("22:30", "bad", null)).toBeNull();
  });
});
