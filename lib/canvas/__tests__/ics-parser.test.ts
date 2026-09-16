import { describe, expect, it } from "vitest";
import { parseCanvasIcsFeed, icsDateStrToLocalDateString } from "../ics-parser";

const SAMPLE_FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Canvas LMS//NONSGML Calendar//EN",
  "BEGIN:VEVENT",
  "UID:event-assignment-42-abc123@canvas.instructure.com",
  "DTSTAMP:20260901T000000Z",
  "DTSTART:20261005T235900Z",
  "SUMMARY:Essay 2 [CS 101]",
  "URL:https://canvas.example.edu/courses/10/assignments/42",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:event-calendar-99@canvas.instructure.com",
  "DTSTART;VALUE=DATE:20261010",
  "SUMMARY:Guest lecture",
  "URL:https://canvas.example.edu/courses/10/calendar_events/99",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseCanvasIcsFeed (P3-13)", () => {
  it("extracts UID/SUMMARY/DTSTART/URL from a VEVENT", () => {
    const events = parseCanvasIcsFeed(SAMPLE_FEED);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      uid: "event-assignment-42-abc123@canvas.instructure.com",
      summary: "Essay 2 [CS 101]",
      dtstart: "20261005T235900Z",
      url: "https://canvas.example.edu/courses/10/assignments/42",
      canvasCourseId: "10",
      canvasAssignmentId: "42",
    });
  });

  it("extracts canvasCourseId/canvasAssignmentId from the URL, not the UID", () => {
    const events = parseCanvasIcsFeed(SAMPLE_FEED);
    // The second event's UID contains no assignment shape, and its URL is a
    // calendar_events link, not an assignments one -- correctly null.
    expect(events[1]!.canvasCourseId).toBeNull();
    expect(events[1]!.canvasAssignmentId).toBeNull();
  });

  it("handles a params-bearing property (DTSTART;VALUE=DATE:...) by reading only the value after the colon", () => {
    const events = parseCanvasIcsFeed(SAMPLE_FEED);
    expect(events[1]!.dtstart).toBe("20261010");
  });

  it("unfolds an RFC 5545 folded continuation line (leading space)", () => {
    const folded = ["BEGIN:VEVENT", "SUMMARY:A very long assignment title that Canvas", "  folded across two physical lines", "URL:https://canvas.example.edu/courses/1/assignments/2", "END:VEVENT"].join("\r\n");
    const events = parseCanvasIcsFeed(folded);
    expect(events[0]!.summary).toBe("A very long assignment title that Canvas folded across two physical lines");
  });

  it("unescapes RFC 5545 TEXT escaping in SUMMARY (\\, \\; \\\\ \\n)", () => {
    const escaped = ["BEGIN:VEVENT", "SUMMARY:Quiz\\, Chapter 3\\; due soon\\nBring a calculator", "END:VEVENT"].join("\r\n");
    const events = parseCanvasIcsFeed(escaped);
    expect(events[0]!.summary).toBe("Quiz, Chapter 3; due soon\nBring a calculator");
  });

  it("ignores content outside a VEVENT block (VCALENDAR/PRODID/VERSION)", () => {
    const events = parseCanvasIcsFeed(SAMPLE_FEED);
    expect(events.every((e) => e.uid !== "VERSION" && e.uid !== "PRODID")).toBe(true);
  });

  it("returns an empty array for text with no VEVENT blocks", () => {
    expect(parseCanvasIcsFeed("BEGIN:VCALENDAR\r\nEND:VCALENDAR")).toEqual([]);
  });

  it("a malformed/unterminated VEVENT (no END:VEVENT) contributes nothing rather than throwing", () => {
    const malformed = ["BEGIN:VEVENT", "SUMMARY:Never closed", "BEGIN:VCALENDAR"].join("\r\n");
    expect(() => parseCanvasIcsFeed(malformed)).not.toThrow();
    expect(parseCanvasIcsFeed(malformed)).toEqual([]);
  });
});

describe("icsDateStrToLocalDateString (P3-13)", () => {
  it("an all-day DTSTART (YYYYMMDD) maps directly, with no timezone conversion", () => {
    expect(icsDateStrToLocalDateString("20261010", "America/Chicago")).toBe("2026-10-10");
    expect(icsDateStrToLocalDateString("20261010", "Asia/Tokyo")).toBe("2026-10-10");
  });

  it("a UTC-instant DTSTART converts through the user's own timezone (same rule as sync-core.ts's dueAt handling)", () => {
    // 23:59 UTC on 2026-10-05 is already 2026-10-06 in a timezone ahead of UTC.
    expect(icsDateStrToLocalDateString("20261005T235900Z", "Asia/Tokyo")).toBe("2026-10-06");
    expect(icsDateStrToLocalDateString("20261005T235900Z", "America/Chicago")).toBe("2026-10-05");
  });

  it("returns null for a malformed DTSTART", () => {
    expect(icsDateStrToLocalDateString("not-a-date", "UTC")).toBeNull();
    expect(icsDateStrToLocalDateString("2026-10-05", "UTC")).toBeNull();
  });
});
