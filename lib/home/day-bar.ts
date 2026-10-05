import type { DayRibbonLayout, RibbonActivityKind, RibbonActivityDetail, RibbonSpanState } from "@/lib/home/day-ribbon";
import { addDaysToDateString, localDateString, resolveLocalTime } from "@/lib/date-utils";

/**
 * The Day bar's model (HOME-02): one horizontal timeline from Start Day (wake) to bedtime, reusing the day
 * ribbon's block data. Pure: takes the ribbon layout (blocks as percentages of ITS range), re-projects them
 * onto the bar's own range (wake -> end of day), and derives the awake span, the focus share and the labels.
 */

/** What the popover shows for ANY indicator (class, work, workout, task, calendar event, focus block, prayer). */
export type DayBarPopover = {
  kindLabel: string;
  title: string;
  startAt: Date;
  endAt: Date | null;
  allDay?: boolean;
  location?: string | null;
  instructor?: string | null;
  description?: string | null;
  link?: string | null;
};

export type DayBarKind = RibbonActivityKind | "calendar";

/** A calendar event from an external source (Google Calendar, GCAL-01). Plain data, serialisable. */
export type DayBarCalendarEvent = {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date | null;
  allDay?: boolean;
  location?: string | null;
  description?: string | null;
  link?: string | null;
};

export type DayBarBlock = {
  label: string;
  colorVar: string;
  kind: DayBarKind;
  /** Percent of the bar, clipped into [0, 100]. */
  startPct: number;
  endPct: number;
  isFocus: boolean;
  startAt: Date;
  endAt: Date;
  detail?: RibbonActivityDetail;
  /** True when it lies after NOW (what's left of the day). */
  upcoming: boolean;
  /** Fixed events stack into lanes above the track (0 = nearest the track); focus blocks sit ON the track (lane 0 unused). */
  lane: number;
  /** Too narrow to carry a label: shown as a dot (the popover is still one tap away). */
  tiny: boolean;
  popover: DayBarPopover;
};

/** A prayer's window as a band behind everything; present only when the ribbon has prayer spans (Deen Mode ON). */
export type DayBarPrayer = {
  name: string;
  label: string;
  state: RibbonSpanState;
  midPct: number;
  startPct: number;
  endPct: number;
  windowStart: Date;
  windowEnd: Date;
  /** The window NOW falls in. */
  current: boolean;
};

export type DayBarTick = { pct: number; label: string | null; /** Local hour 0..23 (the phone view labels only every 6th). */ hour: number };

export type DayBar = {
  rangeStart: Date;
  rangeEnd: Date;
  nowPct: number;
  nowPosition: "before" | "within" | "after";
  /** Where the awake span starts (the Start Day marker), percent of the bar; 0 when the day began before the bar. */
  awakeStartPct: number;
  /** Where "Started h:mm" is pinned: the wake's percent, or null when there is no marker (not started yet / began before this day). */
  startedPct: number | null;
  /** The END of the shaded awake span (NOW), as percent of the bar; equals awakeStartPct before the wake. */
  awakePct: number;
  /** The efficiency share of the awake span, as percent of the BAR (0..awakePct). */
  focusSharePct: number;
  blocks: DayBarBlock[];
  /** How many stacked lanes the fixed events need (>= 1 when any exist, else 0). */
  laneCount: number;
  prayers: DayBarPrayer[];
  /** Hour tick marks along the bottom, a label on every third hour. */
  ticks: DayBarTick[];
};

/** Two clock labels ("Started 7:50 PM", "8:38 PM") closer than this (percent of the bar) would overlap: they merge into one. */
export const LABEL_COLLISION_PCT = 28;
export const labelsCollide = (aPct: number, bPct: number) => Math.abs(aPct - bPct) < LABEL_COLLISION_PCT;

/**
 * The text under a prayer-strip segment. Wide enough -> the full name; on a phone only the CURRENT window is
 * named (the others stay tappable, no stray initials); on a wide screen a segment too narrow for its full name
 * gets a 3-letter abbreviation when that fits, else nothing. `widthPct` is the segment's share of the bar.
 */
export function prayerStripLabel(args: { label: string; current: boolean; widthPct: number; narrow: boolean }): string | null {
  const { label, current, widthPct, narrow } = args;
  if (narrow) return current ? label : null;
  if (widthPct >= label.length * 1.0) return label;
  if (widthPct >= 3.5) return label.slice(0, 3);
  return current ? label : null;
}

const clampPct = (n: number) => Math.max(0, Math.min(100, n));

/**
 * DAYBAR-03: the bar ALWAYS covers the whole local calendar day containing `now`, 12 AM -> 12 AM, so the
 * hour scale never changes and an evening Start Day reads as "late in a whole day", not a 2-hour sliver.
 * Both edges are resolved in the zone (a DST day is 23 or 25 h long, never "+24 h").
 */
export function dayBarRange(now: Date, timezone: string): { start: Date; end: Date; date: string } {
  const date = localDateString(now, timezone);
  return { start: resolveLocalTime(date, "00:00", timezone), end: resolveLocalTime(addDaysToDateString(date, 1), "00:00", timezone), date };
}

/**
 * (HOME-02, no longer used for the range) The bar's end: the wind-down plan's bedtime ("HH:MM", local) when Sleep plan is on and a plan is set,
 * else the ribbon's own end of day. A bedtime that reads as earlier than the wake (e.g. 00:30) means the
 * NEXT calendar day; one earlier than wake by more than 12 h is also next-day. Never before wake + 1 h.
 */
export function dayBarEnd(args: { wake: Date; ribbonEnd: Date; bedtime: string | null; localDate: string; timezone: string }): Date {
  const { wake, ribbonEnd, bedtime, localDate, timezone } = args;
  let end = ribbonEnd;
  if (bedtime) {
    end = resolveLocalTime(localDate, bedtime, timezone);
    // A bedtime at/before the wake is the NEXT local day: resolve it on that date (never "+24 h", which is an
    // hour off across a DST change).
    for (let day = 1; end.getTime() <= wake.getTime() && day <= 2; day++) end = resolveLocalTime(addDaysToDateString(localDate, day), bedtime, timezone);
  }
  if (end.getTime() < wake.getTime() + 60 * 60 * 1000) end = new Date(wake.getTime() + 60 * 60 * 1000);
  return end;
}

const KIND_LABEL: Record<DayBarKind, string> = { class: "Class", work: "Work", fitness: "Workout", task: "Task", focus: "Focus", habit: "Habit", calendar: "Calendar" };
/** Narrower than this (percent of the bar) cannot carry a label: it becomes a dot. */
const TINY_PCT = 2.5;
/** Minimum visual footprint when deciding whether two fixed events collide into the same lane. */
const LANE_FOOTPRINT_PCT = 4;

function localHourMinute(d: Date, timezone: string): { h: number; m: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  return { h: Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24, m: Number(parts.find((p) => p.type === "minute")?.value ?? 0) };
}

/** Hour ticks along the bar; every third local hour carries a label ("9 AM"). Pure, DST-safe (each tick is read in the zone). */
export function hourTicks(rangeStart: Date, rangeEnd: Date, timezone: string): DayBarTick[] {
  const span = rangeEnd.getTime() - rangeStart.getTime();
  if (span <= 0) return [];
  const { m } = localHourMinute(rangeStart, timezone);
  let t = rangeStart.getTime() + (m === 0 ? 0 : (60 - m) * 60_000);
  const ticks: DayBarTick[] = [];
  const labelFmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric" });
  for (let i = 0; t <= rangeEnd.getTime() && i < 48; i++, t += 3_600_000) {
    const d = new Date(t);
    const { h } = localHourMinute(d, timezone);
    ticks.push({ pct: clampPct(((t - rangeStart.getTime()) / span) * 100), label: h % 3 === 0 ? labelFmt.format(d) : null, hour: h });
  }
  return ticks;
}

export function buildDayBar(args: {
  layout: DayRibbonLayout | null;
  /** Start Day: where the awake span begins. */
  wake: Date;
  /** The bar's start (the day's 12 AM); defaults to the wake. */
  rangeStart?: Date;
  end: Date;
  now: Date;
  /** Efficiency percent (0..100) or null when not computable. */
  efficiencyPercent: number | null;
  /** External calendar events (Google, GCAL-01); all-day ones are returned apart, not placed on the timeline. */
  calendarEvents?: readonly DayBarCalendarEvent[];
  /** For the hour scale; defaults to UTC. */
  timezone?: string;
}): DayBar & { allDay: DayBarPopover[] } {
  const { layout, wake, end, now, efficiencyPercent, calendarEvents = [], timezone = "UTC" } = args;
  const start = args.rangeStart ?? wake;
  const span = end.getTime() - start.getTime();
  const pct = (t: number) => clampPct(((t - start.getTime()) / span) * 100);
  const nowPct = pct(now.getTime());
  const nowPosition = now.getTime() < start.getTime() ? "before" : now.getTime() > end.getTime() ? "after" : "within";
  const awakeStartPct = pct(wake.getTime());
  const notStarted = now.getTime() < wake.getTime();
  const awakePct = notStarted ? awakeStartPct : nowPct;
  // Pinned only when Start Day happened inside this bar's day and has already happened.
  const startedPct = !notStarted && wake.getTime() >= start.getTime() && wake.getTime() <= end.getTime() ? awakeStartPct : null;
  const focusSharePct = efficiencyPercent === null ? 0 : ((awakePct - awakeStartPct) * Math.max(0, Math.min(100, efficiencyPercent))) / 100;

  const raw: Omit<DayBarBlock, "lane" | "tiny">[] = [];
  const prayers: DayBarPrayer[] = [];
  const overlaps = (s: number, e: number) => !(e <= start.getTime() && s < start.getTime()) && s < end.getTime();

  if (layout) {
    const rSpan = layout.rangeEnd.getTime() - layout.rangeStart.getTime();
    const at = (p: number) => layout.rangeStart.getTime() + (p / 100) * rSpan;
    for (const b of layout.blocks) {
      const s = at(b.startPct);
      const e = at(b.endPct);
      if (!overlaps(s, e)) continue;
      raw.push({
        label: b.label,
        colorVar: b.colorVar,
        kind: b.kind,
        startPct: pct(s),
        endPct: Math.max(pct(e), pct(s)),
        isFocus: b.kind === "focus",
        startAt: new Date(s),
        endAt: new Date(e),
        detail: b.detail,
        upcoming: s > now.getTime(),
        popover: {
          kindLabel: KIND_LABEL[b.kind],
          title: b.detail?.title ?? b.label,
          startAt: new Date(s),
          endAt: new Date(e),
          location: b.detail?.location ?? null,
          instructor: b.detail?.instructor ?? null,
        },
      });
    }
    for (const sp of layout.spans) {
      const ws = sp.windowStart.getTime();
      const we = sp.windowEnd.getTime();
      if (we <= start.getTime() || ws >= end.getTime()) continue; // the window does not touch the bar
      prayers.push({
        name: sp.name,
        label: sp.label,
        state: sp.state,
        midPct: pct((ws + we) / 2),
        startPct: pct(ws),
        endPct: pct(we),
        windowStart: sp.windowStart,
        windowEnd: sp.windowEnd,
        current: now.getTime() >= ws && now.getTime() < we,
      });
    }
  }

  const allDay: DayBarPopover[] = [];
  for (const ev of calendarEvents) {
    const popover: DayBarPopover = {
      kindLabel: KIND_LABEL.calendar,
      title: ev.title,
      startAt: ev.startAt,
      endAt: ev.endAt,
      allDay: ev.allDay,
      location: ev.location ?? null,
      description: ev.description ?? null,
      link: ev.link ?? null,
    };
    if (ev.allDay) {
      allDay.push(popover);
      continue;
    }
    const s = ev.startAt.getTime();
    const e = (ev.endAt ?? new Date(s + 30 * 60_000)).getTime();
    if (!overlaps(s, e)) continue;
    raw.push({
      label: ev.title,
      colorVar: "--accent-info",
      kind: "calendar",
      startPct: pct(s),
      endPct: Math.max(pct(e), pct(s)),
      isFocus: false,
      startAt: ev.startAt,
      endAt: new Date(e),
      upcoming: s > now.getTime(),
      popover,
    });
  }

  // Stack the FIXED events (everything but focus) into lanes by start time: a block takes the first lane
  // whose last block (at least LANE_FOOTPRINT_PCT wide for the test) has ended; focus blocks sit on the track.
  raw.sort((x, y) => x.startAt.getTime() - y.startAt.getTime());
  const laneEnds: number[] = [];
  const blocks: DayBarBlock[] = raw.map((b) => {
    const width = b.endPct - b.startPct;
    const tiny = width < TINY_PCT;
    if (b.isFocus) return { ...b, lane: 0, tiny };
    const footprintEnd = b.startPct + Math.max(width, LANE_FOOTPRINT_PCT);
    let lane = laneEnds.findIndex((e) => e <= b.startPct);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(footprintEnd);
    } else laneEnds[lane] = footprintEnd;
    return { ...b, lane, tiny };
  });

  return {
    rangeStart: start,
    rangeEnd: end,
    nowPct,
    nowPosition,
    awakeStartPct,
    startedPct,
    awakePct,
    focusSharePct,
    blocks,
    laneCount: laneEnds.length,
    prayers,
    ticks: hourTicks(start, end, timezone),
    allDay,
  };
}

/** "5:45" for a whole-minute duration (the bar's "Awake for" label). */
export function formatAwake(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds / 60));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "2:30 to go" while under target; null once the target is met. */
export function toGoLabel(hoursTodayMinutes: number, targetMinutes: number, fmt: (m: number) => string): string | null {
  const left = targetMinutes - Math.floor(hoursTodayMinutes);
  return left > 0 ? `${fmt(left)} to go` : null;
}
