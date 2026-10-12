import { resolveLocalTime } from "@/lib/date-utils";
import { DOMAIN_KEYS, STEP, type DomainKey } from "./allocation";
import type { TimeRange, WakeSleepBounds } from "./schedule";

/**
 * Untracked time -- pure, no React, no I/O.
 *
 * The evening close asks about the stretches of the day nothing accounts for: waking hours minus Deep sessions, prayers,
 * the workout, and any check-in already answered. Everything here only works out WHICH stretches to ask about and whether
 * an answer is allowed; the saving is lib/checkins/gaps-core.ts (an answer is stored as an ordinary allocation check-in
 * whose window is the stretch, so Signal:Noise, the focus map and the KPIs read it with no change).
 */

/** A stretch shorter than this isn't worth asking about: nobody remembers ten minutes. */
export const MIN_GAP_MINUTES = 30;
/** Answers are whole allocation steps (checkin_allocations.minutes is a multiple of 15). */
export const GAP_STEP_MINUTES = STEP;

const MINUTE_MS = 60_000;

export type Gap = { start: Date; end: Date; minutes: number };

/** What a stretch can be answered with: a focus area, or one of three catch-alls. */
export type GapChoice = DomainKey | "wasted" | "rest" | "errands";

export function isGapChoice(value: unknown): value is GapChoice {
  return typeof value === "string" && ([...DOMAIN_KEYS, "wasted", "rest", "errands"] as string[]).includes(value);
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * The stretches of `dateStr`'s waking hours (wake -> sleep, never past `now`) that no `covered` range touches, each at
 * least `minMinutes` long, trimmed to whole minutes. An open-ended range (a session still running) covers up to `now`.
 */
export function computeUntrackedGaps(opts: {
  dateStr: string;
  bounds: WakeSleepBounds;
  timezone: string;
  covered: readonly TimeRange[];
  now: Date;
  minMinutes?: number;
}): Gap[] {
  const { dateStr, bounds, timezone, covered, now, minMinutes = MIN_GAP_MINUTES } = opts;
  if (toMinutes(bounds.sleepTime) <= toMinutes(bounds.wakeTime)) return [];
  const dayStart = resolveLocalTime(dateStr, bounds.wakeTime.slice(0, 5), timezone).getTime();
  const dayEnd = Math.min(resolveLocalTime(dateStr, bounds.sleepTime.slice(0, 5), timezone).getTime(), now.getTime());
  if (dayEnd <= dayStart) return [];

  const spans = covered
    .map((r) => ({ start: r.start.getTime(), end: (r.end ?? now).getTime() }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);

  const out: Gap[] = [];
  let cursor = dayStart;
  const push = (from: number, to: number) => {
    const start = Math.ceil(from / MINUTE_MS) * MINUTE_MS;
    const end = Math.floor(to / MINUTE_MS) * MINUTE_MS;
    const minutes = Math.round((end - start) / MINUTE_MS);
    if (minutes >= minMinutes) out.push({ start: new Date(start), end: new Date(end), minutes });
  };
  for (const span of spans) {
    if (span.start > cursor) push(cursor, Math.min(span.start, dayEnd));
    cursor = Math.max(cursor, span.end);
    if (cursor >= dayEnd) break;
  }
  if (cursor < dayEnd) push(cursor, dayEnd);
  return out;
}

/** Whole 15-minute steps a stretch holds, in minutes (what an answer is credited): 100 -> 90, 14 -> 0. */
export function creditedMinutes(minutes: number): number {
  return Math.floor(minutes / GAP_STEP_MINUTES) * GAP_STEP_MINUTES;
}

/** The allocation a choice becomes for a stretch of `minutes`: a focus area gets the credited minutes, Wasted counts as wasted, rest/errands hold none. */
export function allocationForChoice(choice: GapChoice, minutes: number): { allocation: Record<string, number>; wastedMinutes: number } {
  const credited = creditedMinutes(minutes);
  if (choice === "wasted") return { allocation: {}, wastedMinutes: credited };
  if (choice === "rest" || choice === "errands") return { allocation: {}, wastedMinutes: 0 };
  return { allocation: { [choice]: credited }, wastedMinutes: 0 };
}

export type GapAnswer = { start: string; end: string; choice: GapChoice };
export type ValidatedGapAnswer = { start: Date; end: Date; choice: GapChoice; minutes: number };

/**
 * Checks answers against the stretches the server itself worked out: each must sit inside one of them, be a real span of at
 * least one step, and not overlap another answer. Returns them sorted, or the reason one was refused.
 */
export function validateGapAnswers(
  gaps: readonly Gap[],
  answers: readonly GapAnswer[],
  opts: { allowFaith: boolean },
): { ok: true; answers: ValidatedGapAnswer[] } | { ok: false; message: string } {
  const parsed: ValidatedGapAnswer[] = [];
  for (const a of answers) {
    if (!isGapChoice(a.choice)) return { ok: false, message: "Pick one of the options for each stretch." };
    if (a.choice === "deen" && !opts.allowFaith) return { ok: false, message: "Faith isn't turned on." };
    const start = new Date(a.start);
    const end = new Date(a.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { ok: false, message: "That time isn't valid." };
    const minutes = Math.round((end.getTime() - start.getTime()) / MINUTE_MS);
    if (minutes < GAP_STEP_MINUTES) return { ok: false, message: "A stretch has to be at least 15 minutes." };
    const inside = gaps.some((g) => start.getTime() >= g.start.getTime() && end.getTime() <= g.end.getTime());
    if (!inside) return { ok: false, message: "That time isn't one of your untracked stretches (it may already be accounted for)." };
    parsed.push({ start, end, choice: a.choice, minutes });
  }
  parsed.sort((x, y) => x.start.getTime() - y.start.getTime());
  for (let i = 0; i + 1 < parsed.length; i++) {
    if (parsed[i].end.getTime() > parsed[i + 1].start.getTime()) return { ok: false, message: "Two answers overlap." };
  }
  return { ok: true, answers: parsed };
}

/** Splits a stretch at `firstMinutes` (a multiple of 15, 15 <= firstMinutes <= minutes - 15) into two parts, or null when it can't be split that way. */
export function splitGap(gap: Gap, firstMinutes: number): [Gap, Gap] | null {
  if (firstMinutes % GAP_STEP_MINUTES !== 0 || firstMinutes < GAP_STEP_MINUTES || firstMinutes > gap.minutes - GAP_STEP_MINUTES) return null;
  const mid = new Date(gap.start.getTime() + firstMinutes * MINUTE_MS);
  return [
    { start: gap.start, end: mid, minutes: firstMinutes },
    { start: mid, end: gap.end, minutes: gap.minutes - firstMinutes },
  ];
}
