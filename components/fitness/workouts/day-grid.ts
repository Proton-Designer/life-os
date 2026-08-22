/**
 * Pure clock-axis math for the hourly My Workouts calendar. Deliberately NOT
 * lib/home/day-ribbon.ts's pctOf: that function is private, barred (Ayman is
 * actively editing that file), and its range is prayer-window-relative
 * (Fajr's window start to Isha's window end) — this axis is a fixed clock,
 * and the input is "HH:MM" strings, not Date instants. Forking five lines
 * of clamped linear interpolation costs nothing; reaching into a barred
 * file for a different domain's semantics would have been the worse call.
 * (Opus Lead, 2026-08-22.)
 *
 * Axis: a fixed 05:00-23:00 window by default (a full 00:00-24:00 axis
 * wastes most of its height on hours nobody trains in), expanding only when
 * an actual session falls outside it — a reflow-to-fit axis would resize
 * every time a session is added, which is worse for a calendar meant to be
 * a stable reference.
 */

import type { WeekPreview } from "@/lib/fitness/plan-types";

export const DEFAULT_AXIS_START_MIN = 5 * 60; // 05:00
export const DEFAULT_AXIS_END_MIN = 23 * 60; // 23:00

export type TimedSession = {
  id: string;
  name: string;
  startMinutes: number; // 0-1439, minutes since midnight
  durationMinutes: number;
};

/**
 * Combines the active micro plan's and active routine plan's WeekPreviews
 * (My Workouts row 5 defaults to the active plan(s), plural — both slots
 * can be active at once). Plain per-day array concatenation: WeekPreview's
 * own consumers (WeekPreviewCalendar, HourlyWeekCalendar) already sort
 * micro-before-session within a day regardless of input order, so this
 * doesn't need to reorder anything itself.
 */
export function mergeWeekPreviews(...previews: WeekPreview[]): WeekPreview {
  const merged: WeekPreview = {};
  for (let d = 0; d <= 6; d++) {
    merged[d] = previews.flatMap((p) => p[d] ?? []);
  }
  return merged;
}

export type SessionLayoutItem = {
  session: TimedSession;
  columnIndex: number;
  columnCount: number;
};

/** "HH:MM" (24h, local) -> minutes since midnight. Throws on malformed input rather than silently misplacing a block. */
export function minutesFromMidnight(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) throw new Error(`Invalid HH:MM time: "${hhmm}"`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) throw new Error(`Invalid HH:MM time: "${hhmm}"`);
  return hours * 60 + minutes;
}

export function computeAxis(sessions: TimedSession[]): { startMin: number; endMin: number } {
  let startMin = DEFAULT_AXIS_START_MIN;
  let endMin = DEFAULT_AXIS_END_MIN;
  for (const s of sessions) {
    if (s.startMinutes < startMin) startMin = s.startMinutes;
    const end = s.startMinutes + s.durationMinutes;
    if (end > endMin) endMin = end;
  }
  return { startMin, endMin };
}

export function positionPct(minutes: number, axisStartMin: number, axisEndMin: number): number {
  const span = axisEndMin - axisStartMin;
  if (span <= 0) return 0;
  const t = (minutes - axisStartMin) / span;
  return Math.max(0, Math.min(100, t * 100));
}

/**
 * Column assignment for sessions that overlap in time on the same day — a
 * real state a user can create with no answer in the original spec. Ruling
 * (Opus Lead, 2026-08-22): side-by-side columns, not stacked-with-an-
 * indicator — a calendar that lets one block silently sit over another
 * reads as "only one thing is happening," the wrong information for a
 * schedule meant to be trusted. Columns are assigned per overlap CLUSTER,
 * not globally across the day, so an unrelated evening session doesn't get
 * squeezed just because two morning sessions collided.
 */
export function layoutDaySessions(sessions: TimedSession[]): SessionLayoutItem[] {
  const sorted = [...sessions].sort((a, b) => a.startMinutes - b.startMinutes);
  const layouts: SessionLayoutItem[] = [];

  let i = 0;
  while (i < sorted.length) {
    let clusterEnd = i;
    let maxEndSoFar = sorted[i].startMinutes + sorted[i].durationMinutes;
    while (clusterEnd + 1 < sorted.length && sorted[clusterEnd + 1].startMinutes < maxEndSoFar) {
      clusterEnd += 1;
      maxEndSoFar = Math.max(maxEndSoFar, sorted[clusterEnd].startMinutes + sorted[clusterEnd].durationMinutes);
    }

    const cluster = sorted.slice(i, clusterEnd + 1);
    const columnEnds: number[] = [];
    const clusterLayouts: SessionLayoutItem[] = [];
    for (const session of cluster) {
      let column = columnEnds.findIndex((end) => end <= session.startMinutes);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(session.startMinutes + session.durationMinutes);
      } else {
        columnEnds[column] = session.startMinutes + session.durationMinutes;
      }
      clusterLayouts.push({ session, columnIndex: column, columnCount: 0 });
    }
    const columnCount = columnEnds.length;
    for (const layout of clusterLayouts) layout.columnCount = columnCount;
    layouts.push(...clusterLayouts);

    i = clusterEnd + 1;
  }

  return layouts;
}
