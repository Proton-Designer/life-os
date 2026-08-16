export type RibbonPrayerInput = { name: string; label: string; time: Date; status: string };
export type RibbonActivityInput = { label: string; colorVar: string; start: Date; end: Date | null };

export type RibbonPrayerMarker = {
  name: string;
  label: string;
  time: Date;
  pct: number;
  state: "logged" | "upcoming" | "missed";
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
  markers: RibbonPrayerMarker[];
  now: Date;
  nowPct: number;
  /** Whether `now` actually falls within Fajr-Isha — the caller must render
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

function markerState(status: string): RibbonPrayerMarker["state"] {
  if (status === "missed") return "missed";
  if (status === "on_time" || status === "qada") return "logged";
  return "upcoming";
}

/**
 * The Day Ribbon's layout — Fajr through Isha at their real computed times
 * (never evenly spaced, per spec: "evenly spaced is a lie about the day's
 * shape"). Returns null when there are no prayer times to anchor the range
 * to (no location set yet) — the caller renders a distinct setup prompt,
 * not a bare/broken track.
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
  if (prayers.length === 0) return null;

  const rangeStart = prayers[0].time;
  const rangeEnd = prayers[prayers.length - 1].time;

  const markers: RibbonPrayerMarker[] = prayers.map((p) => ({
    name: p.name,
    label: p.label,
    time: p.time,
    pct: pctOf(p.time, rangeStart, rangeEnd),
    state: markerState(p.status),
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

  return { rangeStart, rangeEnd, markers, now, nowPct, nowPosition, blocks };
}
