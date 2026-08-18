import type { PrayerName, PrayerWindow } from "@/lib/prayer-times/windows";
import type { EffectivePrayerStatus } from "@/lib/deen/prayer-status";

export type RibbonPrayerInput = {
  name: PrayerName;
  label: string;
  window: PrayerWindow | null;
  status: EffectivePrayerStatus;
};
export type RibbonActivityInput = { label: string; colorVar: string; start: Date; end: Date | null };

export type RibbonSpanState = "logged" | "pending" | "upcoming" | "missed";

export type RibbonPrayerSpan = {
  name: PrayerName;
  label: string;
  status: EffectivePrayerStatus;
  state: RibbonSpanState;
  startPct: number;
  endPct: number;
  windowStart: Date;
  windowEnd: Date;
};

export type RibbonActivityBlock = {
  label: string;
  colorVar: string;
  startPct: number;
  endPct: number;
};

export type DayRibbonLayout = {
  rangeStart: Date;
  rangeEnd: Date;
  spans: RibbonPrayerSpan[];
  now: Date;
  nowPct: number;
  /** Whether `now` actually falls within the range — the caller must render
   * before/after distinctly (parked off-track with its own label), not as
   * a silently-clamped 0%/100% line indistinguishable from "now is Fajr". */
  nowPosition: "before" | "within" | "after";
  blocks: RibbonActivityBlock[];
};

function pctOf(time: Date, start: Date, end: Date): number {
  const span = end.getTime() - start.getTime();
  if (span <= 0) return 0;
  const t = (time.getTime() - start.getTime()) / span;
  return Math.max(0, Math.min(100, t * 100));
}

function spanState(status: EffectivePrayerStatus): RibbonSpanState {
  if (status === "on_time" || status === "qada") return "logged";
  return status;
}

/**
 * The Day Ribbon's layout — Fajr's window through Isha's window (window.end,
 * not window.start: Isha's window extends to the next day's Fajr), each
 * prayer rendered as a SPAN (window.start to window.end), not a point.
 * Points would throw away Phase 1's entire "windows, not instants" thesis
 * in the one module whose job is showing the day's actual shape.
 *
 * Fed pre-derived EffectivePrayerStatus, never a raw stored status — the
 * caller (page.tsx) resolves it via lib/deen/prayer-status.ts. Deriving
 * status again in here would silently regress a closed-and-unlogged prayer
 * back to reading as "upcoming forever", the exact bug the derivation
 * ripple fixed everywhere else.
 *
 * Returns null when there are no placeable prayers at all — no location set
 * (empty `prayers`), or every window is null (cannot determine; see
 * lib/prayer-times/windows.ts's high-latitude clamp). A null layout means
 * the caller renders a distinct setup prompt, not a bare/broken track.
 */
export function computeDayRibbon({
  prayers,
  activities,
  now,
}: {
  prayers: RibbonPrayerInput[];
  activities: RibbonActivityInput[];
  now: Date;
}): DayRibbonLayout | null {
  const placeable = prayers.filter((p): p is RibbonPrayerInput & { window: PrayerWindow } => p.window !== null);
  if (placeable.length === 0) return null;

  const rangeStart = placeable.reduce(
    (min, p) => (p.window.start.getTime() < min.getTime() ? p.window.start : min),
    placeable[0].window.start
  );
  const rangeEnd = placeable.reduce(
    (max, p) => (p.window.end.getTime() > max.getTime() ? p.window.end : max),
    placeable[0].window.end
  );

  const spans: RibbonPrayerSpan[] = placeable.map((p) => ({
    name: p.name,
    label: p.label,
    status: p.status,
    state: spanState(p.status),
    startPct: pctOf(p.window.start, rangeStart, rangeEnd),
    endPct: pctOf(p.window.end, rangeStart, rangeEnd),
    windowStart: p.window.start,
    windowEnd: p.window.end,
  }));

  const nowPct = pctOf(now, rangeStart, rangeEnd);
  const nowPosition: DayRibbonLayout["nowPosition"] =
    now.getTime() < rangeStart.getTime() ? "before" : now.getTime() > rangeEnd.getTime() ? "after" : "within";

  const blocks: RibbonActivityBlock[] = activities.map((a) => ({
    label: a.label,
    colorVar: a.colorVar,
    startPct: pctOf(a.start, rangeStart, rangeEnd),
    endPct: pctOf(a.end ?? now, rangeStart, rangeEnd),
  }));

  return { rangeStart, rangeEnd, spans, now, nowPct, nowPosition, blocks };
}
