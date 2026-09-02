import { describe, expect, it } from "vitest";
import { parseUtterance } from "../parse-utterance";
import { isoWeekdayFromDateString } from "../parse-utterance";

// 2026-08-26 is a Wednesday. Now = 14:30 local.
const CTX = { today: "2026-08-26", nowMinutesIntoDay: 14 * 60 + 30 };

// ---------------------------------------------------------------------------
// THE PORT HAZARD, TESTED FIRST BECAUSE IT IS MINE AND IT IS SILENT.
//
// The two codebases disagree on weekday numbering AND on how it is derived:
//   CollegeOS  isoWeekday()              -> 1 = Monday .. 7 = Sunday, via Zeller
//   LifeOS     dayOfWeekFromDateString() -> 0 = Sunday .. 6 = Saturday, via Date.UTC
//
// The grammar below is written against ISO 1..7. Dropping LifeOS's function into it
// unconverted shifts every weekday by one and puts "next tuesday" on a Monday --
// no error, no crash, just a task on the wrong day. So the conversion gets its own
// test, pinned at BOTH ends of the wrap (Sunday and Monday), because an off-by-one
// that is correct in the middle of the range is exactly the kind that ships.
// ---------------------------------------------------------------------------
describe("isoWeekdayFromDateString — the 0-based/1-based boundary", () => {
  it("maps Sunday to 7 and Monday to 1, the two values a naive port gets wrong", () => {
    expect(isoWeekdayFromDateString("2026-08-30")).toBe(7); // Sunday
    expect(isoWeekdayFromDateString("2026-08-31")).toBe(1); // Monday
  });

  it("agrees with the rest of the week", () => {
    expect(isoWeekdayFromDateString("2026-08-25")).toBe(2); // Tuesday
    expect(isoWeekdayFromDateString("2026-08-26")).toBe(3); // Wednesday
    expect(isoWeekdayFromDateString("2026-08-29")).toBe(6); // Saturday
  });

  it("survives a leap day, where date arithmetic usually breaks", () => {
    expect(isoWeekdayFromDateString("2024-02-29")).toBe(4); // Thursday
  });
});

describe("parseUtterance", () => {
  it("the headline case: 'remind me to submit my econ homework tomorrow at 6pm'", () => {
    const parsed = parseUtterance("remind me to submit my econ homework tomorrow at 6pm", CTX);
    expect(parsed.title).toBe("submit my econ homework");
    expect(parsed.date).toBe("2026-08-27");
    expect(parsed.time).toEqual({ hour: 18, minute: 0 });
    expect(parsed.matched).toEqual(["at 6pm", "tomorrow"]);
  });

  it("a bare weekday means the soonest FUTURE occurrence — today's own weekday is a week out", () => {
    expect(parseUtterance("email advisor on friday", CTX).date).toBe("2026-08-28");
    expect(parseUtterance("review notes wednesday", CTX).date).toBe("2026-09-02");
    expect(parseUtterance("call home next monday", CTX).date).toBe("2026-08-31");
  });

  // The negative that matters more than any positive. A capture parser that guesses
  // is worse than one that shrugs: a wrong silent time produces a task the user never
  // asked for, at an hour they never said, and they find out by missing it.
  it("an ambiguous 'at 6' stays UNPARSED — null beats a guess", () => {
    const parsed = parseUtterance("call the bank at 6", CTX);
    expect(parsed.time).toBeNull();
    expect(parsed.matched).not.toContain("at 6");
  });

  it("'tonight' fixes the date but NEVER invents an evening hour", () => {
    const parsed = parseUtterance("finish the deck tonight", CTX);
    expect(parsed.date).toBe("2026-08-26");
    expect(parsed.time).toBeNull();
  });

  it("'in two hours' computes from the local clock and can roll past midnight", () => {
    const parsed = parseUtterance("call mum in two hours", CTX);
    expect(parsed.date).toBe("2026-08-26");
    expect(parsed.time).toEqual({ hour: 16, minute: 30 });

    // 23:10 + 2h lands tomorrow. The rollover is arithmetic on injected values, not a
    // Date object, so it cannot pick up the host timezone on the way past midnight.
    const late = parseUtterance("call mum in two hours", { today: "2026-08-26", nowMinutesIntoDay: 23 * 60 + 10 });
    expect(late.date).toBe("2026-08-27");
    expect(late.time).toEqual({ hour: 1, minute: 10 });
  });

  it("a clock time with no date means the NEXT occurrence of that time", () => {
    // CTX is 14:30. 6pm is still ahead -> today; 9am has passed -> tomorrow.
    expect(parseUtterance("standup at 6pm", CTX).date).toBe("2026-08-26");
    expect(parseUtterance("standup at 9am", CTX).date).toBe("2026-08-27");
  });

  it("month-day and slash dates roll to next year when already past", () => {
    expect(parseUtterance("pay tuition on sep 3", CTX).date).toBe("2026-09-03");
    expect(parseUtterance("renew lease on 3/1", CTX).date).toBe("2027-03-01");
  });

  it("24-hour and noon/midnight forms parse", () => {
    expect(parseUtterance("lab at 18:00", CTX).time).toEqual({ hour: 18, minute: 0 });
    expect(parseUtterance("lunch at noon", CTX).time).toEqual({ hour: 12, minute: 0 });
    expect(parseUtterance("deploy at midnight", CTX).time).toEqual({ hour: 0, minute: 0 });
  });

  it("no temporal content at all: everything null, title intact", () => {
    const parsed = parseUtterance("buy milk", CTX);
    expect(parsed.title).toBe("buy milk");
    expect(parsed.date).toBeNull();
    expect(parsed.time).toBeNull();
    expect(parsed.matched).toEqual([]);
  });
});
