import { describe, expect, it } from "vitest";
import { homeRhythmState } from "../rhythm-state";

const CHI = "America/Chicago";
const TOK = "Asia/Tokyo";
const chi = (l: string) => new Date(`${l}-05:00`);
const tok = (l: string) => new Date(`${l}+09:00`);
const s = (now: Date, tz: string, dayStarted: boolean, closed: boolean) =>
  homeRhythmState({ now, timezone: tz, dayStarted, closedEffectiveDay: closed });

describe("homeRhythmState", () => {
  it("morning before Start Day, today after it (daytime)", () => {
    expect(s(chi("2026-10-05T09:00:00"), CHI, false, false)).toBe("morning");
    expect(s(chi("2026-10-05T09:00:00"), CHI, true, false)).toBe("today");
  });

  it("20:59 is still today/morning, 21:00 flips to wind_down (both zones)", () => {
    expect(s(chi("2026-10-05T20:59:00"), CHI, true, false)).toBe("today");
    expect(s(chi("2026-10-05T21:00:00"), CHI, true, false)).toBe("wind_down");
    expect(s(tok("2026-10-05T20:59:00"), TOK, false, false)).toBe("morning");
    expect(s(tok("2026-10-05T21:00:00"), TOK, false, false)).toBe("wind_down");
  });

  it("a closed day shows done in the evening, but a close recorded for TODAY never hides the next morning", () => {
    expect(s(chi("2026-10-05T22:00:00"), CHI, true, true)).toBe("done");
    // next morning: effective day is Oct 6 and not closed -> morning (closed=false), never "done"
    expect(s(chi("2026-10-06T09:00:00"), CHI, false, false)).toBe("morning");
    // daytime with a (stale) close flag does NOT show done: done needs evening/night
    expect(s(chi("2026-10-05T10:00:00"), CHI, true, true)).toBe("today");
  });

  describe("the night owl (00:00-04:00): the day that just ended is still the one to close", () => {
    it("23:59 / 00:30 / 03:59 -> wind_down when not closed and Start Day not tapped; 04:00 -> morning", () => {
      expect(s(chi("2026-10-04T23:59:00"), CHI, false, false)).toBe("wind_down");
      expect(s(chi("2026-10-05T00:30:00"), CHI, false, false)).toBe("wind_down");
      expect(s(chi("2026-10-05T03:59:00"), CHI, false, false)).toBe("wind_down");
      expect(s(chi("2026-10-05T04:00:00"), CHI, false, false)).toBe("morning");
      expect(s(tok("2026-10-05T00:30:00"), TOK, false, false)).toBe("wind_down");
      expect(s(tok("2026-10-05T04:00:00"), TOK, false, false)).toBe("morning");
    });
    it("00:30 after closing Oct 4 is done (not Oct 5 'all day done')", () => {
      expect(s(chi("2026-10-05T00:30:00"), CHI, false, true)).toBe("done");
      expect(s(chi("2026-10-05T04:00:00"), CHI, false, false)).toBe("morning");
    });
    it("00:30 with Start Day already tapped for the new day and the old day unclosed -> today strip", () => {
      expect(s(chi("2026-10-05T00:30:00"), CHI, true, false)).toBe("today");
    });
  });

  it("positive control: the naive server-clock/plain-date version would call 00:30 'morning'", () => {
    // naive rule: hour >= 21 -> wind_down else morning/today. At 00:30 that says morning, yet a day was left unclosed.
    const naive = (hour: number, dayStarted: boolean) => (hour >= 21 ? "wind_down" : dayStarted ? "today" : "morning");
    expect(naive(0, false)).toBe("morning");
    expect(s(chi("2026-10-05T00:30:00"), CHI, false, false)).not.toBe(naive(0, false));
  });

  it("honours a custom wind-down time (Sleep plan, later)", () => {
    const at = chi("2026-10-05T21:15:00");
    expect(homeRhythmState({ now: at, timezone: CHI, dayStarted: true, closedEffectiveDay: false, windDownStart: "21:30" })).toBe("today");
    expect(homeRhythmState({ now: at, timezone: CHI, dayStarted: true, closedEffectiveDay: false, windDownStart: "21:00" })).toBe("wind_down");
  });
});
