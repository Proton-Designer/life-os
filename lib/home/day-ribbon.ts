import type { PrayerName, PrayerWindow } from "@/lib/prayer-times/windows";
import type { EffectivePrayerStatus } from "@/lib/deen/prayer-status";

export type RibbonPrayerInput = {
  name: PrayerName;
  label: string;
  window: PrayerWindow | null;
  status: EffectivePrayerStatus;
};
/**
 * Present only for activities that should open a detail popover on click
 * (classes, work) — omitted for focus sessions and anything else that has
 * nothing further to show. The caller renders a non-interactive block
 * rather than a dead affordance when this is absent (overnight session
 * 2026-08-23/24, docs/superpowers/specs/2026-08-23-schedule-calendar.md §4).
 */
export type RibbonActivityDetail = {
  title: string;
  timeRange: string;
  location?: string;
  instructor?: string;
  domain: string;
};

/**
 * What kind of activity a block represents — drives both its icon and its
 * accessible label (Ayman, overnight session 2026-08-24: bare colored bars
 * carried no indicator at all of what a block WAS). "class" is a School
 * schedule_event, "work" a Co-op one; "fitness" a scheduled workout; "task"
 * a timed School/Work deadline; "focus" a Lock-In work session. Kept in
 * sync with the weekly calendar's own vocabulary (components/calendar) —
 * the two surfaces must not disagree on what a block's kind means.
 */
export type RibbonActivityKind = "class" | "work" | "fitness" | "task" | "focus";

export type RibbonActivityInput = {
  label: string;
  colorVar: string;
  kind: RibbonActivityKind;
  start: Date;
  end: Date | null;
  detail?: RibbonActivityDetail;
};

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
  /** Which of the two label rows this span's button renders in — 0 is the
   * default row, 1 is bumped down to avoid overlapping an adjacent label
   * whose midpoint landed too close to this one's (see
   * LABEL_COLLISION_THRESHOLD_PCT below). Computed here, in the pure layout
   * function, rather than left to the component as CSS guesswork — Ayman's
   * report, 2026-08-24: Asr and Maghrib's labels rendered on top of each
   * other, reading as "AsrMaghrib". */
  labelRow: 0 | 1;
};

export type RibbonActivityBlock = {
  label: string;
  colorVar: string;
  kind: RibbonActivityKind;
  startPct: number;
  endPct: number;
  detail?: RibbonActivityDetail;
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

  // Two label rows' minimum separation, in percent of the ribbon's full
  // width, below which adjacent prayer labels would visually overlap
  // (label text is roughly 70-90px wide against the ribbon's 640px
  // min-width track, so ~8% of the track separates two label centers
  // before their text touches).
  const LABEL_COLLISION_THRESHOLD_PCT = 8;

  const spans: RibbonPrayerSpan[] = [];
  let previousMidpointPct: number | null = null;
  let previousLabelRow: 0 | 1 = 0;
  for (const p of placeable) {
    const startPct = pctOf(p.window.start, rangeStart, rangeEnd);
    const endPct = pctOf(p.window.end, rangeStart, rangeEnd);
    const midpointPct = (startPct + endPct) / 2;
    const labelRow: 0 | 1 =
      previousMidpointPct !== null && Math.abs(midpointPct - previousMidpointPct) < LABEL_COLLISION_THRESHOLD_PCT
        ? previousLabelRow === 0
          ? 1
          : 0
        : 0;
    spans.push({
      name: p.name,
      label: p.label,
      status: p.status,
      state: spanState(p.status),
      startPct,
      endPct,
      windowStart: p.window.start,
      windowEnd: p.window.end,
      labelRow,
    });
    previousMidpointPct = midpointPct;
    previousLabelRow = labelRow;
  }

  const nowPct = pctOf(now, rangeStart, rangeEnd);
  const nowPosition: DayRibbonLayout["nowPosition"] =
    now.getTime() < rangeStart.getTime() ? "before" : now.getTime() > rangeEnd.getTime() ? "after" : "within";

  const blocks: RibbonActivityBlock[] = activities.map((a) => ({
    label: a.label,
    colorVar: a.colorVar,
    kind: a.kind,
    startPct: pctOf(a.start, rangeStart, rangeEnd),
    endPct: pctOf(a.end ?? now, rangeStart, rangeEnd),
    detail: a.detail,
  }));

  return { rangeStart, rangeEnd, spans, now, nowPct, nowPosition, blocks };
}
