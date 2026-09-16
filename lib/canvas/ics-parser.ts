import { localDateString } from "@/lib/date-utils";

/**
 * P3-13 -- a minimal, hand-rolled RFC 5545 (iCalendar) VEVENT extractor for
 * Canvas's per-user ICS calendar feed. PURE, no I/O -- lib/canvas/client.ts
 * owns the SSRF-guarded fetch; this only ever sees already-downloaded text.
 *
 * Deliberately NOT a full RFC 5545 parser and NOT a new npm dependency:
 * this only needs four properties (UID, SUMMARY, DTSTART, URL) off of
 * VEVENT blocks, the same narrow-scope-over-general-library posture this
 * codebase already takes for its own bespoke parsers (e.g. the
 * deterministic voice-capture parser). VTIMEZONE/VALARM/RRULE and every
 * other iCalendar construct are ignored, not silently mishandled --
 * Canvas's own assignment-feed events are single, non-recurring VEVENTs.
 *
 * `canvasAssignmentId`/`canvasCourseId` are extracted from the event's URL
 * property -- deliberately NOT from UID, whose exact format Canvas does
 * not document or guarantee. An event whose URL doesn't match either shape
 * below (a course announcement, a plain calendar event, a quiz without a
 * direct assignment link) yields null IDs and is filtered out by the
 * caller (lib/canvas/ics-reconcile-core.ts) -- only assignments
 * participate in the staging/dedup pipeline at all.
 *
 * TWO URL SHAPES, CHECKED IN ORDER (CANVAS-GAP-08): the original code only
 * ever matched `/courses/<id>/assignments/<id>` -- Canvas's own
 * documented, stable path shape -- but a REAL per-user feed (sampled live,
 * 143/143 events) never emits that; it emits
 * `...?include_contexts=course_<id>...#assignment_<id>` instead (a query
 * param for the course, a URL FRAGMENT for the assignment). The documented
 * shape is checked first and kept working (a different Canvas instance or
 * version might genuinely emit it), falling back to the real-observed
 * shape. Both course AND assignment must match for either shape --
 * `#calendar_event_<id>` (a plain calendar entry, not an assignment) must
 * never yield a non-null canvasAssignmentId, matching the caller's own
 * `canvasAssignmentId !== null && canvasCourseId !== null` filter.
 */

export interface ParsedIcsEvent {
  uid: string | null;
  summary: string | null;
  /** Raw DTSTART value exactly as the feed wrote it, e.g. "20261005" (all-day) or "20261005T235900Z" (UTC instant). Null when the event had no DTSTART at all. */
  dtstart: string | null;
  url: string | null;
  /** Extracted from `url`; null when this event isn't a Canvas assignment. */
  canvasCourseId: string | null;
  canvasAssignmentId: string | null;
}

/** Canvas's documented, stable path shape -- checked first. */
const DOCUMENTED_ASSIGNMENT_URL_PATTERN = /\/courses\/(\d+)\/assignments\/(\d+)/;
/** The shape a real per-user feed actually emits (sampled live, CANVAS-GAP-08): the course id lives in the `include_contexts=course_<id>` query param, the assignment id in the `#assignment_<id>` URL fragment. `#calendar_event_<id>` is a real fragment shape Canvas also emits for non-assignment entries -- it deliberately does NOT match this pattern. */
const REAL_FEED_COURSE_PATTERN = /[?&]include_contexts=course_(\d+)/;
const REAL_FEED_ASSIGNMENT_FRAGMENT_PATTERN = /#assignment_(\d+)/;

/** Both course and assignment must resolve together, from the SAME shape -- a partial match (e.g. a course id with no assignment fragment) is not a usable Canvas assignment link. */
function extractCanvasIds(url: string | null): { canvasCourseId: string | null; canvasAssignmentId: string | null } {
  if (!url) return { canvasCourseId: null, canvasAssignmentId: null };

  const documented = url.match(DOCUMENTED_ASSIGNMENT_URL_PATTERN);
  if (documented) return { canvasCourseId: documented[1]!, canvasAssignmentId: documented[2]! };

  const course = url.match(REAL_FEED_COURSE_PATTERN);
  const assignment = url.match(REAL_FEED_ASSIGNMENT_FRAGMENT_PATTERN);
  if (course && assignment) return { canvasCourseId: course[1]!, canvasAssignmentId: assignment[1]! };

  return { canvasCourseId: null, canvasAssignmentId: null };
}

/** RFC 5545 line folding: a continuation line starts with a single space or tab, which is removed and the content appended to the previous line. */
function unfoldLines(icsText: string): string[] {
  const rawLines = icsText.split(/\r\n|\n|\r/);
  const unfolded: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

/** Reverses RFC 5545's TEXT value escaping (backslash-comma/semicolon/backslash, and \n for a literal newline). Applied to SUMMARY only -- UID/DTSTART/URL are not TEXT-typed values and are used as-is. */
function unescapeIcsText(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

/** A content line is `NAME[;PARAM=VALUE...]:VALUE` -- this only needs the bare property name (before any `;`) and the raw value (after the first `:`). */
function parseContentLine(line: string): { name: string; value: string } | null {
  const colonIndex = line.indexOf(":");
  if (colonIndex === -1) return null;
  const name = line.slice(0, colonIndex).split(";")[0]!.toUpperCase();
  const value = line.slice(colonIndex + 1);
  return { name, value };
}

export function parseCanvasIcsFeed(icsText: string): ParsedIcsEvent[] {
  const events: ParsedIcsEvent[] = [];
  let current: { uid: string | null; summary: string | null; dtstart: string | null; url: string | null } | null = null;

  for (const rawLine of unfoldLines(icsText)) {
    const line = rawLine.trim();
    if (line === "BEGIN:VEVENT") {
      current = { uid: null, summary: null, dtstart: null, url: null };
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) {
        const { canvasCourseId, canvasAssignmentId } = extractCanvasIds(current.url);
        events.push({
          uid: current.uid,
          summary: current.summary,
          dtstart: current.dtstart,
          url: current.url,
          canvasCourseId,
          canvasAssignmentId,
        });
      }
      current = null;
      continue;
    }
    if (!current) continue; // outside a VEVENT block (VCALENDAR/VTIMEZONE headers, etc.) -- not this parser's concern.

    const parsed = parseContentLine(line);
    if (!parsed) continue;
    switch (parsed.name) {
      case "UID":
        current.uid = unescapeIcsText(parsed.value);
        break;
      case "SUMMARY":
        current.summary = unescapeIcsText(parsed.value);
        break;
      case "DTSTART":
        current.dtstart = parsed.value;
        break;
      case "URL":
        current.url = parsed.value;
        break;
    }
  }

  return events;
}

/**
 * DTSTART -> "YYYY-MM-DD" in the user's own timezone, per the calendar-date
 * rule (never a raw `Date`-derived day). Two DTSTART shapes:
 *  - all-day (`VALUE=DATE`, e.g. "20261005"): the date parts ARE the date,
 *    with no time/timezone component to resolve at all -- returned
 *    directly, never round-tripped through a `Date`/timezone conversion
 *    (which could shift it a day in either direction for no reason).
 *  - a UTC instant ("20261005T235900Z", Canvas's actual shape for a due
 *    date with a time): converted via `localDateString`, the SAME
 *    UTC-instant-to-local-date conversion lib/canvas/sync-core.ts already
 *    uses for `assignment.dueAt`.
 * Returns null for anything that doesn't match either shape (malformed or
 * absent DTSTART) -- the caller treats that the same as no date at all.
 */
export function icsDateStrToLocalDateString(dtstart: string, timezone: string): string | null {
  const allDayMatch = dtstart.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (allDayMatch) {
    const [, y, mo, d] = allDayMatch;
    return `${y}-${mo}-${d}`;
  }
  const instantMatch = dtstart.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!instantMatch) return null;
  const [, y, mo, d, h, mi, s] = instantMatch;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  if (Number.isNaN(date.getTime())) return null;
  return localDateString(date, timezone);
}
