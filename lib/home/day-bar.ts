import type { DayRibbonLayout, RibbonActivityKind, RibbonActivityDetail, RibbonSpanState } from "@/lib/home/day-ribbon";
import { addDaysToDateString, resolveLocalTime } from "@/lib/date-utils";

/**
 * The Day bar's model (HOME-02): one horizontal timeline from Start Day (wake) to bedtime, reusing the day
 * ribbon's block data. Pure: takes the ribbon layout (blocks as percentages of ITS range), re-projects them
 * onto the bar's own range (wake -> end of day), and derives the awake span, the focus share and the labels.
 */

export type DayBarBlock = {
  label: string;
  colorVar: string;
  kind: RibbonActivityKind;
  /** Percent of the bar, clipped into [0, 100]; null = entirely outside the bar. */
  startPct: number;
  endPct: number;
  isFocus: boolean;
  startAt: Date;
  endAt: Date;
  detail?: RibbonActivityDetail;
  /** True when it lies after NOW (what's left of the day). */
  upcoming: boolean;
};

export type DayBarPrayer = { name: string; label: string; state: RibbonSpanState; midPct: number };

export type DayBar = {
  rangeStart: Date;
  rangeEnd: Date;
  nowPct: number;
  nowPosition: "before" | "within" | "after";
  /** Wake -> now, as percent of the bar (the shaded "awake so far" span). */
  awakePct: number;
  /** The efficiency share of the awake span, as percent of the BAR (0..awakePct). */
  focusSharePct: number;
  blocks: DayBarBlock[];
  prayers: DayBarPrayer[];
};

const clampPct = (n: number) => Math.max(0, Math.min(100, n));

/**
 * The bar's end: the wind-down plan's bedtime ("HH:MM", local) when Sleep plan is on and a plan is set,
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

export function buildDayBar(args: {
  layout: DayRibbonLayout | null;
  wake: Date;
  end: Date;
  now: Date;
  /** Efficiency percent (0..100) or null when not computable. */
  efficiencyPercent: number | null;
}): DayBar {
  const { layout, wake, end, now, efficiencyPercent } = args;
  const span = end.getTime() - wake.getTime();
  const pct = (t: number) => clampPct(((t - wake.getTime()) / span) * 100);
  const nowPct = pct(now.getTime());
  const nowPosition = now.getTime() < wake.getTime() ? "before" : now.getTime() > end.getTime() ? "after" : "within";
  const awakePct = nowPosition === "before" ? 0 : nowPct;
  const focusSharePct = efficiencyPercent === null ? 0 : (awakePct * Math.max(0, Math.min(100, efficiencyPercent))) / 100;

  const blocks: DayBarBlock[] = [];
  const prayers: DayBarPrayer[] = [];
  if (layout) {
    const rSpan = layout.rangeEnd.getTime() - layout.rangeStart.getTime();
    const at = (p: number) => layout.rangeStart.getTime() + (p / 100) * rSpan;
    for (const b of layout.blocks) {
      const s = at(b.startPct);
      const e = at(b.endPct);
      if (e <= wake.getTime() && s < wake.getTime()) continue; // entirely before the bar
      if (s >= end.getTime()) continue; // entirely after it
      blocks.push({
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
      });
    }
    for (const sp of layout.spans) {
      const mid = (sp.windowStart.getTime() + sp.windowEnd.getTime()) / 2;
      if (mid < wake.getTime() || mid > end.getTime()) continue;
      prayers.push({ name: sp.name, label: sp.label, state: sp.state, midPct: pct(mid) });
    }
  }
  return { rangeStart: wake, rangeEnd: end, nowPct, nowPosition, awakePct, focusSharePct, blocks, prayers };
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
