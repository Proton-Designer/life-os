import { addDaysToDateString, dayOfWeekFromDateString } from "@/lib/date-utils";

/**
 * Deterministic utterance parser — ported from CollegeOS's
 * `packages/core/src/capture/parseUtterance.ts` (College-app@8d77e73).
 *
 * Global capture is one tap; retrieval is effortful. This is the capture half, and it
 * is deliberately dumb: it CALCULATES, it never interprets. There is no model here, no
 * API call, no cost, and nothing that can be unavailable. What the grammar cannot parse
 * it leaves NULL for the confirm preview to ask about.
 *
 * THAT LAST RULE IS THE WHOLE DESIGN. A wrong silent time is worse than no time: it
 * produces a task at an hour the user never said, and they find out by missing it. A
 * null produces a question. So every ambiguity below resolves to null, never to a
 * plausible guess, and the tests assert the nulls at least as hard as the values.
 *
 * Documented simplifications, each chosen over silent guessing:
 * - A bare weekday and "next <weekday>" both mean the SOONEST future occurrence
 *   (today's own weekday means a week out). One rule, stated, never ambiguous output.
 * - "tonight" fixes the date to today and leaves the time null — the parser does not
 *   invent an evening hour the user never said.
 * - A bare "at 6" with no am/pm parses only when unambiguous (13–23 → 24h). "at 6"
 *   stays unparsed rather than guessed.
 *
 * TIMEZONE: this module never reads a clock. `today` and `nowMinutesIntoDay` are
 * resolved by the caller from the user's IANA zone (`localDateString`) and passed in,
 * so the parser cannot derive a day boundary from UTC — the bug class AGENTS.md records
 * hitting three times in one night.
 */

/**
 * ISO weekday (1 = Monday .. 7 = Sunday).
 *
 * THIS WRAPPER IS THE PORT'S ONE REAL HAZARD AND IT EXISTS TO BE TESTED.
 * The grammar below is written against ISO 1..7 (CollegeOS's `isoWeekday`, Zeller).
 * This repo's `dayOfWeekFromDateString` returns 0 = Sunday .. 6 = Saturday. Dropping
 * that in unconverted shifts every weekday by one and files "next tuesday" on a Monday
 * — no error, no crash, just a task on the wrong day. The conversion lives here, in one
 * place, and `parse-utterance.test.ts` pins it at BOTH ends of the wrap (Sunday and
 * Monday), because an off-by-one that is correct mid-week is the kind that ships.
 *
 * Not re-implementing Zeller: this repo's function builds from a Y/M/D triple in UTC
 * and reads `getUTCDay()`, so it never touches local time and is already safe. Two
 * implementations of one calendar fact is how they drift.
 */
export function isoWeekdayFromDateString(dateStr: string): number {
  return dayOfWeekFromDateString(dateStr) || 7; // 0 (Sunday) -> 7; 1..6 unchanged
}

export interface ParsedTime {
  hour: number;
  minute: number;
}

export interface ParsedUtterance {
  title: string;
  /** YYYY-MM-DD in the user's local calendar, or null when nothing resolved one. */
  date: string | null;
  time: ParsedTime | null;
  /** The temporal phrases consumed, so the preview can show WHY it chose the date. */
  matched: string[];
}

export interface ParseContext {
  /** The user's local today, resolved by the caller. Never derived here. */
  today: string;
  /** Local clock, for "in two hours" — minutes since local midnight. */
  nowMinutesIntoDay: number;
}

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  an: 1, a: 1, half: 0.5,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function parseUtterance(raw: string, ctx: ParseContext): ParsedUtterance {
  let text = raw.trim();
  const matched: string[] = [];
  let date: string | null = null;
  let time: ParsedTime | null = null;

  const consume = (match: RegExpMatchArray): void => {
    matched.push(match[0].trim());
    text = (text.slice(0, match.index!) + " " + text.slice(match.index! + match[0].length)).trim();
  };

  // Leading imperative frames carry no content.
  const lead = text.match(/^(please\s+)?(remind me to|remember to|note to self to|i need to)\s+/i);
  if (lead) text = text.slice(lead[0].length);

  // --- Relative offsets first: "in 20 minutes", "in two hours", "in 3 days". ---
  const rel = text.match(
    /\bin\s+(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|half)\s*(?:an?\s+)?(minutes?|mins?|hours?|hrs?|days?)\b/i,
  );
  if (rel) {
    const qty = NUMBER_WORDS[rel[1]!.toLowerCase()] ?? Number(rel[1]);
    const unit = rel[2]!.toLowerCase();
    if (Number.isFinite(qty)) {
      if (unit.startsWith("day")) {
        date = addDaysToDateString(ctx.today, Math.round(qty));
      } else {
        const deltaMinutes = unit.startsWith("h") ? Math.round(qty * 60) : Math.round(qty);
        const total = ctx.nowMinutesIntoDay + deltaMinutes;
        date = addDaysToDateString(ctx.today, Math.floor(total / 1440));
        const inDay = total % 1440;
        time = { hour: Math.floor(inDay / 60), minute: inDay % 60 };
      }
      consume(rel);
    }
  }

  // --- Clock times: "at 6pm", "6:30 pm", "at 18:00", noon, midnight. ---
  if (time == null) {
    const ampm = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    const h24 = text.match(/\bat\s+(\d{1,2}):(\d{2})\b/);
    const named = text.match(/\b(?:at\s+)?(noon|midnight)\b/i);
    if (ampm) {
      let hour = Number(ampm[1]) % 12;
      if (ampm[3]!.toLowerCase() === "pm") hour += 12;
      time = { hour, minute: ampm[2] != null ? Number(ampm[2]) : 0 };
      consume(ampm);
    } else if (h24 && Number(h24[1]) <= 23 && Number(h24[2]) <= 59) {
      time = { hour: Number(h24[1]), minute: Number(h24[2]) };
      consume(h24);
    } else if (named) {
      time = named[1]!.toLowerCase() === "noon" ? { hour: 12, minute: 0 } : { hour: 0, minute: 0 };
      consume(named);
    }
  }

  // --- Dates. ---
  if (date == null) {
    const dayAfter = text.match(/\bday after tomorrow\b/i);
    const tomorrow = text.match(/\b(?:by\s+|on\s+)?tomorrow\b/i);
    const todayish = text.match(/\b(?:by\s+)?(today|tonight)\b/i);
    const weekday = text.match(
      /\b(?:on\s+|next\s+|by\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    );
    const monthDay = text.match(
      /\b(?:on\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
    );
    const slashDate = text.match(/\b(?:on\s+)?(\d{1,2})\/(\d{1,2})\b/);

    if (dayAfter) {
      date = addDaysToDateString(ctx.today, 2);
      consume(dayAfter);
    } else if (tomorrow) {
      date = addDaysToDateString(ctx.today, 1);
      consume(tomorrow);
    } else if (todayish) {
      date = ctx.today;
      consume(todayish);
    } else if (weekday) {
      const target = WEEKDAYS.indexOf(weekday[1]!.toLowerCase()) + 1;
      const delta = ((target - isoWeekdayFromDateString(ctx.today) + 6) % 7) + 1; // 1..7, never 0
      date = addDaysToDateString(ctx.today, delta);
      consume(weekday);
    } else if (monthDay) {
      const month = MONTHS.indexOf(monthDay[1]!.slice(0, 3).toLowerCase()) + 1;
      const day = Number(monthDay[2]);
      if (month >= 1 && day >= 1 && day <= 31) {
        const year = Number(ctx.today.slice(0, 4));
        const candidate = `${year}-${pad(month)}-${pad(day)}`;
        date = candidate >= ctx.today ? candidate : `${year + 1}-${pad(month)}-${pad(day)}`;
        consume(monthDay);
      }
    } else if (slashDate) {
      const month = Number(slashDate[1]);
      const day = Number(slashDate[2]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const year = Number(ctx.today.slice(0, 4));
        const candidate = `${year}-${pad(month)}-${pad(day)}`;
        date = candidate >= ctx.today ? candidate : `${year + 1}-${pad(month)}-${pad(day)}`;
        consume(slashDate);
      }
    }
  }

  // A time with no date means the next occurrence of that clock time.
  if (time != null && date == null) {
    const timeMinutes = time.hour * 60 + time.minute;
    date = timeMinutes > ctx.nowMinutesIntoDay ? ctx.today : addDaysToDateString(ctx.today, 1);
  }

  const title = text
    .replace(/\s{2,}/g, " ")
    .replace(/[\s,;–-]+$/g, "")
    .replace(/^[\s,;–-]+/g, "")
    .trim();

  return { title, date, time, matched };
}
